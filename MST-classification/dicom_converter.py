"""
DICOM to NIfTI conversion wrapper
Single Responsibility: Provide clean interface for DICOM conversion
"""
import logging
from pathlib import Path

from dicom_utils import dicom_to_nifti

logger = logging.getLogger(__name__)


def convert_series_to_nifti(dicom_folder: Path) -> Path:
    """
    Convert DICOM series to NIfTI format

    Wraps the existing dicom_utils.dicom_to_nifti function with
    proper type handling and error reporting.

    Args:
        dicom_folder: Path to folder containing DICOM files

    Returns:
        Path to created NIfTI file

    Raises:
        ValueError: If conversion fails
    """
    logger.info(f"Converting DICOM series to NIfTI: {dicom_folder}")

    try:
        nifti_path = dicom_to_nifti(str(dicom_folder))
        nifti_path = Path(nifti_path)

        if not nifti_path.exists():
            raise ValueError(f"NIfTI file was not created: {nifti_path}")

        logger.info(f"Successfully converted to NIfTI: {nifti_path}")
        return nifti_path

    except Exception as e:
        logger.error(f"DICOM to NIfTI conversion failed: {e}")
        raise ValueError(f"Conversion failed: {e}") from e
