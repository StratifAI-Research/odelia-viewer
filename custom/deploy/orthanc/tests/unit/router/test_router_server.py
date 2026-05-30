"""Unit tests for router/server.py — pure helpers + SR/SC pipeline.

Covers:
  - detect_response_format: bilateral, bilateral_with_heatmap, unknown raises ValueError
  - create_code_sequence: Dataset structure (CodeValue, CodingSchemeDesignator, CodeMeaning)
  - create_measurement: Dataset structure (NumericValue, MeasurementUnitsCodeSequence)
  - add_text_overlay: single-frame and multi-frame pixel modification
  - create_bilateral_sr: smoke + asserts on Modality, ContentSequence, ReferencedImageSequence
  - create_mst_sr: smoke + asserts on Modality, ContentSequence
  - create_multiframe_attention_sc: smoke returns bytes with SC Modality
  - create_text_overlay_sc: smoke test (requires pixel_array on original_ds)

Note: OnStableStudy is registered but REMOVED from the orthanc callback in the
running server. It is still importable; we do not test it because it requires
real Orthanc REST calls that are deeply coupled to Orthanc internals (study
instances, series metadata, etc.). The UPS workflow (router/ups/) covers the
same logic via dedicated tests.
"""
import base64
import io
import sys

import numpy as np
import pytest
from pydicom import Dataset
from pydicom.dataset import FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid


# ---------------------------------------------------------------------------
# Module loader
# ---------------------------------------------------------------------------

import os as _os
_ROUTER_DIR = _os.path.abspath(
    _os.path.join(_os.path.dirname(__file__), '..', '..', '..', 'router')
)


def _evict_ups():
    for key in [k for k in sys.modules if k == "ups" or k.startswith("ups.")]:
        del sys.modules[key]
    # Also evict server so it re-imports fresh
    for key in [k for k in sys.modules if k == "server"]:
        del sys.modules[key]


def _load_server():
    # Ensure router/ is at the front of sys.path so 'ups.routes' resolves to
    # router/ups/routes.py even if viewer conftest has prepended viewer/ first.
    if _ROUTER_DIR not in sys.path:
        sys.path.insert(0, _ROUTER_DIR)
    else:
        # Move to front if already present
        sys.path.remove(_ROUTER_DIR)
        sys.path.insert(0, _ROUTER_DIR)
    _evict_ups()
    import server
    return server


@pytest.fixture(autouse=True)
def _router_path_guard():
    """Ensure router/ is at sys.path[0] for each test; restore after.

    Both viewer and router conftest files run at collection time. This fixture
    keeps router/ at the front during each test so imports resolve to router/ups/,
    then restores sys.path so viewer tests that follow find viewer/ups/ first.
    """
    saved = list(sys.path)
    # Ensure router/ is first
    if _ROUTER_DIR in sys.path:
        sys.path.remove(_ROUTER_DIR)
    sys.path.insert(0, _ROUTER_DIR)
    yield
    sys.path[:] = saved


@pytest.fixture
def srv():
    return _load_server()


# ---------------------------------------------------------------------------
# Minimal DICOM Dataset helper
# ---------------------------------------------------------------------------

def _minimal_dicom():
    ds = Dataset()
    ds.PatientName = "Test^Patient"
    ds.PatientID = "T001"
    ds.PatientBirthDate = "19800101"
    ds.PatientSex = "O"
    ds.StudyInstanceUID = generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    ds.SOPInstanceUID = generate_uid()
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.4"  # MR Image Storage
    ds.StudyDate = "20260101"
    ds.StudyTime = "120000"
    ds.AccessionNumber = "12345"
    ds.Modality = "MR"
    ds.Manufacturer = "TEST"
    ds.StudyID = "1"
    ds.SeriesNumber = 1
    ds.InstanceNumber = 1
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    return ds


def _minimal_dicom_with_pixels(rows=64, cols=64):
    """Minimal DICOM with a fake RGB pixel_array attribute for SC tests."""
    ds = _minimal_dicom()
    # Attach a fake pixel_array property (avoids needing real encoded pixel data)
    arr = np.zeros((rows, cols, 3), dtype=np.uint8)
    ds._pixel_array = arr
    # Monkey-patch pixel_array as a property
    type(ds).pixel_array = property(lambda self: self._pixel_array)
    return ds


