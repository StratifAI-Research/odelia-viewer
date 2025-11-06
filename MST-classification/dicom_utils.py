"""
DICOM to NIfTI conversion utilities using SimpleITK
"""
import SimpleITK as sitk
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


def dicom_to_nifti(dicom_folder: str) -> str:
    """
    Convert DICOM series to NIfTI format using SimpleITK.
    SimpleITK is robust and handles various DICOM metadata edge cases.

    Args:
        dicom_folder: Path to folder containing DICOM files

    Returns:
        Path to created NIfTI file
    """
    dicom_path = Path(dicom_folder)

    # Verify DICOM files exist
    dicom_files = list(dicom_path.glob("*.dcm"))
    if not dicom_files:
        raise ValueError(f"No DICOM files found in {dicom_folder}")

    logger.info(f"Converting {len(dicom_files)} DICOM files to NIfTI using SimpleITK")

    # Read DICOM series using SimpleITK
    reader = sitk.ImageSeriesReader()
    dicom_names = reader.GetGDCMSeriesFileNames(str(dicom_path))

    if not dicom_names:
        raise ValueError(f"No valid DICOM series found in {dicom_folder}")

    reader.SetFileNames(dicom_names)
    reader.MetaDataDictionaryArrayUpdateOn()
    reader.LoadPrivateTagsOn()

    # Read the image
    image = reader.Execute()

    logger.info(f"Read DICOM series: {len(dicom_names)} slices, size: {image.GetSize()}, spacing: {image.GetSpacing()}")

    # Write to NIfTI format (preserves orientation and spacing)
    nifti_path = dicom_path / "mri_series.nii.gz"
    sitk.WriteImage(image, str(nifti_path))

    logger.info(f"NIfTI created: {nifti_path}")
    return str(nifti_path)
