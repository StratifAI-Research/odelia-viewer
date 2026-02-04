"""
Prompt builder for assembling Ollama-compatible message arrays
"""
import logging
from typing import Dict, List

from runtime_config import RuntimeConfig, get_runtime_config

logger = logging.getLogger(__name__)


class PromptBuilder:
    """
    Builds Ollama-compatible message arrays from conversation history
    and current request with images.
    """
    
    def __init__(self, runtime_config: RuntimeConfig = None):
        """
        Initialize the prompt builder.
        
        Args:
            runtime_config: RuntimeConfig instance. If None, uses global singleton.
        """
        self._config = runtime_config
    
    @property
    def config(self) -> RuntimeConfig:
        """Get the runtime config, using global if not set"""
        if self._config is None:
            return get_runtime_config()
        return self._config
    
    def build_ollama_messages(
        self,
        conversation_history: List[dict],
        new_user_message: str,
        series_images: Dict[str, List[str]]
    ) -> List[dict]:
        """
        Build messages array for Ollama API.
        
        Format for multimodal:
        [
            {"role": "system", "content": "You are a radiology assistant..."},
            {"role": "user", "content": "...", "images": ["base64...", "base64..."]},
            {"role": "assistant", "content": "..."},
            ...
        ]
        
        Images are attached to the current user message only.
        Previous conversation history is included for context (without images).
        
        Args:
            conversation_history: List of previous messages [{"role": "...", "content": "..."}]
            new_user_message: The new message from the user
            series_images: Dict mapping series_uid to list of base64 images
            
        Returns:
            List of message dicts formatted for Ollama API
        """
        messages = []
        
        # 1. System prompt (from RuntimeConfig - allows debug override)
        messages.append({
            "role": "system",
            "content": self.config.system_prompt
        })
        
        # 2. Replay conversation history (without images - Ollama maintains context)
        for msg in conversation_history:
            messages.append({
                "role": msg["role"],
                "content": msg["content"]
            })
        
        # 3. Current user message with images
        # Flatten all images from all requested series
        all_images = []
        for series_uid, images in series_images.items():
            all_images.extend(images)
            logger.debug(f"Added {len(images)} images from series {series_uid}")
        
        user_message = {
            "role": "user",
            "content": new_user_message
        }
        
        # Only add images key if we have images
        if all_images:
            user_message["images"] = all_images
            logger.info(f"Built prompt with {len(all_images)} total images")
        else:
            logger.info("Built prompt with no images (text-only)")
        
        messages.append(user_message)
        
        logger.debug(f"Total messages in prompt: {len(messages)} "
                    f"(1 system + {len(conversation_history)} history + 1 current)")
        
        return messages


# Global prompt builder instance
_prompt_builder: PromptBuilder = None


def get_prompt_builder() -> PromptBuilder:
    """Get the global prompt builder singleton"""
    global _prompt_builder
    if _prompt_builder is None:
        _prompt_builder = PromptBuilder()
    return _prompt_builder
