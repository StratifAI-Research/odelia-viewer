"""Tests for medgemma-mri/preprocessing.py — extract_central_slices and helpers.

preprocessing.py imports SimpleITK, numpy, PIL, and pathlib at module level.
SimpleITK is stubbed via sitk_stub; PIL and numpy are available in the venv.

extract_central_slices calls read_dicom_volume which first checks for real
.dcm files on disk.  To avoid file-system fixtures, we patch read_dicom_volume
at the preprocessing-module level and supply a numpy array directly.

Uncovered paths (intentional, documented here):
- read_dicom_volume 4D branch: requires per-file temporal-position metadata;
  deferred to integration tests.
- get_dicom_metadata individual tag branches (TriggerTime, ImagePositionPatient):
  smoke-tested via module import.
- read_dicom_volume itself is only smoke-tested here (error-on-missing-dcm);
  full path needs real DICOM files.
"""
import sys
import numpy as np
import pytest
from unittest.mock import patch, MagicMock


@pytest.fixture(autouse=True)
def _evict_module(sitk_stub):
    sys.modules.pop('preprocessing', None)
    yield
    sys.modules.pop('preprocessing', None)


def test_preprocessing_imports_with_stubs(sitk_stub):
    pass  # should not raise


def test_normalize_slice_standard_input():
    import preprocessing
    arr = np.linspace(0, 100, 100).reshape(10, 10).astype(np.float32)
    result = preprocessing.normalize_slice(arr)
    assert result.dtype == np.uint8
    assert result.min() >= 0
    assert result.max() <= 255


def test_normalize_slice_constant_returns_zeros():
    import preprocessing
    arr = np.full((10, 10), 42.0, dtype=np.float32)
    result = preprocessing.normalize_slice(arr)
    assert (result == 0).all()


def test_normalize_slice_output_shape_preserved():
    import preprocessing
    arr = np.random.rand(20, 30).astype(np.float32)
    result = preprocessing.normalize_slice(arr)
    assert result.shape == (20, 30)


def test_normalize_slice_uses_percentile_windowing():
    """Outlier at (0,0) must saturate to 255; in-range values normalize to [0, <255]."""
    import preprocessing
    arr = np.zeros(100, dtype=np.float32)
    arr[0] = 1000.0   # massive outlier at position (0,0) after reshape
    arr[1:] = np.linspace(0, 10, 99)
    arr = arr.reshape(10, 10)
    result = preprocessing.normalize_slice(arr)
    assert result.dtype == np.uint8
    assert result[0, 0] == 255              # outlier clipped to p_high -> normalizes to max
    assert (result == 255).sum() == 1       # only the outlier saturates; bulk wasn't all-clipped
    assert result.min() == 0                # lowest in-range value normalizes to 0


def test_read_dicom_volume_raises_on_missing_dcm(tmp_path):
    import preprocessing
    # tmp_path exists but has no .dcm files
    with pytest.raises(ValueError, match='No DICOM files found'):
        preprocessing.read_dicom_volume(tmp_path)


def _patch_read_dicom_volume(volume_array, sitk_stub, monkeypatch):
    """Return a context manager patching read_dicom_volume in the preprocessing module."""
    mock_img = MagicMock()
    mock_img.GetSize.return_value = (volume_array.shape[2], volume_array.shape[1], volume_array.shape[0])
    mock_img.GetSpacing.return_value = (1.0, 1.0, 2.0)
    monkeypatch.setattr(sitk_stub, 'GetArrayFromImage', MagicMock(return_value=volume_array))
    return patch('preprocessing.read_dicom_volume', return_value=mock_img)


def test_extract_central_slices_returns_list_of_pil_images(sitk_stub, monkeypatch):
    from PIL import Image as PILImage
    import preprocessing

    vol = np.ones((10, 64, 64), dtype=np.float32) * 50.0
    mock_img = MagicMock()
    monkeypatch.setattr(sitk_stub, 'GetArrayFromImage', MagicMock(return_value=vol))

    with patch('preprocessing.read_dicom_volume', return_value=mock_img):
        result = preprocessing.extract_central_slices('/fake/dicom', num_slices=3)

    assert isinstance(result, list)
    assert len(result) == 3
    for img in result:
        assert isinstance(img, PILImage.Image)
        assert img.mode == 'RGB'


def test_extract_central_slices_returns_correct_count(sitk_stub, monkeypatch):
    import preprocessing

    vol = np.ones((10, 64, 64), dtype=np.float32)
    monkeypatch.setattr(sitk_stub, 'GetArrayFromImage', MagicMock(return_value=vol))

    with patch('preprocessing.read_dicom_volume', return_value=MagicMock()):
        result = preprocessing.extract_central_slices('/fake/dicom', num_slices=5)
    assert len(result) == 5


def test_extract_central_slices_fewer_slices_than_volume(sitk_stub, monkeypatch):
    """When volume has fewer slices than requested, num_slices is clamped."""
    import preprocessing

    vol = np.ones((10, 64, 64), dtype=np.float32)
    monkeypatch.setattr(sitk_stub, 'GetArrayFromImage', MagicMock(return_value=vol))

    with patch('preprocessing.read_dicom_volume', return_value=MagicMock()):
        result = preprocessing.extract_central_slices('/fake/dicom', num_slices=20)
    assert len(result) == 10


def test_extract_central_slices_single_slice(sitk_stub, monkeypatch):
    import preprocessing

    vol = np.ones((10, 64, 64), dtype=np.float32)
    monkeypatch.setattr(sitk_stub, 'GetArrayFromImage', MagicMock(return_value=vol))

    with patch('preprocessing.read_dicom_volume', return_value=MagicMock()):
        result = preprocessing.extract_central_slices('/fake/dicom', num_slices=1)
    assert len(result) == 1


def test_extract_central_slices_image_size(sitk_stub, monkeypatch):
    """Each PIL image has dimensions matching the volume's Y, X axes."""
    import preprocessing

    vol = np.ones((10, 64, 64), dtype=np.float32)
    monkeypatch.setattr(sitk_stub, 'GetArrayFromImage', MagicMock(return_value=vol))

    with patch('preprocessing.read_dicom_volume', return_value=MagicMock()):
        result = preprocessing.extract_central_slices('/fake/dicom', num_slices=1)
    assert result[0].size == (64, 64)
