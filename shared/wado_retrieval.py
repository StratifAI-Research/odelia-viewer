"""
WADO-RS retrieval helper for AI models
Single Responsibility: Retrieve DICOM instances via DICOMweb WADO-RS protocol
"""
import io
import logging
from pydicom.dataset import Dataset
from typing import List
from dicomweb_client.api import DICOMwebClient

from .exceptions import DicomRetrievalError

logger = logging.getLogger(__name__)


def retrieve_via_wado_rs(wado_rs_retrieval: List[dict], orthanc_url: str = None) -> List[Dataset]:
    """
    Retrieve DICOM instances via WADO-RS using dicomweb-client

    Args:
        wado_rs_retrieval: List of dicts with:
            - retrieval_url: Full WADO-RS URL or base DICOMweb URL
            - study_uid: StudyInstanceUID
            - series_uid: SeriesInstanceUID
        orthanc_url: Optional Orthanc URL for fallback (not used for WADO-RS)

    Returns:
        List of DICOM datasets (pydicom.Dataset instances)

    Raises:
        DicomRetrievalError: If retrieval fails
    """
    all_datasets = []

    for retrieval_info in wado_rs_retrieval:
        retrieval_url = retrieval_info.get("retrieval_url", "")
        study_uid = retrieval_info.get("study_uid", "")
        series_uid = retrieval_info.get("series_uid", "")

        # Extract base URL from retrieval_url if it's a full WADO-RS URL
        # Expected format: http://host/dicom-web/studies/{study}/series/{series}
        base_url = retrieval_url
        if "/studies/" in retrieval_url:
            base_url = retrieval_url.split("/studies/")[0]

        logger.info(f"Retrieving series {series_uid} via WADO-RS from {base_url}")

        try:
            # Create DICOMweb client
            client = DICOMwebClient(url=base_url)

            # Retrieve all instances in the series
            # Returns List[pydicom.Dataset]
            datasets = client.retrieve_series(
                study_instance_uid=study_uid,
                series_instance_uid=series_uid
            )

            logger.info(f"Retrieved {len(datasets)} instances for series {series_uid}")
            all_datasets.extend(datasets)

        except Exception as e:
            logger.error(f"Error retrieving via WADO-RS: {str(e)}")
            import traceback
            traceback.print_exc()
            raise DicomRetrievalError(f"WADO-RS retrieval failed: {str(e)}") from e

    return all_datasets


def fallback_to_orthanc_rest(series_uid: str, orthanc_url: str) -> List[Dataset]:
    """
    Fallback: Retrieve DICOM instances via Orthanc REST API
    Used for backward compatibility when WADO-RS retrieval fails

    Args:
        series_uid: SeriesInstanceUID
        orthanc_url: Orthanc base URL (e.g., http://orthanc-viewer:8042)

    Returns:
        List of DICOM datasets

    Raises:
        DicomRetrievalError: If retrieval fails
    """
    import requests
    from pydicom import dcmread

    logger.info(f"Falling back to Orthanc REST API for series {series_uid}")

    try:
        # Lookup series ID from UID
        lookup_response = requests.post(
            f"{orthanc_url}/tools/lookup",
            data=series_uid,
            timeout=30
        )

        if lookup_response.status_code != 200:
            raise DicomRetrievalError(f"Error looking up series: {lookup_response.status_code}")

        lookup_result = lookup_response.json()
        series_result = [r for r in lookup_result if r["Type"] == "Series"]

        if not series_result:
            raise DicomRetrievalError(f"Series {series_uid} not found in Orthanc")

        series_id = series_result[0]["ID"]

        # Get instances
        instances_response = requests.get(
            f"{orthanc_url}/series/{series_id}/instances",
            timeout=30
        )

        if instances_response.status_code != 200:
            raise DicomRetrievalError(f"Error getting instances: {instances_response.status_code}")

        instances = instances_response.json()

        # Download each instance
        datasets = []
        for instance in instances:
            instance_id = instance["ID"]
            dicom_response = requests.get(
                f"{orthanc_url}/instances/{instance_id}/file",
                timeout=60
            )

            if dicom_response.status_code == 200:
                ds = dcmread(io.BytesIO(dicom_response.content))
                datasets.append(ds)

        logger.info(f"Retrieved {len(datasets)} instances via REST API fallback")
        return datasets

    except Exception as e:
        logger.error(f"Error in REST API fallback: {str(e)}")
        import traceback
        traceback.print_exc()
        raise DicomRetrievalError(f"REST API fallback failed: {str(e)}") from e
