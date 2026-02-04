"""
Async streaming client for Ollama's chat API
"""
import json
import asyncio
import logging
from typing import List, AsyncGenerator, Optional

import aiohttp

logger = logging.getLogger(__name__)


class OllamaClient:
    """
    Async streaming client for Ollama's /api/chat endpoint.
    Supports cancellation via asyncio.Event.
    """

    def __init__(self, base_url: str, model: str, num_ctx: int = 8192):
        """
        Initialize the Ollama client.

        Args:
            base_url: Base URL for Ollama API (e.g., "http://localhost:11434")
            model: Model name to use (e.g., "MedAIBase/MedGemma1.5:4b")
            num_ctx: Context window size (default 8192)
        """
        self.base_url = base_url.rstrip('/')
        self.model = model
        self.num_ctx = num_ctx

    async def chat_stream(
        self,
        messages: List[dict],
        cancel_event: Optional[asyncio.Event] = None,
        runtime_options: Optional[dict] = None
    ) -> AsyncGenerator[str, None]:
        """
        Stream chat completion tokens from Ollama.

        Args:
            messages: List of message dicts with role, content, and optional images
            cancel_event: Event to signal cancellation (optional)
            runtime_options: Optional dict with runtime options (num_ctx, think, suffix)

        Yields:
            Token strings as they are generated

        Raises:
            aiohttp.ClientError: If connection fails
            Exception: For other errors
        """
        url = f"{self.base_url}/api/chat"

        # Build options - start with static config
        options = {"num_ctx": self.num_ctx}

        # Merge runtime options if provided
        if runtime_options:
            if runtime_options.get("num_ctx") is not None:
                options["num_ctx"] = runtime_options["num_ctx"]

        # Build payload
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "options": options
        }

        # Add think parameter if specified (for thinking models like deepseek-r1)
        if runtime_options and runtime_options.get("think") is not None:
            payload["think"] = runtime_options["think"]

        # Add suffix if specified
        if runtime_options and runtime_options.get("suffix") is not None:
            payload["suffix"] = runtime_options["suffix"]

        logger.info(f"Starting Ollama chat stream to {url} with model {self.model}")
        logger.debug(f"Messages count: {len(messages)}")

        timeout = aiohttp.ClientTimeout(total=300)  # 5 minute timeout

        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, json=payload) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"Ollama API error: {response.status} - {error_text}")
                        raise Exception(f"Ollama API error: {response.status} - {error_text}")

                    logger.debug("Ollama stream connected, receiving tokens...")
                    cancelled = False

                    try:
                        async for line in response.content:
                            # Check for cancellation
                            if cancel_event and cancel_event.is_set():
                                logger.info("Chat stream cancelled by user")
                                cancelled = True
                                break

                            if not line:
                                continue

                            try:
                                # Ollama returns JSON lines
                                chunk = json.loads(line.decode('utf-8'))

                                # Extract content from message
                                if "message" in chunk and "content" in chunk["message"]:
                                    content = chunk["message"]["content"]
                                    if content:
                                        yield content

                                # Check if generation is done
                                if chunk.get("done", False):
                                    logger.debug("Ollama stream completed (done=true)")
                                    break

                            except json.JSONDecodeError as e:
                                logger.warning(f"Failed to parse Ollama response line: {e}")
                                continue
                    finally:
                        # Ensure we close/release the response to abort the HTTP connection
                        if cancelled:
                            logger.debug("Releasing HTTP response due to cancellation")
                            response.close()

                    logger.info(f"Ollama chat stream finished (cancelled={cancelled})")

        except asyncio.CancelledError:
            logger.info("Ollama chat stream cancelled")
            raise
        except aiohttp.ClientError as e:
            logger.error(f"Ollama connection error: {e}")
            raise
        except Exception as e:
            logger.error(f"Ollama chat error: {e}")
            raise

    async def health_check(self) -> bool:
        """
        Check if Ollama is reachable and responding.

        Returns:
            True if Ollama is healthy, False otherwise
        """
        try:
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(f"{self.base_url}/api/tags") as response:
                    return response.status == 200
        except Exception as e:
            logger.warning(f"Ollama health check failed: {e}")
            return False

    async def list_models(self) -> List[str]:
        """
        List available models in Ollama.

        Returns:
            List of model names
        """
        try:
            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(f"{self.base_url}/api/tags") as response:
                    if response.status != 200:
                        return []
                    data = await response.json()
                    return [m["name"] for m in data.get("models", [])]
        except Exception as e:
            logger.warning(f"Failed to list Ollama models: {e}")
            return []


# Global client instance
_ollama_client: Optional[OllamaClient] = None


def get_ollama_client(base_url: str = None, model: str = None, num_ctx: int = None) -> OllamaClient:
    """
    Get the global Ollama client singleton.

    Args:
        base_url: Override base URL (used on first call to initialize)
        model: Override model name (used on first call to initialize)
        num_ctx: Override context window size (used on first call to initialize)

    Returns:
        OllamaClient instance
    """
    global _ollama_client
    if _ollama_client is None:
        from config import get_config
        config = get_config()
        _ollama_client = OllamaClient(
            base_url=base_url or config.ollama_url,
            model=model or config.ollama_model,
            num_ctx=num_ctx or config.ollama_num_ctx
        )
    return _ollama_client


def reset_ollama_client() -> None:
    """Reset the Ollama client singleton (useful for testing)"""
    global _ollama_client
    _ollama_client = None
