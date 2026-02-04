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


class RuntimeConfig:
    """
    Singleton holding runtime-adjustable configuration.
    Can be modified via debug API without restarting the service.
    """
    
    def __init__(self):
        self.system_prompt: str = DEFAULT_SYSTEM_PROMPT
        self.preprocessing: PreprocessingParams = PreprocessingParams()
    
    def update(
        self,
        system_prompt: Optional[str] = None,
        preprocessing: Optional[dict] = None
    ) -> None:
        """
        Update configuration values.
        
        Args:
            system_prompt: New system prompt for the LLM
            preprocessing: Dict with preprocessing params to update
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
    
    def to_dict(self) -> dict:
        """Convert configuration to dictionary for API response"""
        return {
            "system_prompt": self.system_prompt,
            "preprocessing": {
                "num_slices": self.preprocessing.num_slices,
                "slice_strategy": self.preprocessing.slice_strategy.value,
                "central_percentage": self.preprocessing.central_percentage,
            }
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
