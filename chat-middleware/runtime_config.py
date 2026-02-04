"""
Mutable runtime configuration that can be updated via debug API
"""
from dataclasses import dataclass, field
from typing import Optional
from models import SliceStrategy


DEFAULT_SYSTEM_PROMPT = """You are a radiology assistant specialized in medical image analysis.
You are viewing DICOM medical images from a study. Analyze the images carefully and
provide accurate, professional observations. If you cannot determine something with
confidence, say so clearly."""


@dataclass
class PreprocessingParams:
    """Preprocessing parameters that can be adjusted at runtime"""
    num_slices: int = 5
    slice_strategy: SliceStrategy = SliceStrategy.CENTRAL
    central_percentage: int = 60  # For central strategy, % of volume to use


@dataclass
class OllamaOptions:
    """Ollama generation options that can be adjusted at runtime"""
    # Context window
    num_ctx: Optional[int] = None           # Context window size (use config default if None)
    
    # Thinking models (e.g., deepseek-r1)
    think: Optional[bool] = None            # Enable thinking before responding
    
    # Suffix
    suffix: Optional[str] = None            # Text after model response
    
    def to_dict(self) -> dict:
        """Convert to dict, excluding None values"""
        result = {}
        if self.num_ctx is not None:
            result["num_ctx"] = self.num_ctx
        if self.think is not None:
            result["think"] = self.think
        if self.suffix is not None:
            result["suffix"] = self.suffix
        return result
    
    def to_full_dict(self) -> dict:
        """Convert to dict including None values for display"""
        return {
            "num_ctx": self.num_ctx,
            "think": self.think,
            "suffix": self.suffix,
        }


class RuntimeConfig:
    """
    Singleton holding runtime-adjustable configuration.
    Can be modified via debug API without restarting the service.
    """
    
    def __init__(self):
        self.system_prompt: str = DEFAULT_SYSTEM_PROMPT
        self.preprocessing: PreprocessingParams = PreprocessingParams()
        self.ollama_options: OllamaOptions = OllamaOptions()
    
    def update(
        self,
        system_prompt: Optional[str] = None,
        preprocessing: Optional[dict] = None,
        ollama_options: Optional[dict] = None
    ) -> None:
        """
        Update configuration values.
        
        Args:
            system_prompt: New system prompt for the LLM
            preprocessing: Dict with preprocessing params to update
            ollama_options: Dict with Ollama generation options to update
        """
        if system_prompt is not None:
            self.system_prompt = system_prompt
        
        if preprocessing is not None:
            if "num_slices" in preprocessing and preprocessing["num_slices"] is not None:
                self.preprocessing.num_slices = preprocessing["num_slices"]
            if "slice_strategy" in preprocessing and preprocessing["slice_strategy"] is not None:
                strategy = preprocessing["slice_strategy"]
                if isinstance(strategy, str):
                    self.preprocessing.slice_strategy = SliceStrategy(strategy)
                else:
                    self.preprocessing.slice_strategy = strategy
            if "central_percentage" in preprocessing and preprocessing["central_percentage"] is not None:
                self.preprocessing.central_percentage = preprocessing["central_percentage"]
        
        if ollama_options is not None:
            # Update each option if provided
            for key in ["num_ctx", "think", "suffix"]:
                if key in ollama_options:
                    setattr(self.ollama_options, key, ollama_options[key])
    
    def to_dict(self) -> dict:
        """Convert configuration to dictionary for API response"""
        return {
            "system_prompt": self.system_prompt,
            "preprocessing": {
                "num_slices": self.preprocessing.num_slices,
                "slice_strategy": self.preprocessing.slice_strategy.value,
                "central_percentage": self.preprocessing.central_percentage,
            },
            "ollama_options": self.ollama_options.to_full_dict(),
        }


# Global runtime config instance
_runtime_config: Optional[RuntimeConfig] = None


def get_runtime_config() -> RuntimeConfig:
    """Get the global runtime configuration singleton"""
    global _runtime_config
    if _runtime_config is None:
        _runtime_config = RuntimeConfig()
    return _runtime_config


def reset_runtime_config() -> RuntimeConfig:
    """Reset runtime configuration to defaults (useful for testing)"""
    global _runtime_config
    _runtime_config = RuntimeConfig()
    return _runtime_config
