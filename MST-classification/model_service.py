"""
MST Model Service - Orchestrates the entire inference pipeline
Single Responsibility: Model orchestration and inference
"""
import logging
import sys
import torch
from pathlib import Path
from typing import Optional, Tuple

from shared.timing_utils import time_operation
from shared.config import OrthancConfig, StorageConfig

from config import MSTConfig
from exceptions import ModelNotLoadedError, InferenceError
from model_loader import load_model as load_mst_model, download_model_files
from dicom_converter import convert_series_to_nifti
from preprocessing import prepare_for_inference, generate_attention_overlays
from response_builder import build_bilateral_response
from retrieval_strategy import RetrievalStrategy, WadoRSRetrieval, LegacyOrthancRetrieval

logger = logging.getLogger(__name__)


class MSTModelService:
    """Service for MST model inference"""

    def __init__(self, mst_config: MSTConfig, orthanc_config: OrthancConfig, storage_config: StorageConfig):
        """
        Initialize MST model service

        Args:
            mst_config: MST service configuration
            orthanc_config: Orthanc connection configuration
            storage_config: Storage configuration
        """
        self.mst_config = mst_config
        self.orthanc_config = orthanc_config
        self.storage_config = storage_config
        self.model = None
        self.predict_fn = None
        self.model_info = None

    def initialize_model(self) -> None:
        """Download and load model on startup"""
        try:
            logger.info("=" * 60)
            logger.info("MST Classification Service - Initializing")
            logger.info("=" * 60)

            # Download model files if not already present
            logger.info(f"Checking model files in {self.mst_config.model_path}")
            required_files = ["models.py", "predict_attention.py", "state_dict.pt", "model_config.json"]
            files_exist = all(
                (self.mst_config.model_path / f).exists()
                for f in required_files
            )

            if not files_exist:
                logger.info("Model files not found, downloading from HuggingFace...")
                download_model_files()
            else:
                logger.info("Model files already present, skipping download")

            # Load model
            logger.info(f"Loading model on device: {self.mst_config.device}")
            self.model, self.predict_fn, self.model_info = load_mst_model()

            # Move model to device
            if self.model is not None:
                self.model = self.model.to(self.mst_config.device)
                logger.info(f"Model loaded successfully on {self.mst_config.device}")
                logger.info(f"  Model: {self.model_info['model_name']}")
                logger.info(f"  Architecture: {self.model_info['architecture']}")

            logger.info("=" * 60)
            logger.info("Service ready to accept requests")
            logger.info("=" * 60)

        except Exception as e:
            logger.error(f"Failed to initialize model: {e}")
            import traceback
            traceback.print_exc()
            raise

    def analyze_mri_series(self, request_data: dict) -> dict:
        """
        Analyze MRI series using MST model

        Args:
            request_data: Request dictionary with either:
                - wado_rs_retrieval: List of WADO-RS retrieval info (preferred)
                - seriesInstanceUID: Legacy format

        Returns:
            Analysis result dictionary with bilateral classification and attention maps

        Raises:
            ModelNotLoadedError: If model is not loaded
            InferenceError: If analysis fails
        """
        if self.model is None:
            raise ModelNotLoadedError("Model not loaded")

        try:
            # Step 1: Retrieve DICOM data using appropriate strategy
            with time_operation("retrieve_dicom", logger):
                retrieval_strategy = self._create_retrieval_strategy(request_data)
                dicom_folder, series_uid = retrieval_strategy.retrieve()

            # Step 2: Convert DICOM to NIfTI
            with time_operation("dicom_to_nifti_conversion", logger):
                nifti_path = convert_series_to_nifti(dicom_folder)

            # Step 3: Prepare for inference
            with time_operation("load_nifti_as_torchio", logger):
                img = prepare_for_inference(nifti_path, self.mst_config.model_path)

            # Step 4: Run inference
            with time_operation("model_inference", logger):
                probs, weight = self._run_inference(img)

            logger.info(f"Inference complete")
            logger.info(f"  Left breast probabilities: {probs['left']}")
            logger.info(f"  Right breast probabilities: {probs['right']}")

            # Step 5: Generate attention overlays
            with time_operation("generate_attention_maps_total", logger):
                attention_maps = generate_attention_overlays(
                    img.data,
                    weight.data,
                    self.mst_config.model_path
                )

            # Step 6: Build response
            response = build_bilateral_response(probs, attention_maps, self.model_info)

            return response

        except Exception as e:
            logger.error(f"Error during MRI analysis: {e}")
            import traceback
            traceback.print_exc()
            raise InferenceError(f"Analysis failed: {str(e)}") from e

    def _create_retrieval_strategy(self, request_data: dict) -> RetrievalStrategy:
        """
        Create appropriate retrieval strategy based on request format

        Args:
            request_data: Request dictionary

        Returns:
            RetrievalStrategy instance
        """
        wado_rs_retrieval = request_data.get("wado_rs_retrieval")
        series_uid_legacy = request_data.get("seriesInstanceUID")

        if wado_rs_retrieval:
            return WadoRSRetrieval(
                wado_rs_retrieval,
                self.orthanc_config,
                self.storage_config
            )
        elif series_uid_legacy:
            return LegacyOrthancRetrieval(
                series_uid_legacy,
                self.orthanc_config,
                self.storage_config
            )
        else:
            raise ValueError("No seriesInstanceUID or wado_rs_retrieval provided")

    def _run_inference(self, img) -> Tuple[dict, any]:
        """
        Run MST model inference

        Args:
            img: TorchIO ScalarImage

        Returns:
            Tuple of (probabilities_dict, weight_image)
        """
        # Add model path to sys.path to import the reference implementation
        if str(self.mst_config.model_path) not in sys.path:
            sys.path.insert(0, str(self.mst_config.model_path))

        from predict_attention import run_prediction

        with torch.no_grad():
            probs, weight = run_prediction(img, self.model)

        return probs, weight

    def get_health_status(self) -> dict:
        """
        Get service health status

        Returns:
            Dictionary with health information
        """
        return {
            "status": "healthy",
            "model_loaded": self.model is not None,
            "device": self.mst_config.device,
            "model_info": self.model_info if self.model_info else None
        }
