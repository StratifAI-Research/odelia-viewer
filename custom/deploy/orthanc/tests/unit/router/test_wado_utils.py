"""Unit tests for router/wado_utils.py — DICOMweb metadata retrieval helpers."""
from unittest.mock import MagicMock, patch
import pytest


def _make_metadata_doc(instance_uid='1.2.4.1', instance_number=1, temporal_position=None):
    """Build a DICOMweb-style metadata dict (tag -> Value)."""
    doc = {
        '00080018': {'Value': [instance_uid]},
        '00200013': {'Value': [instance_number]},
        '00200032': {'Value': [0.0, 0.0, float(instance_number)]},
    }
    if temporal_position is not None:
        doc['00200100'] = {'Value': [temporal_position]}
    return doc


def test_retrieve_series_metadata_sorts_by_instance_number():
    from wado_utils import retrieve_series_metadata_sorted

    fake_client = MagicMock()
    fake_client.retrieve_series_metadata.return_value = [
        _make_metadata_doc(instance_uid='1.2.4.3', instance_number=3),
        _make_metadata_doc(instance_uid='1.2.4.1', instance_number=1),
        _make_metadata_doc(instance_uid='1.2.4.2', instance_number=2),
    ]
    with patch('wado_utils.DICOMwebClient', return_value=fake_client):
        meta, positions, spacing = retrieve_series_metadata_sorted([
            {'retrieval_url': 'http://x/studies/A', 'study_uid': 'A', 'series_uid': 'B'},
        ])

    # Positions should be sorted by InstanceNumber ascending
    z_values = [p[2] for p in positions]
    assert z_values == sorted(z_values)
    assert z_values == [1.0, 2.0, 3.0]

    # meta should correspond to the first sorted instance (InstanceNumber=1)
    assert meta['00200013']['Value'][0] == 1

    # spacing should be a float >= 0
    assert isinstance(spacing, float)
    assert spacing >= 0.0


def test_retrieve_series_metadata_empty_list_raises():
    """Empty wado_rs_retrieval raises before any network call is made."""
    from wado_utils import retrieve_series_metadata_sorted
    with pytest.raises((IndexError, KeyError, ValueError)):
        retrieve_series_metadata_sorted([])
