from flask import Flask, request, jsonify
from flask_cors import CORS
from pathlib import Path
import os
import requests
import torch
import torchio as tio
import numpy as np
from torchio import Subject, Image
from monai.networks import nets
from typing import Union, Tuple
from torchio.transforms.transform import TypeMaskingMethod
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

from dicom2nfti_onthefly import dicom_to_unilateral_nifti

import shutil
import logging

# Set up logging to stdout for Docker compatibility
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Configuration ---
ORTHANC_URL = os.getenv("ORTHANC_URL", "http://orthanc:8042")  # Default if not set
IMAGE_FOLDER = os.getenv("IMAGE_FOLDER", "./images")
MRI_MODEL_PATH = os.getenv("MODEL_PATH", "./models/resnet18_abrv_b=32_split0-0.pth")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
os.makedirs(IMAGE_FOLDER, exist_ok=True)
# --- Augmentations and Transforms ---

class ImageToTensor:
    def __call__(self, image: Image):
        return image.data.swapaxes(1, -1)

def parse_per_channel(per_channel, channels):
    return [(ch,) for ch in range(channels)] if per_channel else [tuple(range(channels))]

class ZNormalization(tio.ZNormalization):
    def __init__(self, percentiles: Union[float, Tuple[float, float]] = (0, 100), per_channel=True,
                 masking_method: TypeMaskingMethod = None, **kwargs):
        super().__init__(masking_method=masking_method, **kwargs)
        self.percentiles = percentiles
        self.per_channel = per_channel

    def apply_normalization(self, subject: Subject, image_name: str, mask: torch.Tensor) -> None:
        image = subject[image_name]
        per_channel = parse_per_channel(self.per_channel, image.shape[0])
        image.set_data(torch.cat([
            self._znorm(image.data[chs,], mask[chs,], image_name, image.path)
            for chs in per_channel])
        )

    def _znorm(self, image_data, mask, image_name, image_path):
        cutoff = torch.quantile(image_data.masked_select(mask).float(), torch.tensor(self.percentiles) / 100.0)
        torch.clamp(image_data, *cutoff.to(image_data.dtype).tolist(), out=image_data)
        standardized = self.znorm(image_data, mask)
        if standardized is None:
            raise RuntimeError(f'Standard deviation is 0 for masked values in image "{image_name}" ({image_path})')
        return standardized

class RandomCropOrPad(tio.CropOrPad):
    @staticmethod
    def _get_six_bounds_parameters(parameters: np.ndarray):
        return tuple(np.random.randint(0, size + 1) for size in parameters for _ in (0, 1))

# --- Load Model ---

def load_model():
    model = nets.ResNet("basic", [2, 2, 2, 2], [64, 128, 256, 512], n_input_channels=2, num_classes=1)
    #checkpoint = torch.load(MRI_MODEL_PATH, map_location=torch.device(DEVICE))
    #model.load_state_dict(checkpoint)
    model.to(DEVICE)
    model.eval()
    return model

mri_model = load_model()

# --- Flask App Setup ---

app = Flask(__name__)
CORS(app)

# --- Helper Functions ---

def get_series_id_by_uid(series_uid: str):
    response = requests.get(f"{ORTHANC_URL}/series", verify=False)
    response.raise_for_status()
    for series_id in response.json():
        details = requests.get(f"{ORTHANC_URL}/series/{series_id}", verify=False).json()
        if details.get("MainDicomTags", {}).get("SeriesInstanceUID") == series_uid:
            return series_id
    return None

from concurrent.futures import ThreadPoolExecutor, as_completed

def download_series_dicom(series_id: str, series_uid: str) -> str:
    """
    Downloads all instances in the series and stores them in a subfolder named after series_uid.
    If the series folder already exists, it does not create a new one.

    Returns the path to the existing or newly created subdirectory.
    """
    logger.info(f"Preparing to download DICOM series: {series_uid}")

    # Check if the folder already exists
    series_folder = os.path.join(IMAGE_FOLDER, series_uid)
    if os.path.exists(series_folder):
        logger.info(f"Series folder already exists: {series_folder}")
    else:
        # Cleanup: remove all existing subfolders in LOCAL_DICOM_FOLDER (if not found)
        for item in os.listdir(IMAGE_FOLDER):
            item_path = os.path.join(IMAGE_FOLDER, item)
            if os.path.isdir(item_path):
                logger.info(f"Removing old series folder: {item_path}")
                shutil.rmtree(item_path)


        os.makedirs(series_folder, exist_ok=True)
        logger.info(f"Created series folder: {series_folder}")

    # Download DICOM instances
    response = requests.get(f"{ORTHANC_URL}/series/{series_id}/instances", verify=False)
    response.raise_for_status()
    instances = response.json()

    if not instances:
        raise ValueError("No instances found for the given series")

    for idx, instance in enumerate(instances):
        instance_id = instance["ID"]
        logger.debug(f"Downloading instance {idx + 1}/{len(instances)}: {instance_id}")
        dicom_data = requests.get(f"{ORTHANC_URL}/instances/{instance_id}/file", verify=False).content
        dicom_path = os.path.join(series_folder, f"instance_{idx + 1}.dcm")
        with open(dicom_path, "wb") as f:
            f.write(dicom_data)

    logger.info(f"Successfully downloaded {len(instances)} DICOM files to {series_folder}")
    return series_folder



def get_preprocessing():
    return tio.Compose([
        RandomCropOrPad((256, 256, 32)),
        ZNormalization(per_channel=True, percentiles=(0.5, 99.5), masking_method=lambda x: x > 0),
        ImageToTensor()
    ])

# --- Flask Route ---

