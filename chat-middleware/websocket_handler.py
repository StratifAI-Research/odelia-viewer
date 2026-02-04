"""
WebSocket handler for chat sessions
"""
import logging
from datetime import datetime
from typing import List

from fastapi import WebSocket, WebSocketDisconnect

from models import ClientMessage, ClientMessageType, ServerMessageType
from session_manager import Session, get_session_manager
from image_cache import CachedSeries, get_image_cache
from runtime_config import get_runtime_config
from prompt_builder import get_prompt_builder
from ollama_client import get_ollama_client
from preprocessing import preprocess_series
from config import get_config

logger = logging.getLogger(__name__)


async def send_message(websocket: WebSocket, msg_type: ServerMessageType, **kwargs) -> None:
    """Send a typed message to the client"""
    message = {"type": msg_type.value, **kwargs}
    await websocket.send_json(message)


async def handle_websocket(websocket: WebSocket, session_id: str) -> None:
    """
    Handle WebSocket connection for a chat session.
    
    Args:
        websocket: FastAPI WebSocket connection
        session_id: Session ID from URL path ('new' to create new session)
    """
    session_manager = get_session_manager()
    
    # Get or create session (if session_id is "new", generate new ID)
    session = session_manager.get_or_create_session(session_id)
    
    try:
        await websocket.accept()
        logger.info(f"WebSocket connected for session: {session.session_id}")
        
        # Send connection confirmation with actual session_id
        await send_message(
            websocket,
            ServerMessageType.CONNECTED,
            session_id=session.session_id
        )
        
        # Process incoming messages
        async for message in websocket.iter_json():
            try:
                msg = ClientMessage(**message)
                
                if msg.type == ClientMessageType.CHAT:
                    await handle_chat(
                        websocket,
                        session,
                        msg.content or "",
                        msg.study_uid or "",
                        msg.series_uids or []
                    )
                elif msg.type == ClientMessageType.CANCEL:
                    logger.info(f"Cancellation requested for session {session.session_id}")
                    session.cancel_event.set()
                    
            except Exception as e:
                logger.error(f"Error processing message: {e}")
                await send_message(
                    websocket,
                    ServerMessageType.ERROR,
                    content=f"Error processing message: {str(e)}"
                )
    
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for session: {session.session_id}")
    except Exception as e:
        logger.error(f"WebSocket error for session {session.session_id}: {e}")
    finally:
        # Don't remove session on disconnect - allow reconnection
        logger.debug(f"WebSocket handler finished for session: {session.session_id}")


async def handle_chat(
    websocket: WebSocket,
    session: Session,
    content: str,
    study_uid: str,
    series_uids: List[str]
) -> None:
    """
    Handle a chat message with study and series context.
    
    Args:
        websocket: WebSocket connection
        session: Current session
        content: User message content
        study_uid: StudyInstanceUID
        series_uids: List of SeriesInstanceUIDs for context
    """
    config = get_config()
    runtime_config = get_runtime_config()
    image_cache = get_image_cache()
    prompt_builder = get_prompt_builder()
    ollama_client = get_ollama_client()
    session_manager = get_session_manager()
    
    # Reset cancel event for new generation
    session.cancel_event.clear()
    session.last_activity = datetime.now()
    
    try:
        # 1. Ensure all requested series are cached (preprocess if needed)
        series_images = {}
        total = len(series_uids) if series_uids else 0
        
        for i, series_uid in enumerate(series_uids):
            # Check for cancellation
            if session.cancel_event.is_set():
                logger.info("Chat cancelled during preprocessing")
                return
            
            if not image_cache.has(series_uid):
                # Send preprocessing status
                progress = (i / total) if total > 0 else 0
                await send_message(
                    websocket,
                    ServerMessageType.PREPROCESSING,
                    content=f"Retrieving series {series_uid}...",
                    progress=progress
                )
                
                # Preprocess and cache (uses RuntimeConfig for slice params)
                try:
                    images = await preprocess_series(
                        series_uid,
                        study_uid,
                        runtime_config.preprocessing,
                        config.wado_base_url,
                        config.image_folder
                    )
                    
                    image_cache.put(series_uid, CachedSeries(
                        series_uid=series_uid,
                        base64_images=images,
                        created_at=datetime.now(),
                        last_accessed=datetime.now()
                    ))
                except Exception as e:
                    logger.error(f"Failed to preprocess series {series_uid}: {e}")
                    await send_message(
                        websocket,
                        ServerMessageType.ERROR,
                        content=f"Failed to retrieve series {series_uid}: {str(e)}"
                    )
                    return
            
            # Get images from cache
            cached = image_cache.get(series_uid)
            if cached:
                series_images[series_uid] = cached.base64_images
        
        # Update preprocessing progress to complete
        if total > 0:
            await send_message(
                websocket,
                ServerMessageType.PREPROCESSING,
                content="Preprocessing complete",
                progress=1.0
            )
        
        # 2. Build Ollama messages (uses RuntimeConfig for system prompt)
        messages = prompt_builder.build_ollama_messages(
            session.conversation_history,
            content,
            series_images
        )
        
        # 3. Stream response from Ollama
        full_response = ""
        try:
            async for token in ollama_client.chat_stream(messages, session.cancel_event):
                # Check for cancellation
                if session.cancel_event.is_set():
                    logger.info("Chat cancelled during generation")
                    break
                
                full_response += token
                await send_message(
                    websocket,
                    ServerMessageType.TOKEN,
                    content=token
                )
        except Exception as e:
            logger.error(f"Ollama streaming error: {e}")
            await send_message(
                websocket,
                ServerMessageType.ERROR,
                content=f"Error during generation: {str(e)}"
            )
            return
        
        # 4. Store in conversation history (only if not cancelled and has content)
        if not session.cancel_event.is_set() and full_response:
            session_manager.append_message(session.session_id, "user", content)
            session_manager.append_message(session.session_id, "assistant", full_response)
        
        # 5. Signal completion
        await send_message(websocket, ServerMessageType.DONE)
        
    except Exception as e:
        logger.error(f"Error in handle_chat: {e}")
        import traceback
        traceback.print_exc()
        await send_message(
            websocket,
            ServerMessageType.ERROR,
            content=f"Unexpected error: {str(e)}"
        )
