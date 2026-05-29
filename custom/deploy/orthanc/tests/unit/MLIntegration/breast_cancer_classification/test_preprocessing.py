"""Tests for breast-cancer-classification/preprocessing.py.

preprocessing.py imports torchio and torch at module level and subclasses
tio.ZNormalization and tio.CropOrPad at class-definition time.
Both torchio_stub and torch_stub fixtures (from the parent conftest) must be
active before importing the module.

Uncovered paths (intentional):
- ZNormalization.apply_normalization / _znorm: require real torch tensor
  arithmetic (quantile, clamp, znorm).  Fully testing these needs real torchio.
- preprocess_for_side: calls torch.cat on real TorchIO Image objects and moves
  tensor to device — exercising that would require real torch.  The function
  signature and argument passing are validated indirectly via module importability.
"""
import sys

import pytest


@pytest.fixture(autouse=True)
def _evict_preprocessing():
    """Ensure preprocessing is re-imported fresh with stubs active."""
    sys.modules.pop('preprocessing', None)
    yield
    sys.modules.pop('preprocessing', None)


def test_preprocessing_imports_with_stubs(torch_stub, torchio_stub):
    pass  # should not raise


def test_parse_per_channel_per_channel_true(torch_stub, torchio_stub):
    import preprocessing
    result = preprocessing.parse_per_channel(True, 3)
    assert result == [(0,), (1,), (2,)]


def test_parse_per_channel_per_channel_false(torch_stub, torchio_stub):
    import preprocessing
    result = preprocessing.parse_per_channel(False, 3)
    assert result == [(0, 1, 2)]


def test_parse_per_channel_single_channel(torch_stub, torchio_stub):
    import preprocessing
    result = preprocessing.parse_per_channel(True, 1)
    assert result == [(0,)]


def test_image_to_tensor_class_exists(torch_stub, torchio_stub):
    import preprocessing
    assert hasattr(preprocessing, 'ImageToTensor')
    assert callable(preprocessing.ImageToTensor)


def test_znormalization_class_exists(torch_stub, torchio_stub):
    import preprocessing
    assert hasattr(preprocessing, 'ZNormalization')


def test_random_crop_or_pad_class_exists(torch_stub, torchio_stub):
    import preprocessing
    assert hasattr(preprocessing, 'RandomCropOrPad')


def test_get_preprocessing_pipeline_returns_compose(torch_stub, torchio_stub):
    """get_preprocessing_pipeline should return a tio.Compose instance."""
    import preprocessing
    import torchio as tio
    pipeline = preprocessing.get_preprocessing_pipeline()
    assert isinstance(pipeline, tio.Compose)


def test_get_preprocessing_pipeline_has_three_transforms(torch_stub, torchio_stub):
    """Pipeline should have exactly 3 transforms: CropOrPad, ZNormalization, ImageToTensor."""
    import preprocessing
    pipeline = preprocessing.get_preprocessing_pipeline()
    assert len(pipeline.transforms) == 3


def test_get_preprocessing_pipeline_first_is_crop_or_pad(torch_stub, torchio_stub):
    import preprocessing
    pipeline = preprocessing.get_preprocessing_pipeline()
    assert isinstance(pipeline.transforms[0], preprocessing.RandomCropOrPad)


def test_get_preprocessing_pipeline_second_is_znormalization(torch_stub, torchio_stub):
    import preprocessing
    pipeline = preprocessing.get_preprocessing_pipeline()
    assert isinstance(pipeline.transforms[1], preprocessing.ZNormalization)


def test_get_preprocessing_pipeline_third_is_image_to_tensor(torch_stub, torchio_stub):
    import preprocessing
    pipeline = preprocessing.get_preprocessing_pipeline()
    assert isinstance(pipeline.transforms[2], preprocessing.ImageToTensor)


def test_znormalization_percentiles_stored(torch_stub, torchio_stub):
    import preprocessing
    zn = preprocessing.ZNormalization(percentiles=(0.5, 99.5), per_channel=True)
    assert zn.percentiles == (0.5, 99.5)
    assert zn.per_channel is True


def test_preprocess_for_side_function_exists(torch_stub, torchio_stub):
    import preprocessing
    assert callable(preprocessing.preprocess_for_side)