# ---------------------------------------------------------------------------
# detect_response_format
# ---------------------------------------------------------------------------

def test_detect_response_format_bilateral(srv):
    result = srv.detect_response_format({
        "left": {"prediction": "Benign", "confidence": 80.0},
        "right": {"prediction": "Malignant", "confidence": 95.0},
    })
    assert result == "bilateral"


def test_detect_response_format_bilateral_with_heatmap(srv):
    result = srv.detect_response_format({
        "left": {"prediction": "Benign", "confidence": 80.0},
        "right": {"prediction": "Malignant", "confidence": 95.0},
        "attention_maps": {"data": "...", "shape": [10, 64, 64, 3]},
    })
    assert result == "bilateral_with_heatmap"


def test_detect_response_format_unknown_raises_value_error(srv):
    with pytest.raises(ValueError, match="Unknown response format"):
        srv.detect_response_format({"model_output": [0.1, 0.9]})


def test_detect_response_format_only_left_is_bilateral(srv):
    result = srv.detect_response_format({"left": {"prediction": "Benign", "confidence": 60.0}})
    assert result == "bilateral"


def test_detect_response_format_only_right_is_bilateral(srv):
    result = srv.detect_response_format({"right": {"prediction": "Malignant", "confidence": 90.0}})
    assert result == "bilateral"


# ---------------------------------------------------------------------------
# create_code_sequence
# ---------------------------------------------------------------------------

def test_create_code_sequence_structure(srv):
    item = srv.create_code_sequence("12345", "SCT", "Some Concept")
    assert hasattr(item, "CodeValue")
    assert hasattr(item, "CodingSchemeDesignator")
    assert hasattr(item, "CodeMeaning")
    assert item.CodeValue == "12345"
    assert item.CodingSchemeDesignator == "SCT"
    assert item.CodeMeaning == "Some Concept"


def test_create_code_sequence_returns_dataset(srv):
    item = srv.create_code_sequence("R-00339", "SRT", "Classification Result")
    assert isinstance(item, Dataset)


def test_create_code_sequence_loinc(srv):
    item = srv.create_code_sequence("18748-4", "LN", "Diagnostic Imaging Report")
    assert item.CodeValue == "18748-4"
    assert item.CodingSchemeDesignator == "LN"


# ---------------------------------------------------------------------------
# create_measurement
# ---------------------------------------------------------------------------

def test_create_measurement_numeric_value(srv):
    m = srv.create_measurement(85.5, "%", "%", "UCUM")
    assert hasattr(m, "NumericValue")
    assert float(m.NumericValue) == pytest.approx(85.5)


def test_create_measurement_units_sequence_present(srv):
    m = srv.create_measurement(42.0, "%", "%", "UCUM")
    assert hasattr(m, "MeasurementUnitsCodeSequence")
    assert len(m.MeasurementUnitsCodeSequence) == 1


def test_create_measurement_units_code_value(srv):
    m = srv.create_measurement(99.0, "percent", "%", "UCUM")
    units_item = m.MeasurementUnitsCodeSequence[0]
    assert units_item.CodeValue == "%"
    assert units_item.CodingSchemeDesignator == "UCUM"
    assert units_item.CodeMeaning == "percent"


def test_create_measurement_returns_dataset(srv):
    m = srv.create_measurement(0.0, "%", "%", "UCUM")
    assert isinstance(m, Dataset)


# ---------------------------------------------------------------------------
# add_text_overlay
# ---------------------------------------------------------------------------

def test_add_text_overlay_single_frame_modifies_pixels(srv):
    arr = np.zeros((64, 64, 3), dtype=np.uint8)
    result = srv.add_text_overlay(arr, text="TEST", color="red")
    assert result.shape[0] == 64
    assert result.shape[1] == 64
    # Some pixels should be non-zero (text was drawn)
    assert result.sum() > 0


def test_add_text_overlay_single_frame_greyscale_converts_to_rgb(srv):
    arr = np.zeros((64, 64), dtype=np.uint8)
    result = srv.add_text_overlay(arr, text="TEST", color="red")
    # Greyscale input becomes RGB output (3 channels)
    assert len(result.shape) == 3
    assert result.shape[2] == 3


