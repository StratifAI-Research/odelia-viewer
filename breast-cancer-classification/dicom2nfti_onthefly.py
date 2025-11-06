import os
from shutil import copyfile
import shutil
import tempfile
from pathlib import Path
import numpy as np
import pandas as pd
import pydicom
import torchio as tio
import torch
import logging

# Set up logging
logger = logging.getLogger(__name__)

pydicom.config.settings.writing_validation_mode = pydicom.config.IGNORE
pydicom.config.settings.reading_validation_mode = pydicom.config.IGNORE

def maybe_convert(x):
    if isinstance(x, (pydicom.sequence.Sequence, pydicom.dataset.Dataset)):
        return None  # Don't store complex nested data
    elif isinstance(x, pydicom.multival.MultiValue):
        return list(x)
    elif isinstance(x, pydicom.valuerep.PersonName):
        return str(x)
    elif isinstance(x, pydicom.valuerep.DSfloat):
        return float(x)
    elif isinstance(x, pydicom.valuerep.IS):
        return int(x)
    return x


def get(ds, key):
    keyword = ds[key].keyword
    if keyword == "":
        return ds[key].name
    return keyword


def dataset2dict(ds, exclude=['PixelData', 'Overlay Data']):
    return {get(ds, key): maybe_convert(ds[key].value)
            for key in ds.keys()
            if get(ds, key) not in exclude}


def read_metadata(args):
    path_dcm, path_root_data = args
    try:
        # Try to read the DICOM file
        ds = pydicom.dcmread(path_dcm, stop_before_pixels=True)

        # Extract metadata
        meta_dict = dataset2dict(ds)
        meta_dict['_Path'] = str(path_dcm.relative_to(path_root_data))
        return meta_dict

    except Exception as e:
        return None


def sort_dyn(df_dyn):
    # Check if TriggerTime column exists
    if 'TriggerTime' not in df_dyn.columns:
        logger.error("TriggerTime column not found in DICOM metadata")
        logger.info(f"Available columns: {list(df_dyn.columns)}")
        return None

    # Check for NaN values in TriggerTime
    nan_count = df_dyn['TriggerTime'].isna().sum()
    if nan_count > 0:
        logger.warning(f"Found {nan_count} DICOM files with missing TriggerTime")

    # Get n unique Trigger Time and assign index 0 to the smallest and n-1 to the largest trigger time
    df_dyn['TriggerIndex'] = df_dyn['TriggerTime'].rank(method='dense').dropna().astype(int) - 1

    unique_trigger_times = df_dyn['TriggerTime'].dropna().unique()
    logger.info(f"Found {len(unique_trigger_times)} unique TriggerTime values: {sorted(unique_trigger_times)}")

    # Verify equal number of slices per dynamic:
    slice_counts = df_dyn['TriggerIndex'].value_counts()
    logger.info(f"Slices per dynamic sequence: {slice_counts.to_dict()}")

    if np.unique(slice_counts.values).size != 1:
        logger.error(f"Unequal number of slices per dynamic sequence")
        logger.error(f"Slice counts: {slice_counts.to_dict()}")
        return None

    # Define the sequence name mapping based on the trigger index
    name_mapping = {0: 'Pre'}
    name_mapping.update({i: f'Post_{i}' for i in range(1, int(df_dyn['TriggerIndex'].max()) + 1)})
    logger.info(f"Sequence name mapping: {name_mapping}")

    # Assign names based on Trigger Index: {0:'Pre', 1:'Post_1, 2:'Post_2', ...}
    df_dyn['_SequenceName'] = df_dyn['TriggerIndex'].map(name_mapping)

    # Add the total number of dynamic sequences to the DataFrame
    df_dyn['_NumberOfSequences'] = df_dyn['TriggerIndex'].max() + 1
    logger.info(f"Total number of sequences: {df_dyn['_NumberOfSequences'].iloc[0]}")

    # Drop the TriggerIndex column if you don't want to keep it
    df_dyn = df_dyn.drop(columns=['TriggerIndex'])

    return df_dyn


def dicom2nii(item, path_data_dicom):
    series_instance_uid, paths_dicoms = item

    # Create temporary folder (don't use context manager - keep files until processing is done)
    temp_dir = tempfile.mkdtemp()
    path_temp_folder = Path(temp_dir)

    # Copy files to folder
    for path in paths_dicoms:
        copyfile(path_data_dicom / path, path_temp_folder / Path(path).name)

    # Read DICOM files (assuming the paths are for DICOM files)
    img = tio.ScalarImage(path_temp_folder)  # torchio.Image or ScalarImage for medical imaging
    img.load()  # Load into memory

    # Create output folder
    study_uid, series_name = series_instance_uid.split('_', 1)  # WARNING: Assumes no "_" in study_uid

    return series_name, img, temp_dir  # Return temp_dir for cleanup later


