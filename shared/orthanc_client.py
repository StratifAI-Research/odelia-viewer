"""
Orthanc REST API client
Single Responsibility: Communication with Orthanc server
"""
import logging
from typing import Optional, List
import requests

from .config import OrthancConfig
from .exceptions import OrthancCommunicationError, SeriesNotFoundError

logger = logging.getLogger(__name__)


class OrthancClient:
    """Client for interacting with Orthanc REST API"""

    def __init__(self, config: OrthancConfig):
        """
        Initialize Orthanc client

        Args:
            config: OrthancConfig with server connection details
        """
        self.config = config

    def get_series_id_by_uid(self, series_uid: str) -> str:
        """
        Get Orthanc internal series ID from SeriesInstanceUID

        Args:
            series_uid: DICOM SeriesInstanceUID

        Returns:
            Orthanc internal series ID

        Raises:
            SeriesNotFoundError: If series UID is not found
            OrthancCommunicationError: If communication with Orthanc fails
        """
        try:
            response = requests.get(
                f"{self.config.url}/series",
                verify=self.config.verify_ssl,
                timeout=self.config.timeout
            )
            response.raise_for_status()

            for series_id in response.json():
                details = requests.get(
                    f"{self.config.url}/series/{series_id}",
                    verify=self.config.verify_ssl,
                    timeout=self.config.timeout
                ).json()

                if details.get("MainDicomTags", {}).get("SeriesInstanceUID") == series_uid:
                    logger.info(f"Found series ID {series_id} for UID {series_uid}")
                    return series_id

            raise SeriesNotFoundError(f"Series UID {series_uid} not found in Orthanc")

        except requests.RequestException as e:
            logger.error(f"Error communicating with Orthanc: {e}")
            raise OrthancCommunicationError(f"Failed to lookup series: {e}") from e

    def download_series_instances(self, series_id: str) -> List[bytes]:
        """
        Download all DICOM instances for a series

        Args:
            series_id: Orthanc internal series ID

        Returns:
            List of DICOM file contents as bytes

        Raises:
            OrthancCommunicationError: If download fails
        """
        try:
            response = requests.get(
                f"{self.config.url}/series/{series_id}/instances",
                verify=self.config.verify_ssl,
                timeout=self.config.timeout
            )
            response.raise_for_status()
            instances = response.json()

            if not instances:
                raise ValueError("No instances found for the given series")

            logger.info(f"Downloading {len(instances)} DICOM instances...")

            dicom_files = []
            for instance in instances:
                instance_id = instance["ID"]
                dicom_data = requests.get(
                    f"{self.config.url}/instances/{instance_id}/file",
                    verify=self.config.verify_ssl,
                    timeout=30
                ).content
                dicom_files.append(dicom_data)

            logger.info(f"Downloaded {len(dicom_files)} DICOM files")
            return dicom_files

        except requests.RequestException as e:
            logger.error(f"Error downloading DICOM instances: {e}")
            raise OrthancCommunicationError(f"Failed to download instances: {e}") from e
