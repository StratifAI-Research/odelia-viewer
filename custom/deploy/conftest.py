"""
Root conftest for custom/deploy tests.
Shared fixtures available to all test modules.
"""
import os
import tempfile

import pytest


@pytest.fixture(scope="session")
def orthanc_viewer_url() -> str:
    return os.environ.get("ORTHANC_VIEWER_BASE_URL", "http://localhost:8000")


@pytest.fixture(scope="session")
def orthanc_router_url() -> str:
    return os.environ.get("ORTHANC_ROUTER_BASE_URL", "http://localhost:8042")


@pytest.fixture()
def tmp_image_dir(tmp_path):
    """Temporary directory for DICOM image storage during tests."""
    img_dir = tmp_path / "images"
    img_dir.mkdir()
    return img_dir


@pytest.fixture()
def mock_dicom_dataset():
    """Minimal pydicom Dataset for testing without real DICOM files."""
    try:
        from pydicom.dataset import Dataset
        from pydicom.uid import generate_uid

        ds = Dataset()
        ds.PatientName = "Test^Patient"
        ds.PatientID = "TEST001"
        ds.StudyInstanceUID = generate_uid()
        ds.SeriesInstanceUID = generate_uid()
        ds.SOPInstanceUID = generate_uid()
        ds.Modality = "MR"
        ds.Rows = 64
        ds.Columns = 64
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 0
        ds.SamplesPerPixel = 1
        return ds
    except ImportError:
        pytest.skip("pydicom not installed")