def dicom_to_unilateral_nifti(dicom_folder: Path, nifti_output_folder=None):
    """
    Receives a dicom folder in which all dicom files are used to create the according nifti file in a unilateral version.
    If parameter nifti_output_folder is not None, the generated nifti file is saved under the provided path.
    nifti_output_folder will be created in case it does not already exist.
    """
    logger.info(f"Starting DICOM to NIfTI conversion for folder: {dicom_folder}")

    if nifti_output_folder:
        os.makedirs(nifti_output_folder, exist_ok=True)
        logger.info(f"Created output folder: {nifti_output_folder}")

    # Read all Dicoms
    logger.info("Reading DICOM metadata...")
    metadata_list = []
    dicom_files = list(dicom_folder.rglob('*.dcm'))
    logger.info(f"Found {len(dicom_files)} DICOM files")

    for path_dcm in dicom_files:
        metadata = read_metadata((path_dcm, dicom_folder))
        metadata_list.append(metadata)

    # Create DataFrame
    metadata_list = [m for m in metadata_list if m is not None]
    logger.info(f"Successfully read metadata from {len(metadata_list)} DICOM files")

    if not metadata_list:
        raise ValueError("No valid DICOM metadata could be read")

    df = pd.DataFrame(metadata_list)
    logger.info(f"Created DataFrame with shape: {df.shape}")
    logger.info(f"DataFrame columns: {list(df.columns)}")

    # For T1: separate dynamic
    logger.info("Sorting dynamic sequences...")
    df = sort_dyn(df)  # Will add column '_SequenceName' and '_NumberOfSequences'

    if df is None:
        raise ValueError("Failed to sort dynamic sequences - check TriggerTime metadata")

    df['_SeriesInstanceUID'] = df['SeriesInstanceUID'] + '_' + df['_SequenceName']
    logger.info(f"Found sequences: {df['_SequenceName'].unique().tolist()}")

    # For T2:
    # df['_SeriesInstanceUID'] = df['SeriesInstanceUID']+'_'+"T2"

    target_shape = (512, 512, 32)
    left_right_split = {
        'right': tio.Crop((256, 0, 0, 0, 0, 0)),
        'left': tio.Crop((0, 256, 0, 0, 0, 0)),
    }

    # DICOM to TorchIO
    logger.info("Converting DICOM series to TorchIO images...")
    nifties = {}
    temp_dirs = []  # Track temp directories for cleanup
    series_paths = df.groupby('_SeriesInstanceUID')['_Path'].apply(lambda x: x.to_list())
    logger.info(f"Processing {len(series_paths)} series groups...")

    try:
        for idx, series_path in enumerate(series_paths.items()):
            series_name, img, temp_dir = dicom2nii(series_path, dicom_folder)
            temp_dirs.append(temp_dir)
            logger.info(f"  [{idx+1}/{len(series_paths)}] Converted {series_name}, shape: {img.shape}")

            # Split
            padding_value = img.data.min().item()  # padding_mode='minimum' calcs minimum per axis, but we want it globally
            crop_or_pad = tio.CropOrPad(target_shape, padding_mode=padding_value)
            cropped_img = crop_or_pad(img)
            logger.info(f"    After crop/pad: {cropped_img.shape}")

            # Crop from top and bottom
            thresh = int(np.quantile(cropped_img.data.float(), 0.9))
            foreground_rows = (cropped_img.data > thresh)[0].sum(axis=(0, 2))
            upper_bound = min(max(512 - int(torch.argwhere(foreground_rows).max()) - 10, 0), 256)
            lower_bound = 256 - upper_bound
            height_crop = tio.Crop((0, 0, lower_bound, upper_bound, 0, 0))

            cropped_img = height_crop(cropped_img)
            logger.info(f"    After height crop: {cropped_img.shape}")

            # separate left and right
            for side, side_crop in left_right_split.items():
                image_side = side_crop(cropped_img)
                logger.info(f"    {side} side: {image_side.shape}")

                # from os.walk(): root should be patient folder, dirs is empty and files are all dicom files
                if nifti_output_folder:
                    output_path = f"{nifti_output_folder}/{series_name}_{side}.nii.gz"
                    image_side.save(output_path)
                    logger.info(f"    Saved to: {output_path}")

                nifties[f"{series_name}_{side}"] = image_side

        logger.info(f"Conversion complete. Created {len(nifties)} unilateral NIfTI images: {list(nifties.keys())}")

    finally:
        # Clean up temporary directories
        for temp_dir in temp_dirs:
            try:
                shutil.rmtree(temp_dir)
                logger.info(f"Cleaned up temporary directory: {temp_dir}")
            except Exception as e:
                logger.warning(f"Failed to clean up temp directory {temp_dir}: {e}")

    return nifties
