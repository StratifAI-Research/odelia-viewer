"""Tests for shared/wado_retrieval.py — retrieve_via_wado_rs helper."""
from unittest.mock import MagicMock, patch

import pydicom
import pytest


def _make_fake_dataset(sop_uid='1.2.3.1'):
    ds = pydicom.dataset.Dataset()
    ds.SOPInstanceUID = sop_uid
    return ds


def test_retrieve_via_wado_rs_returns_list_of_datasets():
    from shared.wado_retrieval import retrieve_via_wado_rs

    fake_client = MagicMock()
    fake_client.retrieve_series.return_value = [_make_fake_dataset('1.2.3.1')]

    with patch('shared.wado_retrieval.DICOMwebClient', return_value=fake_client):
        results = retrieve_via_wado_rs([{
            'retrieval_url': 'http://host/dicom-web',
            'study_uid': '1.2.100',
            'series_uid': '1.2.200',
        }])

    assert len(results) == 1
    assert results[0].SOPInstanceUID == '1.2.3.1'


def test_retrieve_via_wado_rs_passes_correct_study_series_to_client():
    from shared.wado_retrieval import retrieve_via_wado_rs

    fake_client = MagicMock()
    fake_client.retrieve_series.return_value = [_make_fake_dataset()]

    with patch('shared.wado_retrieval.DICOMwebClient', return_value=fake_client):
        retrieve_via_wado_rs([{
            'retrieval_url': 'http://host/dicom-web',
            'study_uid': 'STUDY-UID',
            'series_uid': 'SERIES-UID',
        }])

    fake_client.retrieve_series.assert_called_once_with(
        study_instance_uid='STUDY-UID',
        series_instance_uid='SERIES-UID',
    )


def test_retrieve_via_wado_rs_extracts_base_url_from_full_wado_url():
    """If retrieval_url contains /studies/, the base URL is extracted correctly."""
    from shared.wado_retrieval import retrieve_via_wado_rs

    fake_client = MagicMock()
    fake_client.retrieve_series.return_value = []

    with patch('shared.wado_retrieval.DICOMwebClient', return_value=fake_client) as mock_cls:
        retrieve_via_wado_rs([{
            'retrieval_url': 'http://host/dicom-web/studies/1.2.100/series/1.2.200',
            'study_uid': '1.2.100',
            'series_uid': '1.2.200',
        }])

    # The client must be constructed with the base URL, not the full series URL
    constructed_url = mock_cls.call_args[1].get('url') or mock_cls.call_args[0][0]
    assert '/studies/' not in constructed_url
    assert constructed_url == 'http://host/dicom-web'


def test_retrieve_via_wado_rs_aggregates_multiple_series():
    from shared.wado_retrieval import retrieve_via_wado_rs

    fake_client = MagicMock()
    fake_client.retrieve_series.side_effect = [
        [_make_fake_dataset('1.2.3.1'), _make_fake_dataset('1.2.3.2')],
        [_make_fake_dataset('1.2.3.3')],
    ]

    with patch('shared.wado_retrieval.DICOMwebClient', return_value=fake_client):
        results = retrieve_via_wado_rs([
            {'retrieval_url': 'http://host/dicom-web', 'study_uid': 'S1', 'series_uid': 'SE1'},
            {'retrieval_url': 'http://host/dicom-web', 'study_uid': 'S1', 'series_uid': 'SE2'},
        ])

    assert len(results) == 3


def test_retrieve_via_wado_rs_raises_dicom_retrieval_error_on_failure():
    from shared.wado_retrieval import retrieve_via_wado_rs
    from shared.exceptions import DicomRetrievalError

    fake_client = MagicMock()
    fake_client.retrieve_series.side_effect = ConnectionError('network down')

    with patch('shared.wado_retrieval.DICOMwebClient', return_value=fake_client):
        with pytest.raises(DicomRetrievalError, match='WADO-RS retrieval failed'):
            retrieve_via_wado_rs([{
                'retrieval_url': 'http://host/dicom-web',
                'study_uid': 'S1',
                'series_uid': 'SE1',
            }])


def test_retrieve_via_wado_rs_empty_list_returns_empty():
    from shared.wado_retrieval import retrieve_via_wado_rs

    results = retrieve_via_wado_rs([])
    assert results == []