def test_add_text_overlay_multi_frame_preserves_frame_count(srv):
    arr = np.zeros((4, 32, 32, 3), dtype=np.uint8)
    result = srv.add_text_overlay(arr, text="X", color="white")
    assert result.shape[0] == 4


def test_add_text_overlay_multi_frame_modifies_pixels(srv):
    arr = np.zeros((3, 64, 64, 3), dtype=np.uint8)
    result = srv.add_text_overlay(arr, text="AI", color="green")
    assert result.sum() > 0


# ---------------------------------------------------------------------------
# create_bilateral_sr
# ---------------------------------------------------------------------------

_BILATERAL_RESULTS = {
    "left": {"prediction": "Malignant", "confidence": 92.5},
    "right": {"prediction": "Benign", "confidence": 67.0},
}


def test_create_bilateral_sr_returns_bytes(srv):
    ds = _minimal_dicom()
    sr_bytes, date, time_str, uid = srv.create_bilateral_sr(ds, _BILATERAL_RESULTS)
    assert isinstance(sr_bytes, bytes)
    assert len(sr_bytes) > 0


def test_create_bilateral_sr_modality_is_sr(srv):
    ds = _minimal_dicom()
    sr_bytes, _, _, _ = srv.create_bilateral_sr(ds, _BILATERAL_RESULTS)
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sr_bytes))
    assert parsed.Modality == "SR"


def test_create_bilateral_sr_content_sequence_present(srv):
    ds = _minimal_dicom()
    sr_bytes, _, _, _ = srv.create_bilateral_sr(ds, _BILATERAL_RESULTS)
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sr_bytes))
    assert hasattr(parsed, "ContentSequence")
    assert len(parsed.ContentSequence) > 0


def test_create_bilateral_sr_references_original_sop(srv):
    ds = _minimal_dicom()
    sr_bytes, _, _, _ = srv.create_bilateral_sr(ds, _BILATERAL_RESULTS)
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sr_bytes))
    assert hasattr(parsed, "ReferencedImageSequence")
    assert len(parsed.ReferencedImageSequence) > 0
    assert parsed.ReferencedImageSequence[0].ReferencedSOPInstanceUID == ds.SOPInstanceUID


def test_create_bilateral_sr_preserves_patient_info(srv):
    ds = _minimal_dicom()
    sr_bytes, _, _, _ = srv.create_bilateral_sr(ds, _BILATERAL_RESULTS)
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sr_bytes))
    assert str(parsed.PatientID) == "T001"
    assert str(parsed.StudyInstanceUID) == str(ds.StudyInstanceUID)


def test_create_bilateral_sr_returns_sop_uid(srv):
    ds = _minimal_dicom()
    _, date, time_str, uid = srv.create_bilateral_sr(ds, _BILATERAL_RESULTS)
    assert uid  # non-empty UID
    assert isinstance(uid, str)


def test_create_bilateral_sr_content_contains_measurements(srv):
    """Root container ContentSequence should contain measurement items for left/right sides."""
    ds = _minimal_dicom()
    sr_bytes, _, _, _ = srv.create_bilateral_sr(ds, _BILATERAL_RESULTS)
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sr_bytes))
    # The root container is the only item in ContentSequence
    root_container = parsed.ContentSequence[0]
    assert hasattr(root_container, "ContentSequence")
    # Should contain items for left, right, and model metadata — at least 2
    assert len(root_container.ContentSequence) >= 2


def test_create_bilateral_sr_error_side_uses_text_type(srv):
    """When a side has an error key, value type should be TEXT, not CODE."""
    ds = _minimal_dicom()
    results_with_error = {
        "left": {"error": "No series found"},
        "right": {"prediction": "Benign", "confidence": 60.0},
    }
    sr_bytes, _, _, _ = srv.create_bilateral_sr(ds, results_with_error)
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sr_bytes))
    root_items = parsed.ContentSequence[0].ContentSequence
    text_items = [i for i in root_items if i.ValueType == "TEXT"]
    assert len(text_items) >= 1


# ---------------------------------------------------------------------------
# create_mst_sr
# ---------------------------------------------------------------------------

_MST_RESULTS = {
    "classification": {
        "prediction": "Malignant",
        "probability": 0.87,
        "model_name": "MST-v2",
        "architecture": "Vision Transformer",
        "version": "2.0",
    }
}


