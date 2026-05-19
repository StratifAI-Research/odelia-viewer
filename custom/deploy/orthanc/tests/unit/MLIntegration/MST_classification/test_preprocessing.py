"""Tests for MST-classification/preprocessing.py.

preprocessing.py imports torch at module level.
We stub torch (and torchio) before importing the module.
"""
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch
import numpy as np
import pytest


def _build_torch_stub():
    """Minimal torch stub for preprocessing.py."""
    torch_stub = types.ModuleType('torch')
    # Tensor class stub
    mock_tensor = MagicMock()
    mock_tensor.swapaxes.return_value = mock_tensor
    mock_tensor.unsqueeze.return_value = mock_tensor
    mock_tensor.cpu.return_value = mock_tensor
    mock_tensor.numpy.return_value = np.zeros((5, 3, 16, 16), dtype=np.float32)
    torch_stub.Tensor = MagicMock(return_value=mock_tensor)
    return torch_stub


def _build_torchio_stub():
    tio = types.ModuleType('torchio')
    mock_img = MagicMock()
    tio.ScalarImage = MagicMock(return_value=mock_img)
    return tio


@pytest.fixture(autouse=True)
def _stub_heavy_deps(monkeypatch):
    torch_stub = _build_torch_stub()
    tio_stub = _build_torchio_stub()
    monkeypatch.setitem(sys.modules, 'torch', torch_stub)
    monkeypatch.setitem(sys.modules, 'torchio', tio_stub)
    sys.modules.pop('preprocessing', None)
    yield torch_stub, tio_stub


def test_prepare_for_inference_returns_scalar_image(tmp_path, _stub_heavy_deps):
    """prepare_for_inference should call tio.ScalarImage and return its result."""
    _, tio_stub = _stub_heavy_deps
    nifti_path = tmp_path / 'img.nii.gz'
    nifti_path.touch()
    model_path = tmp_path / 'model'
    model_path.mkdir()

    import preprocessing
    result = preprocessing.prepare_for_inference(nifti_path, model_path)

    tio_stub.ScalarImage.assert_called_once_with(str(nifti_path))
    assert result is tio_stub.ScalarImage.return_value


def test_prepare_for_inference_adds_model_path_to_sys_path(tmp_path, _stub_heavy_deps):
    """model_path must be added to sys.path so the reference impl can be found."""
    nifti_path = tmp_path / 'img.nii.gz'
    nifti_path.touch()
    model_path = tmp_path / 'model'
    model_path.mkdir()

    import preprocessing

    # Clear the model path first
    if str(model_path) in sys.path:
        sys.path.remove(str(model_path))

    preprocessing.prepare_for_inference(nifti_path, model_path)
    assert str(model_path) in sys.path


def test_generate_attention_overlays_returns_dict(tmp_path, _stub_heavy_deps):
    """generate_attention_overlays should return a dict with data/shape/dtype keys."""
    torch_stub, _ = _stub_heavy_deps
    model_path = tmp_path / 'model'
    model_path.mkdir()

    # Stub predict_attention module (needed inside generate_attention_overlays)
    predict_stub = types.ModuleType('predict_attention')
    predict_stub.minmax_norm = MagicMock(side_effect=lambda x: x)
    mock_overlay = MagicMock()
    mock_overlay.shape = (5, 3, 16, 16)
    arr = np.zeros((5, 3, 16, 16), dtype=np.float32)
    mock_overlay.cpu.return_value.numpy.return_value = arr
    predict_stub.tensor_cam2image = MagicMock(return_value=mock_overlay)
    sys.modules['predict_attention'] = predict_stub

    import preprocessing

    img_tensor = MagicMock()
    img_tensor.swapaxes.return_value = img_tensor
    img_tensor.unsqueeze.return_value = img_tensor
    weight_tensor = MagicMock()
    weight_tensor.swapaxes.return_value = weight_tensor
    weight_tensor.unsqueeze.return_value = weight_tensor

    result = preprocessing.generate_attention_overlays(img_tensor, weight_tensor, model_path)

    assert isinstance(result, dict)
    assert 'data' in result
    assert 'shape' in result
    assert 'dtype' in result


def test_generate_attention_overlays_dtype_is_uint8(tmp_path, _stub_heavy_deps):
    """dtype field must be 'uint8'."""
    model_path = tmp_path / 'model'
    model_path.mkdir()

    predict_stub = types.ModuleType('predict_attention')
    predict_stub.minmax_norm = MagicMock(side_effect=lambda x: x)
    mock_overlay = MagicMock()
    mock_overlay.shape = (5, 3, 16, 16)
    arr = np.zeros((5, 3, 16, 16), dtype=np.float32)
    mock_overlay.cpu.return_value.numpy.return_value = arr
    predict_stub.tensor_cam2image = MagicMock(return_value=mock_overlay)
    sys.modules['predict_attention'] = predict_stub

    import preprocessing

    img_tensor = MagicMock()
    img_tensor.swapaxes.return_value = img_tensor
    img_tensor.unsqueeze.return_value = img_tensor
    weight_tensor = MagicMock()
    weight_tensor.swapaxes.return_value = weight_tensor
    weight_tensor.unsqueeze.return_value = weight_tensor

    result = preprocessing.generate_attention_overlays(img_tensor, weight_tensor, model_path)
    assert result['dtype'] == 'uint8'
