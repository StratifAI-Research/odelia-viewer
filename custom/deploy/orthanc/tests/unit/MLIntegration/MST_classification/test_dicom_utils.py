"""Tests for MST-classification/dicom_utils.py.

SimpleITK is stubbed via sys.modules before any import of dicom_utils,
since it imports `import SimpleITK as sitk` at module level and uses
sitk.Image as a type annotation at parse time.
"""
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch
import numpy as np
import pytest


def _build_sitk_stub():
    """Return a minimal SimpleITK stub sufficient for dicom_utils tests."""
    sitk = types.ModuleType("SimpleITK")
    # Image must exist for type annotation -> sitk.Image to resolve
    sitk.Image = MagicMock()

    def make_file_reader():
        reader = MagicMock()
        reader.HasMetaDataKey.return_value = False
        reader.GetMetaData.return_value = "0"
        return reader

    def make_series_reader():
        reader = MagicMock()
        reader.GetGDCMSeriesFileNames.return_value = ["file1.dcm", "file2.dcm"]
        mock_img = MagicMock()
        mock_img.GetSize.return_value = (64, 64, 10)
        mock_img.GetSpacing.return_value = (1.0, 1.0, 2.0)
        mock_img.GetDirection.return_value = (1, 0, 0, 0, 1, 0, 0, 0, 1)
        reader.Execute.return_value = mock_img
        return reader

    sitk.ImageFileReader = MagicMock(side_effect=lambda: make_file_reader())
    sitk.ImageSeriesReader = MagicMock(side_effect=lambda: make_series_reader())
    sitk.GetArrayFromImage = MagicMock(
        return_value=np.ones((10, 64, 64), dtype=np.float32)
    )
    mock_result_img = MagicMock()
    sitk.GetImageFromArray = MagicMock(return_value=mock_result_img)
    sitk.WriteImage = MagicMock()
    sitk.ReadImage = MagicMock(return_value=mock_result_img)
    return sitk


@pytest.fixture(autouse=True)
def _stub_sitk(monkeypatch):
    stub = _build_sitk_stub()
    monkeypatch.setitem(sys.modules, "SimpleITK", stub)
    sys.modules.pop("dicom_utils", None)
    yield stub


def test_dicom_to_nifti_single_phase_calls_write_image(tmp_path, _stub_sitk):
    import dicom_utils
    for i in range(3):
        (tmp_path / f"{i}.dcm").write_bytes(b"fake")
    result = dicom_utils.dicom_to_nifti(str(tmp_path))
    import SimpleITK as sitk
    assert sitk.WriteImage.called
    assert result.endswith(".nii.gz")


def test_dicom_to_nifti_returns_string(tmp_path, _stub_sitk):
    import dicom_utils
    for i in range(2):
        (tmp_path / f"{i}.dcm").write_bytes(b"fake")
    result = dicom_utils.dicom_to_nifti(str(tmp_path))
    assert isinstance(result, str)


def test_dicom_to_nifti_raises_on_empty_folder(tmp_path, _stub_sitk):
    import dicom_utils
    with pytest.raises(ValueError, match="No DICOM files"):
        dicom_utils.dicom_to_nifti(str(tmp_path))


def test_dicom_to_nifti_subtraction_raises_with_single_phase(tmp_path, _stub_sitk):
    import dicom_utils
    (tmp_path / "a.dcm").write_bytes(b"fake")
    with pytest.raises(ValueError, match="at least 2 temporal phases"):
        dicom_utils.dicom_to_nifti_subtraction(str(tmp_path))


def test_compute_subtraction_from_nifti_calls_read_image(tmp_path, _stub_sitk):
    import dicom_utils
    import SimpleITK as sitk
    pre = str(tmp_path / "pre.nii.gz")
    post = str(tmp_path / "post.nii.gz")
    out = str(tmp_path / "sub.nii.gz")
    result = dicom_utils.compute_subtraction_from_nifti(pre, post, out)
    assert sitk.ReadImage.call_count == 2
    assert sitk.WriteImage.called
    assert result == out


def test_compute_subtraction_from_nifti_default_output_path(tmp_path, _stub_sitk):
    import dicom_utils
    pre = str(tmp_path / "pre.nii.gz")
    post = str(tmp_path / "post.nii.gz")
    result = dicom_utils.compute_subtraction_from_nifti(pre, post)
    assert "mri_subtraction.nii.gz" in result
    assert str(tmp_path) in result


def test_compute_subtraction_array_floors_to_zero(_stub_sitk):
    import dicom_utils
    import SimpleITK as sitk
    pre_arr = np.array([[[10, 20], [30, 40]]], dtype=np.float32)
    post_arr = np.array([[[5, 25], [25, 45]]], dtype=np.float32)
    sitk.GetArrayFromImage.side_effect = [pre_arr, post_arr]
    pre_img = MagicMock()
    post_img = MagicMock()
    result = dicom_utils._compute_subtraction_array(pre_img, post_img)
    assert result.min() >= 0
    assert result.dtype == np.uint16
