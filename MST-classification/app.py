"""
MST Classification Service - Flask microservice for breast MRI classification
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
from pathlib import Path
import os
import sys
import requests
import logging
import shutil
import tempfile
import numpy as np
import torch

from model_loader import download_model_files, load_model
from dicom_utils import dicom_to_nifti

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
ORTHANC_URL = os.getenv("ORTHANC_URL", "http://orthanc:8042")
IMAGE_FOLDER = os.getenv("IMAGE_FOLDER", "./images")
MODEL_PATH = os.getenv("MODEL_PATH", "./mst_model")
HF_TOKEN = os.getenv("HF_TOKEN", None)
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Create necessary directories
os.makedirs(IMAGE_FOLDER, exist_ok=True)
os.makedirs(MODEL_PATH, exist_ok=True)

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Global variables for model
model = None
predict_fn = None
model_info = None

def initialize_model():
    """Download and load model on startup"""
    global model, predict_fn, model_info

    try:
        logger.info("=" * 60)
        logger.info("MST Classification Service - Initializing")
        logger.info("=" * 60)

        # Download model files if not already present
        logger.info(f"Checking model files in {MODEL_PATH}")
        required_files = ["models.py", "predict_attention.py", "state_dict.pt", "model_config.json"]
        files_exist = all(os.path.exists(os.path.join(MODEL_PATH, f)) for f in required_files)

        if not files_exist:
            logger.info("Model files not found, downloading from HuggingFace...")
            download_model_files()
        else:
            logger.info("Model files already present, skipping download")

        # Load model
        logger.info(f"Loading model on device: {DEVICE}")
        model, predict_fn, model_info = load_model()

        # Move model to device
        if model is not None:
            model = model.to(DEVICE)
            logger.info(f"Model loaded successfully on {DEVICE}")
            logger.info(f"  Model: {model_info['model_name']}")
            logger.info(f"  Architecture: {model_info['architecture']}")

        logger.info("=" * 60)
        logger.info("Service ready to accept requests")
        logger.info("=" * 60)

    except Exception as e:
        logger.error(f"Failed to initialize model: {e}")
        import traceback
        traceback.print_exc()
        raise


def get_series_id_by_uid(series_uid: str):
    """Get Orthanc series ID from SeriesInstanceUID"""
    try:
        response = requests.get(f"{ORTHANC_URL}/series", verify=False, timeout=10)
        response.raise_for_status()

        for series_id in response.json():
            details = requests.get(f"{ORTHANC_URL}/series/{series_id}", verify=False, timeout=10).json()
            if details.get("MainDicomTags", {}).get("SeriesInstanceUID") == series_uid:
                return series_id

        return None
    except Exception as e:
        logger.error(f"Error looking up series UID {series_uid}: {e}")
        raise


def download_series_dicom(series_id: str, series_uid: str) -> str:
    """
    Download all DICOM instances for a series from Orthanc

    Args:
        series_id: Orthanc internal series ID
        series_uid: DICOM SeriesInstanceUID

    Returns:
        Path to folder containing DICOM files
    """
    logger.info(f"Downloading DICOM series: {series_uid}")

    # Create unique folder for this series
    series_folder = os.path.join(IMAGE_FOLDER, series_uid)

    # Clean up if exists
    if os.path.exists(series_folder):
        logger.info(f"Removing existing series folder: {series_folder}")
        shutil.rmtree(series_folder)

    os.makedirs(series_folder, exist_ok=True)
    logger.info(f"Created series folder: {series_folder}")

    # Download all instances
    try:
        response = requests.get(
            f"{ORTHANC_URL}/series/{series_id}/instances",
            verify=False,
            timeout=10
        )
        response.raise_for_status()
        instances = response.json()

        if not instances:
            raise ValueError("No instances found for the given series")

        logger.info(f"Downloading {len(instances)} DICOM instances...")

        for idx, instance in enumerate(instances):
            instance_id = instance["ID"]
            dicom_data = requests.get(
                f"{ORTHANC_URL}/instances/{instance_id}/file",
                verify=False,
                timeout=30
            ).content

            dicom_path = os.path.join(series_folder, f"instance_{idx:04d}.dcm")
            with open(dicom_path, "wb") as f:
                f.write(dicom_data)

        logger.info(f"Downloaded {len(instances)} DICOM files to {series_folder}")
        return series_folder

    except Exception as e:
        logger.error(f"Error downloading DICOM series: {e}")
        raise


@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "model_loaded": model is not None,
        "device": DEVICE,
        "model_info": model_info if model_info else None
    })


@app.route("/analyze/mri", methods=["POST"])
def analyze_mri():
    """
    Analyze MRI series using MST model

    Expected input:
    {
        "seriesInstanceUID": "1.2.840.113619.2...."
    }

    Expected output format for server.py (bilateral classification):
    {
        "left": {
            "prediction": "Cancerous" | "Not Cancerous",
            "confidence": 87.5  // percentage
        },
        "right": {
            "prediction": "Cancerous" | "Not Cancerous",
            "confidence": 65.2  // percentage
        },
        "model_metadata": {
            "model_name": "MST",
            "architecture": "Vision Transformer",
            "version": "1.0"
        },
        "attention_maps": [
            {
                "slice_index": 0,
                "data": [[[r,g,b], [r,g,b], ...]]  // RGB overlay image [H, W, 3]
            }
        ]
    }
    """
    if model is None:
        return jsonify({"error": "Model not loaded"}), 503

    # Get series UID from request
    series_uid = request.json.get("seriesInstanceUID", "")
    if not series_uid:
        return jsonify({"error": "No seriesInstanceUID provided"}), 400

    logger.info(f"Received analysis request for series: {series_uid}")

    try:
        # 1. Get series ID from Orthanc
        series_id = get_series_id_by_uid(series_uid)
        if not series_id:
            return jsonify({"error": "SeriesInstanceUID not found in Orthanc"}), 404

        logger.info(f"Found series ID: {series_id}")

        # 2. Download DICOM files
        dicom_folder = download_series_dicom(series_id, series_uid)

        # 3. Convert DICOM to NIfTI
        logger.info("Converting DICOM to NIfTI...")
        nifti_path = dicom_to_nifti(dicom_folder)
        logger.info(f"NIfTI created: {nifti_path}")

        # 4. Run inference using aligned implementation
        logger.info("Running MST inference...")

        # Add model path to sys.path to import the reference implementation
        if MODEL_PATH not in sys.path:
            sys.path.insert(0, MODEL_PATH)

        import torchio as tio
        from predict_attention import run_prediction, minmax_norm, tensor_cam2image

        # Load image as TorchIO ScalarImage
        img = tio.ScalarImage(nifti_path)

        # Run prediction - returns probs dict and weight ScalarImage (aligned with HF repo)
        with torch.no_grad():
            probs, weight = run_prediction(img, model)

        logger.info(f"Inference complete")
        logger.info(f"  Left breast probabilities: {probs['left']}")
        logger.info(f"  Right breast probabilities: {probs['right']}")

        # 5. Format output for server.py - bilateral classification format
        # Extract left/right probabilities (probabilities are already softmaxed in run_prediction)
        # Format: [benign_prob, malignant_prob]
        left_malignant_prob = float(probs['left'][1])
        right_malignant_prob = float(probs['right'][1])

        # Create bilateral classification format matching the viewer's expectations
        # Each side gets its own classification with prediction and confidence
        left_classification = {
            "prediction": "Cancerous" if left_malignant_prob > 0.5 else "Not Cancerous",
            "confidence": left_malignant_prob * 100.0  # Convert to percentage
        }

        right_classification = {
            "prediction": "Cancerous" if right_malignant_prob > 0.5 else "Not Cancerous",
            "confidence": right_malignant_prob * 100.0  # Convert to percentage
        }

        # Store model metadata separately for SR generation
        model_metadata = {
            "model_name": model_info.get("model_name", "MST"),
            "architecture": model_info.get("architecture", "Vision Transformer"),
            "version": model_info.get("version", "1.0")
        }

        # 6. Generate RGB overlay images using tensor_cam2image from HF reference
        # Prepare tensors in the format expected by tensor_cam2image
        # Input format: [B, C, D, H, W] for both img and weight
        img_tensor = img.data.swapaxes(1, -1).unsqueeze(0)  # [1, C, D, H, W]
        weight_tensor = weight.data.swapaxes(1, -1).unsqueeze(0)  # [1, C, D, H, W]

        # Normalize image to [0, 1] for visualization (weight already normalized)
        img_tensor = minmax_norm(img_tensor)
        weight_tensor = minmax_norm(weight_tensor)

        # Generate RGB overlay images (returns [B, 3, H, W] tensor with RGB overlays)
        overlay = tensor_cam2image(img_tensor, weight_tensor, batch=0, alpha=0.5)

        logger.info(f"Generated {overlay.shape[0]} RGB overlay images")

        # Convert overlay to numpy and prepare ALL slices for transmission
        # Convert entire tensor at once: [num_slices, 3, W, H] -> [num_slices, W, H, 3]
        overlay_np = overlay.cpu().numpy()
        overlay_np = np.transpose(overlay_np, (0, 2, 3, 1))  # [num_slices, W, H, 3]

        attention_maps = [
            {
                "slice_index": i,
                "data": overlay_np[i].tolist()  # [W, H, 3]
            }
            for i in range(overlay_np.shape[0])
        ]

        logger.info(f"Prepared {len(attention_maps)} RGB overlay slices for transmission")

        # Return bilateral format matching the expected viewer format
        response = {
            "left": left_classification,
            "right": right_classification,
            "model_metadata": model_metadata,
            "attention_maps": attention_maps
        }

        logger.info(f"Analysis complete - Bilateral Classification:")
        logger.info(f"  Left: {left_classification['prediction']} ({left_classification['confidence']:.1f}%)")
        logger.info(f"  Right: {right_classification['prediction']} ({right_classification['confidence']:.1f}%)")
        logger.info(f"  Returning {len(attention_maps)} RGB overlay slices (MRI + attention heatmap)")

        return jsonify(response)

    except Exception as e:
        logger.error(f"Error during MRI analysis: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    # Initialize model before starting server
    initialize_model()

    # Start Flask server
    logger.info("Starting Flask server on 0.0.0.0:5556")
    app.run(host="0.0.0.0", port=5556, debug=False, use_reloader=False)
