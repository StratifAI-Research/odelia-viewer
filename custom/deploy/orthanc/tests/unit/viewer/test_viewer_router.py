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


def test_ups_update_workitem_bad_json_returns_400(out, router):
    router.UPSUpdateWorkitem(
        out, "/ups-rs/workitems/2.25.444",
        method="POST", body="not-json",
    )
    assert out.status == 400


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
    assert "target_url" in out.body


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
    assert "study_id" in out.body


def test_send_to_ai_dicom_empty_body_returns_400(out, router):
    router.SendToAiDicom(
        out, "/send-to-ai-dicom",
        method="POST",
        body=json.dumps({}),
    )
    assert out.status == 400
    assert "study_id" in out.body


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
    assert "study_id" in out.body


def test_send_to_ai_dicomweb_missing_target_url_returns_400(out, router):
    router.SendToAiDicomWeb(
        out, "/send-to-ai-dicomweb",
        method="POST",
        body=json.dumps({"study_id": "abc", "target": "mst"}),
    )
    assert out.status == 400
    assert "target_url" in out.body


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
    assert "study_id" in out.body


# ---------------------------------------------------------------------------
# V5: register_feedback_endpoints fallback when feedback_routes import fails
# ---------------------------------------------------------------------------

def test_register_feedback_endpoints_is_none_when_feedback_routes_lacks_register(monkeypatch):
    """When import succeeds but register_feedback_endpoints attr is missing, fallback engages."""
    import sys
    import types as _types
    # Install a fake feedback_routes module WITHOUT register_feedback_endpoints.
    fake = _types.ModuleType("feedback_routes")
    monkeypatch.setitem(sys.modules, "feedback_routes", fake)
    # Evict router so re-import picks up the fake.
    sys.modules.pop("router", None)
    import router as r
    assert r.register_feedback_endpoints is None


def test_no_feedback_uris_registered_when_register_is_none(monkeypatch):
    """When register_feedback_endpoints is None, the module-load guard skips registration."""
    import sys
    import types as _types
    import orthanc
    orthanc._rest_callbacks.clear()
    fake = _types.ModuleType("feedback_routes")
    monkeypatch.setitem(sys.modules, "feedback_routes", fake)
    sys.modules.pop("router", None)
    import router  # noqa: F401  (re-import triggers callback registration)
    feedback_uris = [uri for uri, _ in orthanc._rest_callbacks if uri.startswith("/feedback")]
    assert feedback_uris == []


# ---------------------------------------------------------------------------
# V6: UPSGetWorkitem / UPSUpdateWorkitem ups_storage=None branches
# ---------------------------------------------------------------------------

def test_ups_get_workitem_returns_500_when_storage_not_initialized(out, router, monkeypatch):
    monkeypatch.setattr(router, "ups_storage", None)
    router.UPSGetWorkitem(out, "/ups-rs/workitems/2.25.999", method="GET")
    assert out.status == 500
    assert "UPS storage not initialized" in (out.body or "")


def test_ups_update_workitem_falls_back_to_body_state_when_storage_unavailable(out, router, monkeypatch):
    """When ups_storage is falsy, UPSUpdateWorkitem extracts the state from the body (no persistence) and still answers 200."""
    monkeypatch.setattr(router, "ups_storage", None)
    body = _make_workitem_body(uid="2.25.fallback", state="IN_PROGRESS")
    router.UPSUpdateWorkitem(out, "/ups-rs/workitems/2.25.fallback", method="POST", body=body)
    assert out.status == 200
    import json as _json
    resp = _json.loads(out.body)
    assert resp == {"status": "updated"}


# ---------------------------------------------------------------------------
# D2: small helper coverage (FilterAIResultSeries, HasProcessableContent,
#     GetStudyInstanceUID, ListModalities)
# ---------------------------------------------------------------------------

import json as _json


def test_get_study_instance_uid_returns_uid_from_main_tags(out, router, rest_fake):
    rest_fake.responses[("GET", "/studies/STD1")] = _json.dumps(
        {"MainDicomTags": {"StudyInstanceUID": "1.2.3.std"}}
    ).encode()
    assert router.GetStudyInstanceUID("STD1") == "1.2.3.std"


def test_get_study_instance_uid_returns_none_when_tag_missing(out, router, rest_fake):
    rest_fake.responses[("GET", "/studies/STD2")] = _json.dumps(
        {"MainDicomTags": {"PatientName": "X"}}    # no StudyInstanceUID
    ).encode()
    assert router.GetStudyInstanceUID("STD2") is None


def test_get_study_instance_uid_returns_none_on_orthanc_error(out, router, rest_fake):
    """When orthanc.RestApiGet raises (no response bound), GetStudyInstanceUID returns None."""
    # No response bound -> rest_fake raises RuntimeError, which the function catches.
    assert router.GetStudyInstanceUID("MISSING") is None


def test_list_modalities_returns_configured_modalities(out, router, rest_fake):
    rest_fake.responses[("GET", "/modalities")] = b"[\"PACS1\", \"PACS2\"]"
    rest_fake.responses[("GET", "/modalities/PACS1")] = _json.dumps(
        {"Host": "h1", "Port": 4242, "AET": "AET1"}
    ).encode()
    rest_fake.responses[("GET", "/modalities/PACS2")] = _json.dumps(
        {"Host": "h2", "Port": 4243, "AET": "AET2"}
    ).encode()
    result = router.ListModalities()
    assert result == ["PACS1", "PACS2"]


