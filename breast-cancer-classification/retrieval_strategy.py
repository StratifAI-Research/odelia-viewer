"""
Retrieval strategies for DICOM data
Implements Strategy pattern for different retrieval methods
"""
import logging
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Tuple

from shared.orthanc_client import OrthancClient
from shared.wado_retrieval import retrieve_via_wado_rs
from shared.dicom_storage import save_datasets_to_folder, save_dicom_bytes_to_folder
from shared.config import OrthancConfig, StorageConfig

logger = logging.getLogger(__name__)


class RetrievalStrategy(ABC):
    """Abstract base class for DICOM retrieval strategies"""

    @abstractmethod
    def retrieve(self) -> Tuple[Path, str]:
        """
        Retrieve DICOM data

        Returns:
            Tuple of (dicom_folder_path, series_uid)
        """
        pass


class WadoRSRetrieval(RetrievalStrategy):
    """WADO-RS retrieval strategy (preferred method)"""

    def __init__(self, wado_rs_retrieval: list, orthanc_config: OrthancConfig, storage_config: StorageConfig):
        """
        Initialize WADO-RS retrieval

        Args:
            wado_rs_retrieval: List of dicts with retrieval_url, study_uid, series_uid
            orthanc_config: Orthanc configuration
            storage_config: Storage configuration
        """
        self.wado_rs_retrieval = wado_rs_retrieval
        self.orthanc_config = orthanc_config
        self.storage_config = storage_config

    def retrieve(self) -> Tuple[Path, str]:
        """
        Retrieve DICOM via WADO-RS

        Returns:
            Tuple of (dicom_folder_path, series_uid)
        """
        logger.info("Using WADO-RS retrieval (preferred method)")

        # Retrieve DICOM datasets
        datasets = retrieve_via_wado_rs(self.wado_rs_retrieval, orthanc_url=self.orthanc_config.url)

        if not datasets:
            raise ValueError("No DICOM instances retrieved via WADO-RS")

        # Extract series UID from first dataset
        series_uid = str(datasets[0].SeriesInstanceUID)
        logger.info(f"Retrieved {len(datasets)} DICOM instances for series {series_uid}")

        # Save datasets to disk
        dicom_folder = save_datasets_to_folder(datasets, series_uid, self.storage_config)

        return dicom_folder, series_uid


class LegacyOrthancRetrieval(RetrievalStrategy):
    """Legacy Orthanc REST API retrieval (deprecated)"""

    def __init__(self, series_uid: str, orthanc_config: OrthancConfig, storage_config: StorageConfig):
        """
        Initialize legacy Orthanc retrieval

        Args:
            series_uid: DICOM SeriesInstanceUID
            orthanc_config: Orthanc configuration
            storage_config: Storage configuration
        """
        self.series_uid = series_uid
        self.orthanc_config = orthanc_config
        self.storage_config = storage_config

    def retrieve(self) -> Tuple[Path, str]:
        """
        Retrieve DICOM via legacy Orthanc REST API

        Returns:
            Tuple of (dicom_folder_path, series_uid)
        """
        logger.warning("DEPRECATED: Legacy seriesInstanceUID format. Use wado_rs_retrieval instead.")
        logger.info(f"Using legacy Orthanc REST API for series: {self.series_uid}")

        # Get series ID from Orthanc
        client = OrthancClient(self.orthanc_config)
        series_id = client.get_series_id_by_uid(self.series_uid)
        logger.info(f"Found series ID: {series_id}")

        # Download DICOM files
        dicom_files = client.download_series_instances(series_id)

        # Save to disk
        dicom_folder = save_dicom_bytes_to_folder(dicom_files, self.series_uid, self.storage_config)

        return dicom_folder, self.series_uid
