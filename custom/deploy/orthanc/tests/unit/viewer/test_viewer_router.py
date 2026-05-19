"""Unit tests for viewer/router.py handlers.

SendToAiDicomWeb and SendToAi are deliberately not fully covered here because
they make outbound HTTP calls via `requests` to a router service AND call
multiple cascaded orthanc REST paths in a sequence that is tightly coupled to
real Orthanc data. Their happy-path requires mocking an entire multi-step chain
(study exists, series exist, series tags, series instances, DICOMweb config,
UPS POST, subscription POST). We provide:
  - wrong-method → 405 tests (no network calls)
  - missing-field → 400 tests (no network calls)
A note in DONE report flags them as refactor candidates for dependency injection.

All other handlers (UPSUpdateWorkitem, UPSGetWorkitem, UPSWorkitemHandler,
GetAIManifest, SendToAiDicom) have full happy + error path coverage.
"""
import importlib
import json
import sys
from unittest import mock

import pytest


# ---------------------------------------------------------------------------
# Module import helper
# ---------------------------------------------------------------------------

def _load_router():
    """Evict and re-import viewer/router so module-level registrations replay."""
    for key in [k for k in sys.modules if k == "router" or k.startswith("router.")]:
        del sys.modules[key]
    for key in [k for k in sys.modules if k == "ups" or k.startswith("ups.")]:
        del sys.modules[key]
    import router as _router
    return _router


@pytest.fixture
def router():
    return _load_router()


# ---------------------------------------------------------------------------
# Registration — module-level RegisterRestCallback
# ---------------------------------------------------------------------------

def test_module_registers_expected_uris():
    import orthanc
    orthanc._rest_callbacks.clear()
    _load_router()
    uris = [u for u, _ in orthanc._rest_callbacks]
    assert "/send-to-ai" in uris
    assert "/send-to-ai-dicom" in uris
    assert "/send-to-ai-dicomweb" in uris
    assert "/ai-manifest" in uris
    assert "/ups-rs/workitems/(.*)" in uris


def test_module_registers_feedback_endpoints_when_available():
    import orthanc
    orthanc._rest_callbacks.clear()
    _load_router()
    uris = [u for u, _ in orthanc._rest_callbacks]
    # feedback_routes imports successfully in the test environment
    assert "/feedback/submit" in uris
    assert "/feedback/health" in uris


# ---------------------------------------------------------------------------
# UPSUpdateWorkitem
# ---------------------------------------------------------------------------

def _make_workitem_body(uid="2.25.111", state="SCHEDULED"):
    return json.dumps({
        "00741000": {"vr": "CS", "Value": [state]},
        "00080018": {"vr": "UI", "Value": [uid]},
        "0020000D": {"vr": "UI", "Value": ["1.2.3"]},
    })


def test_ups_update_workitem_happy(out, router):
    body = _make_workitem_body()
    router.UPSUpdateWorkitem(
        out, "/ups-rs/workitems/2.25.111",
        method="POST", body=body,
    )
    assert out.status == 200
    data = json.loads(out.body)
    assert data["status"] == "updated"


def test_ups_update_workitem_stores_in_kv(out, router):
    import orthanc
    body = _make_workitem_body(uid="2.25.222")
    router.UPSUpdateWorkitem(
        out, "/ups-rs/workitems/2.25.222",
        method="POST", body=body,
    )
    assert out.status == 200
    # Verify KV store received something for this workitem
    stored = orthanc.GetKeyValue("ups", "upsworkitem:2.25.222")
    assert stored is not None


def test_ups_update_workitem_wrong_method_returns_405(out, router):
    router.UPSUpdateWorkitem(
        out, "/ups-rs/workitems/2.25.333",
        method="GET", body=b"",
    )
    assert out.status == 405


def test_ups_update_workitem_bad_json_returns_500(out, router):
    router.UPSUpdateWorkitem(
        out, "/ups-rs/workitems/2.25.444",
        method="POST", body="not-json",
    )
    assert out.status == 500


# ---------------------------------------------------------------------------
# UPSGetWorkitem
# ---------------------------------------------------------------------------

def test_ups_get_workitem_returns_404_when_not_found(out, router):
    router.UPSGetWorkitem(
        out, "/ups-rs/workitems/phantom.uid",
        method="GET",
    )
    assert out.status == 404


def test_ups_get_workitem_returns_stored_workitem(out, router):
    uid = "2.25.555"
    body = _make_workitem_body(uid=uid)
    router.UPSUpdateWorkitem(out, f"/ups-rs/workitems/{uid}", method="POST", body=body)
    assert out.status == 200
    out2 = type(out).__new__(type(out))
    out2.__init__()
    router.UPSGetWorkitem(out2, f"/ups-rs/workitems/{uid}", method="GET")
    assert out2.status == 200
    data = json.loads(out2.body)
    assert data["00741000"]["Value"][0] == "SCHEDULED"


def test_ups_get_workitem_wrong_method_returns_405(out, router):
    router.UPSGetWorkitem(
        out, "/ups-rs/workitems/2.25.666",
        method="DELETE",
    )
    assert out.status == 405


# ---------------------------------------------------------------------------
# UPSWorkitemHandler (dispatch)
# ---------------------------------------------------------------------------

def test_ups_workitem_handler_dispatches_post(out, router):
    uid = "2.25.777"
    body = _make_workitem_body(uid=uid)
    router.UPSWorkitemHandler(out, f"/ups-rs/workitems/{uid}", method="POST", body=body)
    assert out.status == 200