def test_create_mst_sr_returns_bytes(srv):
    ds = _minimal_dicom()
    sr_bytes, _, _, _ = srv.create_mst_sr(ds, _MST_RESULTS)
    assert isinstance(sr_bytes, bytes)
    assert len(sr_bytes) > 0


def test_create_mst_sr_modality_is_sr(srv):
    ds = _minimal_dicom()
    sr_bytes, _, _, _ = srv.create_mst_sr(ds, _MST_RESULTS)
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sr_bytes))
    assert parsed.Modality == "SR"


def test_create_mst_sr_content_sequence_present(srv):
    ds = _minimal_dicom()
    sr_bytes, _, _, _ = srv.create_mst_sr(ds, _MST_RESULTS)
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sr_bytes))
    assert hasattr(parsed, "ContentSequence")
    assert len(parsed.ContentSequence) > 0


def test_create_mst_sr_references_original(srv):
    ds = _minimal_dicom()
    sr_bytes, _, _, _ = srv.create_mst_sr(ds, _MST_RESULTS)
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sr_bytes))
    assert parsed.ReferencedImageSequence[0].ReferencedSOPInstanceUID == ds.SOPInstanceUID


def test_create_mst_sr_classification_probability_in_content(srv):
    """The classification probability (87%) should appear in a MeasuredValueSequence."""
    ds = _minimal_dicom()
    sr_bytes, _, _, _ = srv.create_mst_sr(ds, _MST_RESULTS)
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sr_bytes))
    root_items = parsed.ContentSequence[0].ContentSequence
    measured_items = [i for i in root_items if hasattr(i, "MeasuredValueSequence")]
    assert len(measured_items) >= 1
    # Value should be ~87 (probability * 100)
    val = float(measured_items[0].MeasuredValueSequence[0].NumericValue)
    assert abs(val - 87.0) < 0.01


def test_create_mst_sr_empty_classification_does_not_raise(srv):
    """Empty classification dict should not crash the SR builder."""
    ds = _minimal_dicom()
    sr_bytes, _, _, _ = srv.create_mst_sr(ds, {"classification": {}})
    assert isinstance(sr_bytes, bytes)


# ---------------------------------------------------------------------------
# create_multiframe_attention_sc
# ---------------------------------------------------------------------------

def _make_fake_attention_maps(num_frames=4, rows=32, cols=32):
    """Create a fake base64-encoded attention map payload like the MST model returns."""
    arr = np.random.randint(0, 255, (num_frames, rows, cols, 3), dtype=np.uint8)
    encoded = base64.b64encode(arr.tobytes()).decode("utf-8")
    return {
        "data": encoded,
        "shape": [num_frames, rows, cols, 3],
        "dtype": "uint8",
    }


def test_create_multiframe_attention_sc_returns_bytes(srv):
    ds = _minimal_dicom()
    attention_maps = _make_fake_attention_maps()
    sc_bytes = srv.create_multiframe_attention_sc(ds, attention_maps)
    assert isinstance(sc_bytes, bytes)
    assert len(sc_bytes) > 0


def test_create_multiframe_attention_sc_modality_is_sc(srv):
    ds = _minimal_dicom()
    attention_maps = _make_fake_attention_maps()
    sc_bytes = srv.create_multiframe_attention_sc(ds, attention_maps)
    from pydicom import dcmread
    # SC objects are written as bare Datasets (no preamble); force=True is required
    parsed = dcmread(io.BytesIO(sc_bytes), force=True)
    assert parsed.Modality == "SC"


def test_create_multiframe_attention_sc_frame_count_matches(srv):
    ds = _minimal_dicom()
    num_frames = 6
    attention_maps = _make_fake_attention_maps(num_frames=num_frames)
    sc_bytes = srv.create_multiframe_attention_sc(ds, attention_maps)
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sc_bytes), force=True)
    assert int(parsed.NumberOfFrames) == num_frames


def test_create_multiframe_attention_sc_references_original(srv):
    ds = _minimal_dicom()
    attention_maps = _make_fake_attention_maps()
    sc_bytes = srv.create_multiframe_attention_sc(ds, attention_maps)
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sc_bytes), force=True)
    assert parsed.ReferencedImageSequence[0].ReferencedSOPInstanceUID == ds.SOPInstanceUID


