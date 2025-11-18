"""
DICOM to NIfTI conversion utilities using SimpleITK
"""
import SimpleITK as sitk
from pathlib import Path
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)


def get_dicom_metadata(dicom_file: str) -> tuple:
    """
    Extract temporal position and spatial position from DICOM file using SimpleITK.

    Returns:
        (temporal_position, slice_location, instance_number)
    """
    try:
        reader = sitk.ImageFileReader()
        reader.SetFileName(str(dicom_file))
        reader.LoadPrivateTagsOn()
        reader.ReadImageInformation()  # Read metadata without loading pixels

        # Get temporal position
        temporal_pos = 0
        if reader.HasMetaDataKey("0020|0100"):  # TemporalPositionIdentifier
            temporal_pos = int(reader.GetMetaData("0020|0100"))
        elif reader.HasMetaDataKey("0018|1060"):  # TriggerTime
            temporal_pos = int(float(reader.GetMetaData("0018|1060")))

        # Get spatial position for sorting
        slice_location = 0.0
        if reader.HasMetaDataKey("0020|1041"):  # SliceLocation
            slice_location = float(reader.GetMetaData("0020|1041"))
        elif reader.HasMetaDataKey("0020|0032"):  # ImagePositionPatient
            # Use Z coordinate from ImagePositionPatient
            position = reader.GetMetaData("0020|0032")
            slice_location = float(position.split("\\")[2])

        # Get instance number as fallback
        instance_number = 0
        if reader.HasMetaDataKey("0020|0013"):  # InstanceNumber
            instance_number = int(reader.GetMetaData("0020|0013"))

        return (temporal_pos, slice_location, instance_number)

    except Exception as e:
        logger.debug(f"Could not read metadata from {dicom_file}: {e}")
        return (0, 0.0, 0)


def dicom_to_nifti(dicom_folder: str) -> str:
    """
    Convert DICOM series to NIfTI format using SimpleITK.
    Handles 4D temporal series by extracting the first temporal phase.

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

    logger.info(f"Found {len(dicom_files)} DICOM files")

    # Extract metadata for all files and group by temporal position
    file_metadata = []
    for dcm_file in dicom_files:
        temporal_pos, slice_loc, instance_num = get_dicom_metadata(str(dcm_file))
        file_metadata.append({
            'path': str(dcm_file),
            'temporal_pos': temporal_pos,
            'slice_location': slice_loc,
            'instance_number': instance_num
        })

    # Group by temporal position
    temporal_groups = defaultdict(list)
    for item in file_metadata:
        temporal_groups[item['temporal_pos']].append(item)

    num_temporal_phases = len(temporal_groups)
    logger.info(f"Detected {num_temporal_phases} temporal phase(s): {sorted(temporal_groups.keys())}")

    # Determine which files to use
    if num_temporal_phases == 1:
        # Simple 3D series - use standard GDCM series reader
        logger.info("Single temporal phase detected - converting all files")
        reader = sitk.ImageSeriesReader()
        dicom_names = reader.GetGDCMSeriesFileNames(str(dicom_path))

        if not dicom_names:
            raise ValueError(f"No valid DICOM series found in {dicom_folder}")

        reader.SetFileNames(dicom_names)
        reader.MetaDataDictionaryArrayUpdateOn()
        reader.LoadPrivateTagsOn()
        image = reader.Execute()

    else:
        # 4D series - extract first temporal position
        sorted_positions = sorted(temporal_groups.keys())
        selected_key = sorted_positions[0]  # Always use first temporal phase
        selected_files_metadata = temporal_groups[selected_key]

        # Sort files by spatial position (slice_location, then instance_number)
        # Use reverse=True to match GDCM default ordering (superior to inferior)
        selected_files_metadata.sort(key=lambda x: (x['slice_location'], x['instance_number']), reverse=True)
        selected_files = [item['path'] for item in selected_files_metadata]

        logger.info(
            f"4D temporal series detected. Extracting first temporal position "
            f"(key={selected_key}, {len(selected_files)} slices, "
            f"slice range: {selected_files_metadata[0]['slice_location']:.2f} to {selected_files_metadata[-1]['slice_location']:.2f})"
        )

        # Read sorted files
        reader = sitk.ImageSeriesReader()
        reader.SetFileNames(selected_files)
        reader.MetaDataDictionaryArrayUpdateOn()
        reader.LoadPrivateTagsOn()
        image = reader.Execute()

    logger.info(
        f"Read DICOM series: size: {image.GetSize()}, spacing: {image.GetSpacing()}, "
        f"direction: {image.GetDirection()}"
    )

    # Write to NIfTI format (preserves original DICOM slice ordering)
    nifti_path = dicom_path / "mri_series.nii.gz"
    sitk.WriteImage(image, str(nifti_path))

    logger.info(f"NIfTI created: {nifti_path}")
    return str(nifti_path)