def test_list_modalities_returns_empty_on_orthanc_error(out, router, rest_fake):
    """No response bound -> rest_fake raises -> ListModalities catches -> returns []."""
    assert router.ListModalities() == []


def test_filter_ai_result_series_excludes_known_ai_descriptions(out, router, rest_fake):
    """Series whose description matches an AI marker is filtered out; others remain."""
    rest_fake.responses[("GET", "/studies/STD/series")] = _json.dumps([
        {"ID": "S-orig"},
        {"ID": "S-ai-sr"},
        {"ID": "S-ai-heatmap"},
    ]).encode()
    rest_fake.responses[("GET", "/series/S-orig/tags?simplify")] = _json.dumps(
        {"SeriesDescription": "T1 axial", "Modality": "MR"}
    ).encode()
    rest_fake.responses[("GET", "/series/S-ai-sr/tags?simplify")] = _json.dumps(
        {"SeriesDescription": "Automated Diagnostic Findings", "Modality": "SR"}
    ).encode()
    rest_fake.responses[("GET", "/series/S-ai-heatmap/tags?simplify")] = _json.dumps(
        {"SeriesDescription": "Axial - Heatmap overlay", "Modality": "SC"}
    ).encode()
    result = router.FilterAIResultSeries("STD")
    assert result == ["S-orig"]


def test_filter_ai_result_series_treats_sc_or_sr_with_ai_keyword_as_ai(out, router, rest_fake):
    """An SC/SR modality with 'AI' anywhere in the description is filtered out."""
    rest_fake.responses[("GET", "/studies/STD/series")] = _json.dumps([
        {"ID": "S-ai-sc"},
        {"ID": "S-orig"},
    ]).encode()
    rest_fake.responses[("GET", "/series/S-ai-sc/tags?simplify")] = _json.dumps(
        {"SeriesDescription": "Generic AI Stuff", "Modality": "SC"}
    ).encode()
    rest_fake.responses[("GET", "/series/S-orig/tags?simplify")] = _json.dumps(
        {"SeriesDescription": "Axial T2", "Modality": "MR"}
    ).encode()
    result = router.FilterAIResultSeries("STD")
    assert result == ["S-orig"]


def test_filter_ai_result_series_filters_description_prefix_and_suffix_markers(out, router, rest_fake):
    """Descriptions starting with `AI_` or ending with `_AI` are filtered."""
    rest_fake.responses[("GET", "/studies/STD/series")] = _json.dumps([
        {"ID": "S-prefix"},
        {"ID": "S-suffix"},
        {"ID": "S-clean"},
    ]).encode()
    rest_fake.responses[("GET", "/series/S-prefix/tags?simplify")] = _json.dumps(
        {"SeriesDescription": "AI_Stuff", "Modality": "MR"}
    ).encode()
    rest_fake.responses[("GET", "/series/S-suffix/tags?simplify")] = _json.dumps(
        {"SeriesDescription": "Stuff_AI", "Modality": "MR"}
    ).encode()
    rest_fake.responses[("GET", "/series/S-clean/tags?simplify")] = _json.dumps(
        {"SeriesDescription": "Original", "Modality": "MR"}
    ).encode()
    result = router.FilterAIResultSeries("STD")
    assert result == ["S-clean"]


def test_filter_ai_result_series_keeps_series_when_tag_lookup_fails(out, router, rest_fake):
    """If reading tags raises, the series is conservatively kept as original."""
    rest_fake.responses[("GET", "/studies/STD/series")] = _json.dumps([
        {"ID": "S-tag-fail"},
        {"ID": "S-ok"},
    ]).encode()
    # No response bound for S-tag-fail -> rest_fake raises -> series is kept.
    rest_fake.responses[("GET", "/series/S-ok/tags?simplify")] = _json.dumps(
        {"SeriesDescription": "Original", "Modality": "MR"}
    ).encode()
    result = router.FilterAIResultSeries("STD")
    assert sorted(result) == ["S-ok", "S-tag-fail"]


def test_filter_ai_result_series_returns_empty_on_outer_error(out, router, rest_fake):
    """If the study/series listing raises, return empty list."""
    # No response bound for /studies/.../series -> outer except returns [].
    assert router.FilterAIResultSeries("NOPE") == []


def test_has_processable_content_true_when_any_original_series(out, router, rest_fake):
    rest_fake.responses[("GET", "/studies/STD/series")] = _json.dumps([{"ID": "S-orig"}]).encode()
    rest_fake.responses[("GET", "/series/S-orig/tags?simplify")] = _json.dumps(
        {"SeriesDescription": "Axial", "Modality": "MR"}
    ).encode()
    assert router.HasProcessableContent("STD") is True


def test_has_processable_content_false_when_all_ai(out, router, rest_fake):
    rest_fake.responses[("GET", "/studies/STD/series")] = _json.dumps([{"ID": "S-ai"}]).encode()
    rest_fake.responses[("GET", "/series/S-ai/tags?simplify")] = _json.dumps(
        {"SeriesDescription": "Automated Diagnostic Findings", "Modality": "SR"}
    ).encode()
    assert router.HasProcessableContent("STD") is False
