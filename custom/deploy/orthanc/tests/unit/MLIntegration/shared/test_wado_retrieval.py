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


def test_retrieve_via_wado_rs_empty_list_skips_client_construction():
    """Empty input must short-circuit before constructing a DICOMwebClient (no I/O)."""
    from unittest import mock
    with mock.patch('shared.wado_retrieval.DICOMwebClient') as mock_cls:
        from shared.wado_retrieval import retrieve_via_wado_rs
        results = retrieve_via_wado_rs([])
    assert results == []
    mock_cls.assert_not_called()


# ---------------------------------------------------------------------------
# S1: Real HTTP/network/DICOM errors all surface as DicomRetrievalError
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("exc_factory,desc", [
    (lambda: __import__("requests").exceptions.HTTPError("404 Not Found"), "HTTPError"),
    (lambda: __import__("requests").exceptions.Timeout("read timeout"), "Timeout"),
    (lambda: __import__("pydicom").errors.InvalidDicomError("bad transfer syntax"), "InvalidDicomError"),
    (lambda: ConnectionError("refused"), "ConnectionError"),
])
def test_retrieve_via_wado_rs_wraps_underlying_exception(exc_factory, desc):
    """Any exception from DICOMwebClient.retrieve_series surfaces as DicomRetrievalError."""
    from shared.wado_retrieval import retrieve_via_wado_rs
    from shared.exceptions import DicomRetrievalError
    fake_client = MagicMock()
    fake_client.retrieve_series.side_effect = exc_factory()
    with patch("shared.wado_retrieval.DICOMwebClient", return_value=fake_client):
        with pytest.raises(DicomRetrievalError, match="WADO-RS retrieval failed"):
            retrieve_via_wado_rs([
                {"retrieval_url": "http://x/studies/S/series/Q",
                 "study_uid": "S", "series_uid": "Q"},
            ])


# ---------------------------------------------------------------------------
# S2: All-or-nothing partial-failure — if a later series fails, the earlier
#     accumulated datasets are NOT returned. Consumers must not see partial state.
# ---------------------------------------------------------------------------

def test_retrieve_via_wado_rs_all_or_nothing_on_partial_failure():
    """First series succeeds, second raises -> the whole call raises and nothing returned."""
    from shared.wado_retrieval import retrieve_via_wado_rs
    from shared.exceptions import DicomRetrievalError
    fake_client = MagicMock()
    fake_client.retrieve_series.side_effect = [
        [_make_fake_dataset("ok.1")],
        ConnectionError("series 2 unreachable"),
    ]
    with patch("shared.wado_retrieval.DICOMwebClient", return_value=fake_client):
        with pytest.raises(DicomRetrievalError):
            retrieve_via_wado_rs([
                {"retrieval_url": "http://x/studies/S/series/A",
                 "study_uid": "S", "series_uid": "A"},
                {"retrieval_url": "http://x/studies/S/series/B",
                 "study_uid": "S", "series_uid": "B"},
            ])


# ---------------------------------------------------------------------------
# S3: URL split("/studies/") edge cases — the production code does a single
#     split on "/studies/" to derive the base URL.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("retrieval_url,expected_base", [
    ("http://host/dicom-web/studies/S/series/Q",       "http://host/dicom-web"),
    ("http://host/dicom-web/studies/S/series/Q/",      "http://host/dicom-web"),
    ("http://host/dicom-web",                          "http://host/dicom-web"),  # no /studies/, base = full url
    ("http://proxy/studies/relay/studies/S/series/Q",  "http://proxy"),           # double /studies/: takes BEFORE the first match
])
def test_retrieve_via_wado_rs_derives_base_url(retrieval_url, expected_base):
    """Base URL is split("/studies/")[0]; pins behavior on tricky inputs (no scheme assumed safe)."""
    from shared.wado_retrieval import retrieve_via_wado_rs
    fake_client = MagicMock()
    fake_client.retrieve_series.return_value = []
    with patch("shared.wado_retrieval.DICOMwebClient", return_value=fake_client) as mock_cls:
        retrieve_via_wado_rs([
            {"retrieval_url": retrieval_url, "study_uid": "S", "series_uid": "Q"},
        ])
    mock_cls.assert_called_once_with(url=expected_base)