def test_create_multiframe_attention_sc_references_sr_when_given(srv):
    ds = _minimal_dicom()
    attention_maps = _make_fake_attention_maps()
    fake_sr_uid = generate_uid()
    sc_bytes = srv.create_multiframe_attention_sc(ds, attention_maps, sr_sop_instance_uid=fake_sr_uid)
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sc_bytes), force=True)
    assert hasattr(parsed, "ReferencedInstanceSequence")
    ref_uid = parsed.ReferencedInstanceSequence[0].ReferencedSOPInstanceUID
    assert str(ref_uid) == str(fake_sr_uid)


def test_create_multiframe_attention_sc_photometric_rgb(srv):
    ds = _minimal_dicom()
    attention_maps = _make_fake_attention_maps()
    sc_bytes = srv.create_multiframe_attention_sc(ds, attention_maps)
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sc_bytes), force=True)
    assert parsed.PhotometricInterpretation == "RGB"


# ---------------------------------------------------------------------------
# create_text_overlay_sc  (smoke — requires pixel_array on original_ds)
# ---------------------------------------------------------------------------

def test_create_text_overlay_sc_returns_bytes(srv):
    ds = _minimal_dicom_with_pixels()
    sc_bytes = srv.create_text_overlay_sc(ds, text="AI", color="red")
    assert isinstance(sc_bytes, bytes)
    assert len(sc_bytes) > 0


def test_create_text_overlay_sc_modality_is_sc(srv):
    ds = _minimal_dicom_with_pixels()
    sc_bytes = srv.create_text_overlay_sc(ds, text="TEST")
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sc_bytes), force=True)
    assert parsed.Modality == "SC"


def test_create_text_overlay_sc_has_content_sequence(srv):
    """SC includes a ContentSequence with model metadata mirroring the SR."""
    ds = _minimal_dicom_with_pixels()
    sc_bytes = srv.create_text_overlay_sc(ds, text="TEST")
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sc_bytes), force=True)
    assert hasattr(parsed, "ContentSequence")
    assert len(parsed.ContentSequence) >= 1


def test_create_text_overlay_sc_references_sr_when_given(srv):
    ds = _minimal_dicom_with_pixels()
    fake_sr_uid = generate_uid()
    sc_bytes = srv.create_text_overlay_sc(ds, text="TEST", sr_sop_instance_uid=fake_sr_uid)
    from pydicom import dcmread
    parsed = dcmread(io.BytesIO(sc_bytes), force=True)
    assert hasattr(parsed, "ReferencedInstanceSequence")
    ref_uid = parsed.ReferencedInstanceSequence[0].ReferencedSOPInstanceUID
    assert str(ref_uid) == str(fake_sr_uid)


# ---------------------------------------------------------------------------
# D5: OnStableStudy OnChange callback coverage
# ---------------------------------------------------------------------------

import json as _json
from types import SimpleNamespace as _SN
from unittest import mock as _mock


def _dicom_bytes_for(ds):
    """Serialize a pydicom Dataset to bytes (so orthanc.GetDicomForInstance can return real DICOM)."""
    import io as _io
    import pydicom as _pydicom
    buf = _io.BytesIO()
    _pydicom.dcmwrite(buf, ds, enforce_file_format=True)
    return buf.getvalue()


def _wire_minimal_stable_study_state(srv, rest_fake, dicom_fake,
                                       slice_spacing=None, slice_thickness=None,
                                       instance_count=1):
    """Bind orthanc REST + DICOM endpoints + one minimal study/series/instance state.

    Returns the SeriesInstanceUID so the test can assert on it later.
    """
    import orthanc
    # Default raisers were restored by autouse reset; rebind to rest_fake's dispatcher.
    orthanc.GetDicomForInstance = lambda iid: dicom_fake[iid]

    ds = _minimal_dicom()
    if slice_spacing is not None:
        ds.SpacingBetweenSlices = slice_spacing
    if slice_thickness is not None:
        ds.SliceThickness = slice_thickness

    dicom_buf = _dicom_bytes_for(ds)
    dicom_fake["I1"] = dicom_buf

    rest_fake.responses[("GET", "/studies/STUDY1/instances")] = _json.dumps(
        [{"ID": "I1"}] * instance_count
    ).encode()
    rest_fake.responses[("GET", "/instances/I1")] = _json.dumps(
        {"ParentSeries": "SE1", "IndexInSeries": 0}
    ).encode()
    rest_fake.responses[("GET", "/series/SE1")] = _json.dumps(
        {"Instances": ["I1"]}
    ).encode()
    rest_fake.responses[("GET", "/instances/I1/tags?simplify")] = _json.dumps(
        {"InstanceNumber": 1}
    ).encode()
    return ds.SeriesInstanceUID


