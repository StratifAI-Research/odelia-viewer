"""Tests for wado_helper.py — parse_multipart_dicom + retrieve_via_wado_rs + fallback_to_orthanc_rest."""
import io
from unittest.mock import MagicMock, patch

import pydicom
import pytest
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian


def _minimal_dicom_bytes(sop_uid="1.2.3.4.5"):
    """Build a minimal DICOM file as bytes (File Meta + tiny dataset)."""
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.4"
    meta.MediaStorageSOPInstanceUID = sop_uid
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = FileDataset("test", {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPInstanceUID = sop_uid
    buf = io.BytesIO()
    pydicom.dcmwrite(buf, ds, enforce_file_format=True)
    return buf.getvalue()


def _multipart_body(dicom_blobs, boundary="BOUNDARY"):
    """Wrap a list of DICOM byte blobs in a multipart/related response body."""
    parts = []
    for blob in dicom_blobs:
        parts.append(
            f"--{boundary}\r\n".encode()
            + b"Content-Type: application/dicom\r\n\r\n"
            + blob
            + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts)


# ---------------------------------------------------------------------------
# parse_multipart_dicom
# ---------------------------------------------------------------------------

def test_parse_multipart_dicom_extracts_single_dataset():
    import wado_helper
    body = _multipart_body([_minimal_dicom_bytes("1.2.3.4.1")])
    datasets = wado_helper.parse_multipart_dicom(body, "BOUNDARY")
    assert len(datasets) == 1
    assert datasets[0].SOPInstanceUID == "1.2.3.4.1"


def test_parse_multipart_dicom_extracts_multiple_datasets():
    import wado_helper
    body = _multipart_body([
        _minimal_dicom_bytes("1.2.3.4.1"),
        _minimal_dicom_bytes("1.2.3.4.2"),
        _minimal_dicom_bytes("1.2.3.4.3"),
    ])
    datasets = wado_helper.parse_multipart_dicom(body, "BOUNDARY")
    sop_uids = sorted(ds.SOPInstanceUID for ds in datasets)
    assert sop_uids == ["1.2.3.4.1", "1.2.3.4.2", "1.2.3.4.3"]


def test_parse_multipart_dicom_skips_unparseable_part_without_crashing():
    """Garbage DICOM data inside a multipart part is logged but does not raise."""
    import wado_helper
    body = (
        b"--BOUNDARY\r\nContent-Type: application/dicom\r\n\r\n"
        + b"NOT_A_DICOM_FILE"
        + b"\r\n--BOUNDARY--\r\n"
    )
    datasets = wado_helper.parse_multipart_dicom(body, "BOUNDARY")
    assert datasets == []


def test_parse_multipart_dicom_ignores_non_dicom_content_type():
    """Multipart parts whose Content-Type is not application/dicom are skipped."""
    import wado_helper
    body = (
        b"--BOUNDARY\r\nContent-Type: text/plain\r\n\r\n"
        + b"not-a-dicom"
        + b"\r\n--BOUNDARY--\r\n"
    )
    datasets = wado_helper.parse_multipart_dicom(body, "BOUNDARY")
    assert datasets == []


# ---------------------------------------------------------------------------
# retrieve_via_wado_rs
# ---------------------------------------------------------------------------

def _wado_resp(status_code, content=b"", boundary="BOUNDARY"):
    resp = MagicMock()
    resp.status_code = status_code
    resp.content = content
    resp.text = ""
    resp.headers = {"Content-Type": f"multipart/related; type=application/dicom; boundary={boundary}"}
    return resp


def test_retrieve_via_wado_rs_returns_parsed_datasets_for_each_series():
    import wado_helper
    body = _multipart_body([_minimal_dicom_bytes("inst.1")])
    with patch("wado_helper.requests.get", return_value=_wado_resp(200, body)):
        datasets = wado_helper.retrieve_via_wado_rs([
            {"retrieval_url": "http://x/studies/S/series/A", "series_uid": "A", "study_uid": "S"},
        ])
    assert len(datasets) == 1
    assert datasets[0].SOPInstanceUID == "inst.1"


def test_retrieve_via_wado_rs_skips_series_returning_non_200():
    """A non-200 response on one series is logged and continues; result list excludes it."""
    import wado_helper
    body = _multipart_body([_minimal_dicom_bytes("inst.ok")])
    # First series 500, second series 200.
    resps = [_wado_resp(500, b""), _wado_resp(200, body)]
    with patch("wado_helper.requests.get", side_effect=resps):
        datasets = wado_helper.retrieve_via_wado_rs([
            {"retrieval_url": "http://x/studies/S/series/A", "series_uid": "A", "study_uid": "S"},
            {"retrieval_url": "http://x/studies/S/series/B", "series_uid": "B", "study_uid": "S"},
        ])
    assert len(datasets) == 1
    assert datasets[0].SOPInstanceUID == "inst.ok"


def test_retrieve_via_wado_rs_skips_when_no_boundary_in_content_type():
    """Without a boundary in Content-Type, the response is logged and skipped."""
    import wado_helper
    resp = MagicMock()
    resp.status_code = 200
    resp.content = b""
    resp.headers = {"Content-Type": "application/dicom"}  # no boundary
    with patch("wado_helper.requests.get", return_value=resp):
        datasets = wado_helper.retrieve_via_wado_rs([
            {"retrieval_url": "http://x/studies/S/series/A", "series_uid": "A", "study_uid": "S"},
        ])
    assert datasets == []


def test_retrieve_via_wado_rs_swallows_exception_and_continues():
    """When requests.get raises, the error is logged but the loop continues to the next series."""
    import wado_helper
    body = _multipart_body([_minimal_dicom_bytes("inst.ok")])
    side = [ConnectionError("boom"), _wado_resp(200, body)]
    with patch("wado_helper.requests.get", side_effect=side):
        datasets = wado_helper.retrieve_via_wado_rs([
            {"retrieval_url": "http://x/studies/S/series/A", "series_uid": "A", "study_uid": "S"},
            {"retrieval_url": "http://x/studies/S/series/B", "series_uid": "B", "study_uid": "S"},
        ])
    assert len(datasets) == 1


# ---------------------------------------------------------------------------
# fallback_to_orthanc_rest
# ---------------------------------------------------------------------------

def test_fallback_to_orthanc_rest_returns_datasets_for_found_series():
    import wado_helper
    dicom_bytes = _minimal_dicom_bytes("inst.1")

    lookup = MagicMock(status_code=200)
    lookup.json.return_value = [{"Type": "Series", "ID": "SID-1"}]
    instances = MagicMock(status_code=200)
    instances.json.return_value = [{"ID": "I-1"}]
    file_resp = MagicMock(status_code=200, content=dicom_bytes)

    with patch("wado_helper.requests.post", return_value=lookup), \
         patch("wado_helper.requests.get", side_effect=[instances, file_resp]):
        datasets = wado_helper.fallback_to_orthanc_rest("1.2.3.series", "http://orthanc:8042")

    assert len(datasets) == 1
    assert datasets[0].SOPInstanceUID == "inst.1"


def test_fallback_to_orthanc_rest_returns_empty_on_lookup_404():
    import wado_helper
    bad_lookup = MagicMock(status_code=404)
    bad_lookup.json.return_value = []
    with patch("wado_helper.requests.post", return_value=bad_lookup):
        datasets = wado_helper.fallback_to_orthanc_rest("missing.series", "http://orthanc:8042")
    assert datasets == []


def test_fallback_to_orthanc_rest_returns_empty_when_series_not_in_lookup_result():
    """Lookup returns 200 but with no Series-type results -> empty."""
    import wado_helper
    lookup = MagicMock(status_code=200)
    lookup.json.return_value = [{"Type": "Study", "ID": "STUDY-1"}]  # no Series-type
    with patch("wado_helper.requests.post", return_value=lookup):
        datasets = wado_helper.fallback_to_orthanc_rest("1.2.3.series", "http://orthanc:8042")
    assert datasets == []


def test_fallback_to_orthanc_rest_returns_empty_on_instances_endpoint_failure():
    """If the /series/<id>/instances endpoint returns non-200, return empty."""
    import wado_helper
    lookup = MagicMock(status_code=200)
    lookup.json.return_value = [{"Type": "Series", "ID": "SID-1"}]
    instances_fail = MagicMock(status_code=500)
    with patch("wado_helper.requests.post", return_value=lookup), \
         patch("wado_helper.requests.get", return_value=instances_fail):
        datasets = wado_helper.fallback_to_orthanc_rest("1.2.3.series", "http://orthanc:8042")
    assert datasets == []


def test_fallback_to_orthanc_rest_skips_instance_with_non_200_file_response():
    """If /instances/<id>/file returns non-200 for an instance, skip it but continue."""
    import wado_helper
    dicom_bytes = _minimal_dicom_bytes("ok.1")
    lookup = MagicMock(status_code=200)
    lookup.json.return_value = [{"Type": "Series", "ID": "SID-1"}]
    instances = MagicMock(status_code=200)
    instances.json.return_value = [{"ID": "I-fail"}, {"ID": "I-ok"}]
    bad_file = MagicMock(status_code=500, content=b"")
    good_file = MagicMock(status_code=200, content=dicom_bytes)
    with patch("wado_helper.requests.post", return_value=lookup), \
         patch("wado_helper.requests.get", side_effect=[instances, bad_file, good_file]):
        datasets = wado_helper.fallback_to_orthanc_rest("1.2.3.series", "http://orthanc:8042")
    assert len(datasets) == 1
    assert datasets[0].SOPInstanceUID == "ok.1"


def test_fallback_to_orthanc_rest_swallows_exception_and_returns_empty():
    import wado_helper
    with patch("wado_helper.requests.post", side_effect=ConnectionError("refused")):
        datasets = wado_helper.fallback_to_orthanc_rest("1.2.3.series", "http://orthanc:8042")
    assert datasets == []
