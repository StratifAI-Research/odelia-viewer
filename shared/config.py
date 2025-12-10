"""
Shared configuration classes for ML Integration services
"""
from dataclasses import dataclass
from pathlib import Path


@dataclass
class OrthancConfig:
    """Configuration for Orthanc server communication"""
    url: str
    verify_ssl: bool = False
    timeout: int = 30


@dataclass
class StorageConfig:
    """Configuration for DICOM file storage"""
    image_folder: Path
    cleanup_on_start: bool = True