def test_on_stable_study_skips_non_stable_study_change(srv, rest_fake):
    """A non-STABLE_STUDY change does nothing (no orthanc calls, no error)."""
    import orthanc
    srv.OnStableStudy(orthanc.ChangeType.STABLE_SERIES, None, "ANY")
    assert rest_fake.calls == []


def test_on_stable_study_returns_early_when_no_instances(srv, rest_fake):
    """Empty instances list -> return without exception or further REST calls."""
    import orthanc
    rest_fake.responses[("GET", "/studies/STUDY1/instances")] = b"[]"
    srv.OnStableStudy(orthanc.ChangeType.STABLE_STUDY, None, "STUDY1")
    # Only the initial GET fired; no /instances/<id> follow-up.
    methods_paths = [(m, u) for m, u, _ in rest_fake.calls]
    assert methods_paths == [("GET", "/studies/STUDY1/instances")]


def test_on_stable_study_returns_when_model_returns_non_200(srv, rest_fake, dicom_fake, monkeypatch):
    """Model backend non-200 -> log + return; no DICOM upload attempted."""
    import orthanc
    _wire_minimal_stable_study_state(srv, rest_fake, dicom_fake)

    posts = []
    def _post(url, **kw):
        posts.append((url, kw))
        if "/analyze/mri" in url:
            return _SN(status_code=500, text="model down", json=lambda: {})
        raise AssertionError(f"unexpected POST to {url}")
    monkeypatch.setattr(srv.requests, "post", _post)

    srv.OnStableStudy(orthanc.ChangeType.STABLE_STUDY, None, "STUDY1")
    # Exactly one POST (the model call); no /instances upload happened.
    assert len(posts) == 1
    assert "/analyze/mri" in posts[0][0]


def test_on_stable_study_swallows_model_network_exception(srv, rest_fake, dicom_fake, monkeypatch):
    """RequestException during the model call is caught; function returns without raising."""
    import orthanc
    import requests as _req_lib
    _wire_minimal_stable_study_state(srv, rest_fake, dicom_fake)

    monkeypatch.setattr(srv.requests, "post",
                          _mock.MagicMock(side_effect=_req_lib.exceptions.ConnectionError("refused")))
    # Must NOT raise.
    srv.OnStableStudy(orthanc.ChangeType.STABLE_STUDY, None, "STUDY1")


def test_on_stable_study_uploads_sr_for_bilateral_response(srv, rest_fake, dicom_fake, monkeypatch):
    """Bilateral response_format -> create_bilateral_sr -> single SR uploaded to viewer."""
    import orthanc
    _wire_minimal_stable_study_state(srv, rest_fake, dicom_fake)

    bilateral_results = {
        "left": {"prediction": "Benign", "confidence": 95.0},
        "right": {"prediction": "Malignant", "confidence": 80.0},
    }
    model_resp = _SN(status_code=200, text="ok", json=lambda: bilateral_results)
    upload_resp = _SN(status_code=200, text="ok", json=lambda: {})

    posts = []
    def _post(url, **kw):
        posts.append((url, kw))
        return upload_resp if "/instances" in url else model_resp
    monkeypatch.setattr(srv.requests, "post", _post)

    # Stub the heavy SR builder to a deterministic byte tag.
    monkeypatch.setattr(srv, "create_bilateral_sr",
                          lambda original_ds, results: (b"SR_BYTES", "20260101", "120000.000", "1.2.3.sr.uid"))

    srv.OnStableStudy(orthanc.ChangeType.STABLE_STUDY, None, "STUDY1")

    upload_calls = [p for p in posts if "/instances" in p[0]]
    assert len(upload_calls) == 1
    assert upload_calls[0][1].get("data") == b"SR_BYTES"


