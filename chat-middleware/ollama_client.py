"""
Async streaming client for Ollama's OpenAI-compatible /v1/chat/completions endpoint
"""
import json
import asyncio
import logging
from typing import List, AsyncGenerator, Optional

import aiohttp

logger = logging.getLogger(__name__)


class OllamaClient:
    """
    Async streaming client for Ollama's /v1/chat/completions endpoint.
    Supports cancellation via asyncio.Event.
    """

    def __init__(self, base_url: str, model: str):
        """
        Initialize the Ollama client.

        Args:
            base_url: Base URL for Ollama API (e.g., "http://localhost:11434")
            model: Model name to use (e.g., "medgemma-128k")
        """
        self.base_url = base_url.rstrip('/')
        self.model = model

    async def chat_stream(
        self,
        messages: List[dict],
        cancel_event: Optional[asyncio.Event] = None,
        runtime_options: Optional[dict] = None
    ) -> AsyncGenerator[str, None]:
        """
        Stream chat completion tokens from Ollama's OpenAI-compatible endpoint.

        Only passes parameters supported by /v1/chat/completions:
        model, messages, stream, max_tokens, temperature, top_p, stop, seed

        Args:
            messages: List of message dicts with role and content (string or content array)
            cancel_event: Event to signal cancellation (optional)
            runtime_options: Optional dict with supported OpenAI params (max_tokens, temperature, etc.)

        Yields:
            Token strings as they are generated
        """
        url = f"{self.base_url}/v1/chat/completions"

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
        }

        # Only add supported OpenAI-compatible parameters
        if runtime_options:
            for key in ("max_tokens", "temperature", "top_p", "stop", "seed",
                        "presence_penalty", "frequency_penalty"):
                if runtime_options.get(key) is not None:
                    payload[key] = runtime_options[key]

        logger.info(f"Starting chat stream to {url} with model {self.model}")
        logger.debug(f"Messages count: {len(messages)}")

        timeout = aiohttp.ClientTimeout(total=300)

        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, json=payload) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"Ollama API error: {response.status} - {error_text}")
                        raise Exception(f"Ollama API error: {response.status} - {error_text}")

                    logger.debug("SSE stream connected, receiving tokens...")
                    cancelled = False

                    try:
                        async for raw_line in response.content:
                            if cancel_event and cancel_event.is_set():
                                logger.info("Chat stream cancelled by user")
                                cancelled = True
                                break

                            if not raw_line:
                                continue

                            line = raw_line.decode('utf-8').strip()

                            if not line:
                                continue

                            # SSE format: "data: {...}" or "data: [DONE]"
                            if not line.startswith("data: "):
                                continue

                            data = line[len("data: "):]

                            if data == "[DONE]":
                                logger.debug("SSE stream completed ([DONE])")
                                break

                            try:
                                chunk = json.loads(data)
                                choices = chunk.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    content = delta.get("content")
                                    if content:
                                        yield content
                            except json.JSONDecodeError as e:
                                logger.warning(f"Failed to parse SSE chunk: {e}")
                                continue
                    finally:
                        if cancelled:
                            logger.debug("Releasing HTTP response due to cancellation")
                            response.close()

                    logger.info(f"Chat stream finished (cancelled={cancelled})")

        except asyncio.CancelledError:
            logger.info("Chat stream cancelled")
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
        Uses /api/tags (native endpoint, always available).
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
        Uses /api/tags (native endpoint, always available).
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


def get_ollama_client(base_url: str = None, model: str = None) -> OllamaClient:
    """
    Get the global Ollama client singleton.

    Args:
        base_url: Override base URL (used on first call to initialize)
        model: Override model name (used on first call to initialize)

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
        )
    else:
        effective_url = base_url or ""
        effective_model = model or ""
        if effective_url and effective_url != _ollama_client.base_url:
            logger.warning(
                f"OllamaClient already initialized with base_url={_ollama_client.base_url}, "
                f"ignoring requested base_url={effective_url}"
            )
        if effective_model and effective_model != _ollama_client.model:
            logger.warning(
                f"OllamaClient already initialized with model={_ollama_client.model}, "
                f"ignoring requested model={effective_model}"
            )
    return _ollama_client


def reset_ollama_client() -> None:
    """Reset the Ollama client singleton (useful for testing)"""
    global _ollama_client
    _ollama_client = None