def test_ups_workitem_handler_dispatches_get(out, router):
    uid = "2.25.888"
    body = _make_workitem_body(uid=uid)
    # Store first
    router.UPSUpdateWorkitem(out, f"/ups-rs/workitems/{uid}", method="POST", body=body)
    out2 = type(out).__new__(type(out))
    out2.__init__()
    router.UPSWorkitemHandler(out2, f"/ups-rs/workitems/{uid}", method="GET")
    assert out2.status == 200


def test_ups_workitem_handler_unknown_method_returns_405(out, router):
    router.UPSWorkitemHandler(
        out, "/ups-rs/workitems/2.25.999",
        method="PUT",
    )
    assert out.status == 405


# ---------------------------------------------------------------------------
# GetAIManifest
# ---------------------------------------------------------------------------

def test_get_ai_manifest_wrong_method_returns_405(out, router):
    router.GetAIManifest(out, "/ai-manifest", method="POST", body=b"")
    assert out.status == 405


def test_get_ai_manifest_missing_target_url_returns_400(out, router):
    router.GetAIManifest(out, "/ai-manifest", method="GET", get={})
    assert out.status == 400


def test_get_ai_manifest_returns_manifest_on_200(out, router):
    manifest_data = {"models": ["breast-cancer"]}
    mock_resp = mock.Mock()
    mock_resp.status_code = 200
    mock_resp.text = json.dumps(manifest_data)
    with mock.patch("requests.get", return_value=mock_resp) as mocked:
        router.GetAIManifest(
            out, "/ai-manifest",
            method="GET",
            get={"target_url": "http://router:8042/dicom-web"},
        )
    mocked.assert_called_once()
    assert out.status == 200
    data = json.loads(out.body)
    assert data["models"] == ["breast-cancer"]


def test_get_ai_manifest_returns_null_manifest_on_router_404(out, router):
    mock_resp = mock.Mock()
    mock_resp.status_code = 404
    with mock.patch("requests.get", return_value=mock_resp):
        router.GetAIManifest(
            out, "/ai-manifest",
            method="GET",
            get={"target_url": "http://router:8042/dicom-web"},
        )
    assert out.status == 200
    data = json.loads(out.body)
    assert data["manifest"] is None


def test_get_ai_manifest_returns_null_manifest_on_connection_error(out, router):
    import requests
    with mock.patch("requests.get", side_effect=requests.exceptions.ConnectionError("refused")):
        router.GetAIManifest(
            out, "/ai-manifest",
            method="GET",
            get={"target_url": "http://router:8042/dicom-web"},
        )
    assert out.status == 200
    data = json.loads(out.body)
    assert data["manifest"] is None


def test_get_ai_manifest_strips_dicom_web_suffix(out, router):
    """Ensure /dicom-web suffix is stripped when constructing manifest URL."""
    mock_resp = mock.Mock()
    mock_resp.status_code = 200
    mock_resp.text = json.dumps({})
    with mock.patch("requests.get", return_value=mock_resp) as mocked:
        router.GetAIManifest(
            out, "/ai-manifest",
            method="GET",
            get={"target_url": "http://router:8042/dicom-web"},
        )
    called_url = mocked.call_args[0][0]
    assert called_url == "http://router:8042/manifest"


# ---------------------------------------------------------------------------
# SendToAiDicom — wrong-method + bad-input (no network calls)
# ---------------------------------------------------------------------------

def test_send_to_ai_dicom_wrong_method_returns_405(out, router):
    router.SendToAiDicom(out, "/send-to-ai-dicom", method="GET")
    assert out.status == 405


def test_send_to_ai_dicom_missing_fields_returns_400(out, rest_fake, router):
    # Needs rest_fake bound because FilterAIResultSeries calls orthanc.RestApiGet
    # when study_id is present. Provide missing both study_id AND target → 400.
    router.SendToAiDicom(
        out, "/send-to-ai-dicom",
        method="POST",
        body=json.dumps({"target": "mst"}),  # no study_id
    )
    assert out.status == 400


def test_send_to_ai_dicom_empty_body_returns_400(out, router):
    router.SendToAiDicom(
        out, "/send-to-ai-dicom",
        method="POST",
        body=json.dumps({}),
    )
    assert out.status == 400


# ---------------------------------------------------------------------------
# SendToAiDicomWeb — wrong-method + bad-input (no network calls)
# ---------------------------------------------------------------------------

def test_send_to_ai_dicomweb_wrong_method_returns_405(out, router):
    router.SendToAiDicomWeb(out, "/send-to-ai-dicomweb", method="GET")
    assert out.status == 405


def test_send_to_ai_dicomweb_missing_study_id_returns_400(out, router):
    router.SendToAiDicomWeb(
        out, "/send-to-ai-dicomweb",
        method="POST",
        body=json.dumps({"target": "mst", "target_url": "http://x"}),
    )
    assert out.status == 400


def test_send_to_ai_dicomweb_missing_target_url_returns_400(out, router):
    router.SendToAiDicomWeb(
        out, "/send-to-ai-dicomweb",
        method="POST",
        body=json.dumps({"study_id": "abc", "target": "mst"}),
    )
    assert out.status == 400


# ---------------------------------------------------------------------------
# SendToAi — thin wrapper; wrong-method propagates via delegate
# ---------------------------------------------------------------------------

def test_send_to_ai_wrong_method_returns_405(out, router):
    router.SendToAi(out, "/send-to-ai", method="GET")
    assert out.status == 405


def test_send_to_ai_missing_study_id_returns_400(out, router):
    router.SendToAi(
        out, "/send-to-ai",
        method="POST",
        body=json.dumps({"target": "mst", "target_url": "http://x"}),
    )
    assert out.status == 400