def test_on_stable_study_uploads_sr_and_sc_for_bilateral_with_heatmap(srv, rest_fake, dicom_fake, monkeypatch):
    """bilateral_with_heatmap response_format -> SR + multi-frame SC both uploaded."""
    import orthanc
    _wire_minimal_stable_study_state(srv, rest_fake, dicom_fake)

    results = {
        "left": {"prediction": "Benign", "confidence": 95.0},
        "right": {"prediction": "Malignant", "confidence": 80.0},
        "attention_maps": {"data": "BASE64DATA", "shape": [5, 16, 16, 3], "dtype": "uint8"},
    }
    model_resp = _SN(status_code=200, text="ok", json=lambda: results)
    upload_resp = _SN(status_code=200, text="ok", json=lambda: {})
    posts = []
    def _post(url, **kw):
        posts.append((url, kw))
        return upload_resp if "/instances" in url else model_resp
    monkeypatch.setattr(srv.requests, "post", _post)

    monkeypatch.setattr(srv, "create_bilateral_sr",
                          lambda original_ds, results: (b"SR_BYTES", "20260101", "120000.000", "1.2.3.sr.uid"))
    monkeypatch.setattr(srv, "create_multiframe_attention_sc",
                          lambda *a, **kw: b"SC_BYTES")

    srv.OnStableStudy(orthanc.ChangeType.STABLE_STUDY, None, "STUDY1")

    upload_calls = [p for p in posts if "/instances" in p[0]]
    upload_payloads = [p[1].get("data") for p in upload_calls]
    assert b"SR_BYTES" in upload_payloads
    assert b"SC_BYTES" in upload_payloads
    assert len(upload_calls) == 2


def test_on_stable_study_continues_when_upload_returns_non_200(srv, rest_fake, dicom_fake, monkeypatch):
    """Non-200 upload response logs but does not raise; function returns normally."""
    import orthanc
    _wire_minimal_stable_study_state(srv, rest_fake, dicom_fake)
    bilateral_results = {
        "left": {"prediction": "Benign", "confidence": 95.0},
        "right": {"prediction": "Malignant", "confidence": 80.0},
    }
    model_resp = _SN(status_code=200, text="ok", json=lambda: bilateral_results)
    bad_upload = _SN(status_code=500, text="store failed", json=lambda: {})
    monkeypatch.setattr(srv.requests, "post",
                          lambda url, **kw: bad_upload if "/instances" in url else model_resp)
    monkeypatch.setattr(srv, "create_bilateral_sr",
                          lambda *a, **kw: (b"SR_BYTES", "20260101", "120000.000", "1.2.3.sr.uid"))
    # Must NOT raise even though upload reports failure.
    srv.OnStableStudy(orthanc.ChangeType.STABLE_STUDY, None, "STUDY1")


def test_on_stable_study_uses_slice_thickness_when_spacing_between_slices_absent(srv, rest_fake, dicom_fake, monkeypatch):
    """Code path: SliceThickness fallback when SpacingBetweenSlices is missing."""
    import orthanc
    _wire_minimal_stable_study_state(srv, rest_fake, dicom_fake, slice_thickness=2.5)
    bilateral_results = {
        "left": {"prediction": "Benign", "confidence": 95.0},
        "right": {"prediction": "Malignant", "confidence": 80.0},
    }
    model_resp = _SN(status_code=200, text="ok", json=lambda: bilateral_results)
    upload_resp = _SN(status_code=200, text="ok", json=lambda: {})
    monkeypatch.setattr(srv.requests, "post",
                          lambda url, **kw: upload_resp if "/instances" in url else model_resp)
    monkeypatch.setattr(srv, "create_bilateral_sr",
                          lambda *a, **kw: (b"SR_BYTES", "20260101", "120000.000", "1.2.3.sr.uid"))
    # Just verify it runs without raising; SliceThickness fallback path is exercised.
    srv.OnStableStudy(orthanc.ChangeType.STABLE_STUDY, None, "STUDY1")


def test_on_stable_study_outer_exception_swallowed(srv, rest_fake, dicom_fake):
    """When orthanc.RestApiGet raises for the initial /studies/<id>/instances, outer try catches."""
    import orthanc
    # No binding for /studies/STUDY1/instances -> rest_fake raises -> outer except logs and returns.
    srv.OnStableStudy(orthanc.ChangeType.STABLE_STUDY, None, "STUDY1")
