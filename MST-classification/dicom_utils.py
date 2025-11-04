"""
DICOM to NIfTI conversion utilities
"""
import numpy as np
import pydicom
import nibabel as nib
from pathlib import Path
from typing import List
import logging

logger = logging.getLogger(__name__)


def dicom_to_nifti(dicom_folder: str) -> str:
    """
    Convert DICOM series to NIfTI format.

    Args:
        dicom_folder: Path to folder containing DICOM files

    Returns:
        Path to created NIfTI file
    """
    dicom_files = sorted(Path(dicom_folder).glob("*.dcm"))

    if not dicom_files:
        raise ValueError(f"No DICOM files found in {dicom_folder}")

    # Load and sort slices
    slices = [pydicom.dcmread(f) for f in dicom_files]
    slices.sort(key=lambda x: int(x.InstanceNumber) if hasattr(x, 'InstanceNumber') else 0)

    # Stack into volume
    volume = np.stack([s.pixel_array for s in slices], axis=-1)

    # Get spatial information from first slice
    ds = slices[0]
    pixel_spacing = getattr(ds, 'PixelSpacing', [1.0, 1.0])
    slice_thickness = getattr(ds, 'SliceThickness', 1.0)

    # Create affine transformation matrix
    affine = np.eye(4)
    affine[0, 0] = float(pixel_spacing[0])
    affine[1, 1] = float(pixel_spacing[1])
    affine[2, 2] = float(slice_thickness)

    # Save NIfTI
    nifti_img = nib.Nifti1Image(volume, affine)
    nifti_path = Path(dicom_folder) / "mri_series.nii.gz"
    nib.save(nifti_img, nifti_path)

    logger.info(f"NIfTI created: {nifti_path}, shape: {volume.shape}")
    return str(nifti_path)