@app.route("/analyze/mri", methods=["POST"])
def analyze_mri():
    overall_start = time.time()
    series_uid = str(request.json.get("seriesInstanceUID", ""))
    if not series_uid:
        logger.error("No seriesInstanceUID provided in request")
        return jsonify({"error": "No seriesInstanceUID provided"}), 400

    try:
        logger.info(f"Starting MRI analysis for series: {series_uid}")

        # Step 1: Find series in Orthanc
        logger.info("Step 1: Looking up series in Orthanc...")
        step_start = time.time()
        series_id = get_series_id_by_uid(series_uid)
        step_duration = (time.time() - step_start) * 1000
        logger.info(f"TIMING: lookup_series_in_orthanc: {step_duration:.2f}ms")

        if not series_id:
            logger.error(f"SeriesInstanceUID not found in Orthanc: {series_uid}")
            return jsonify({"error": "SeriesInstanceUID not found in Orthanc"}), 404
        logger.info(f"Found series ID: {series_id}")

        # Step 2: Download DICOM files
        logger.info("Step 2: Downloading DICOM files...")
        step_start = time.time()
        dicom_folder = download_series_dicom(series_id, series_uid)
        step_duration = (time.time() - step_start) * 1000
        logger.info(f"TIMING: download_dicom_files: {step_duration:.2f}ms")

        if not dicom_folder:
            logger.error("No instances found for the given SeriesInstanceUID")
            return jsonify({"error": "No instances found for the given SeriesInstanceUID"}), 404
        logger.info(f"DICOM files downloaded to: {dicom_folder}")

        # Step 3: Convert DICOM to NIfTI
        logger.info("Step 3: Converting DICOM to NIfTI...")
        step_start = time.time()
        try:
            nifties = dicom_to_unilateral_nifti(Path(dicom_folder), Path(f"{dicom_folder}/nifti/Dynamic_T1"))
            step_duration = (time.time() - step_start) * 1000
            logger.info(f"TIMING: dicom_to_nifti_conversion: {step_duration:.2f}ms")
            logger.info(f"Successfully converted to NIfTI. Available images: {list(nifties.keys())}")
        except Exception as e:
            logger.error(f"Failed to convert DICOM to NIfTI: {str(e)}", exc_info=True)
            return jsonify({"error": f"DICOM to NIfTI conversion failed: {str(e)}"}), 500

        # Step 4: Prepare preprocessing
        logger.info("Step 4: Preparing preprocessing transforms...")
        step_start = time.time()
        transform = get_preprocessing()
        step_duration = (time.time() - step_start) * 1000
        logger.info(f"TIMING: prepare_preprocessing: {step_duration:.2f}ms")

        # Step 5: Process each side
        results = {}
        for side in ["left", "right"]:
            logger.info(f"Step 5.{side}: Processing {side} breast...")
            side_start = time.time()
            try:
                # Check if required images exist
                pre_key = f"Pre_{side}"
                post_key = f"Post_1_{side}"

                if pre_key not in nifties:
                    logger.error(f"Missing {pre_key} in converted NIfTI images")
                    results[side] = {"error": f"Missing Pre contrast image for {side} side"}
                    continue

                if post_key not in nifties:
                    logger.error(f"Missing {post_key} in converted NIfTI images")
                    results[side] = {"error": f"Missing Post contrast image for {side} side"}
                    continue

                pre = nifties[pre_key]
                post = nifties[post_key]
                logger.info(f"  {side}: Pre shape={pre.data.shape}, Post shape={post.data.shape}")

                # Concatenate and preprocess
                preprocess_start = time.time()
                model_input = torch.cat((pre.data, post.data), dim=0)
                logger.info(f"  {side}: Combined input shape={model_input.shape}")

                model_input = transform(model_input)[None].to(DEVICE)
                preprocess_duration = (time.time() - preprocess_start) * 1000
                logger.info(f"TIMING: {side}_preprocessing: {preprocess_duration:.2f}ms")
                logger.info(f"  {side}: After preprocessing shape={model_input.shape}")

                # Run inference
                inference_start = time.time()
                with torch.inference_mode():
                    prob = torch.sigmoid(mri_model(model_input)).item()
                inference_duration = (time.time() - inference_start) * 1000
                logger.info(f"TIMING: {side}_inference: {inference_duration:.2f}ms")

                logger.info(f"  {side}: Model output probability={prob:.4f}")
                results[side] = {
                    "prediction": "Cancerous" if prob > 0.5 else "Not Cancerous",
                    "confidence": round(prob if prob > 0.5 else 1 - prob, 4)*100,
                }

                side_duration = (time.time() - side_start) * 1000
                logger.info(f"TIMING: {side}_total: {side_duration:.2f}ms")
                logger.info(f"  {side}: Result={results[side]}")

            except KeyError as e:
                side_duration = (time.time() - side_start) * 1000
                logger.info(f"TIMING: {side}_total_error: {side_duration:.2f}ms")
                logger.error(f"Missing data for {side} side: {e}", exc_info=True)
                results[side] = {"error": f"Missing data for {side} side: {e}"}
            except Exception as e:
                side_duration = (time.time() - side_start) * 1000
                logger.info(f"TIMING: {side}_total_error: {side_duration:.2f}ms")
                logger.error(f"Error processing {side} side: {e}", exc_info=True)
                results[side] = {"error": f"Processing error for {side} side: {str(e)}"}

        overall_duration = (time.time() - overall_start) * 1000
        logger.info(f"TIMING: total_analysis: {overall_duration:.2f}ms")
        logger.info(f"Analysis complete. Final results: {results}")
        return jsonify(results)

    except Exception as e:
        logger.error(f"Unexpected error during MRI analysis: {str(e)}", exc_info=True)
        return jsonify({"error": f"Analysis failed: {str(e)}"}), 500

# --- Main ---

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5555, debug=False, use_reloader=False)
