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


# ---------------------------------------------------------------------------
# R3: multi-temporal phase grouping + edge cases
# ---------------------------------------------------------------------------

def test_multi_temporal_phases_selects_first_phase_sorted():
    """When two temporal phases are present, only instances from the lowest phase are returned."""
    from wado_utils import retrieve_series_metadata_sorted
    fake_client = MagicMock()
    fake_client.retrieve_series_metadata.return_value = [
        _make_metadata_doc(instance_uid='p2.i1', instance_number=1, temporal_position=2),
        _make_metadata_doc(instance_uid='p1.i2', instance_number=2, temporal_position=1),
        _make_metadata_doc(instance_uid='p1.i1', instance_number=1, temporal_position=1),
    ]
    with patch('wado_utils.DICOMwebClient', return_value=fake_client):
        meta, positions, _ = retrieve_series_metadata_sorted([
            {'retrieval_url': 'http://x/studies/A', 'study_uid': 'A', 'series_uid': 'B'},
        ])
    # 2 positions (only temporal phase 1), sorted by InstanceNumber 1 then 2.
    assert len(positions) == 2
    assert meta['00080018']['Value'][0] == 'p1.i1'


def test_instances_missing_ipp_are_silently_skipped():
    """Instances without 00200032 (IPP) are skipped from selection."""
    from wado_utils import retrieve_series_metadata_sorted
    fake_client = MagicMock()
    no_ipp = {'00200013': {'Value': [99]}}  # only InstanceNumber, no IPP
    fake_client.retrieve_series_metadata.return_value = [
        no_ipp,
        _make_metadata_doc(instance_uid='ok.1', instance_number=1),
        _make_metadata_doc(instance_uid='ok.2', instance_number=2),
    ]
    with patch('wado_utils.DICOMwebClient', return_value=fake_client):
        meta, positions, _ = retrieve_series_metadata_sorted([
            {'retrieval_url': 'http://x/studies/A', 'study_uid': 'A', 'series_uid': 'B'},
        ])
    # Only the two well-formed instances appear; meta is the lowest-numbered.
    assert len(positions) == 2
    assert meta['00080018']['Value'][0] == 'ok.1'


def test_no_well_formed_instances_raises_value_error():
    """If all instances lack IPP or InstanceNumber, raise ValueError."""
    from wado_utils import retrieve_series_metadata_sorted
    fake_client = MagicMock()
    fake_client.retrieve_series_metadata.return_value = [
        {'00200013': {'Value': [1]}},               # no IPP
        {'00200032': {'Value': [0.0, 0.0, 0.0]}},   # no InstanceNumber
    ]
    with patch('wado_utils.DICOMwebClient', return_value=fake_client):
        with pytest.raises(ValueError, match="No instances"):
            retrieve_series_metadata_sorted([
                {'retrieval_url': 'http://x/studies/A', 'study_uid': 'A', 'series_uid': 'B'},
            ])


def test_single_instance_spacing_falls_back_to_one():
    """With only one instance, slice_spacing falls back to 1.0 (cannot compute from positions)."""
    from wado_utils import retrieve_series_metadata_sorted
    fake_client = MagicMock()
    fake_client.retrieve_series_metadata.return_value = [
        _make_metadata_doc(instance_uid='only.1', instance_number=1),
    ]
    with patch('wado_utils.DICOMwebClient', return_value=fake_client):
        _, positions, spacing = retrieve_series_metadata_sorted([
            {'retrieval_url': 'http://x/studies/A', 'study_uid': 'A', 'series_uid': 'B'},
        ])
    assert len(positions) == 1
    assert spacing == 1.0
