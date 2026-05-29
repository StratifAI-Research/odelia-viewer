"""Unit tests for router/ups/processor.py — notify and process_workitem.

Coverage:
  - notify_subscriber: happy path (200), HTTP error swallowed (non-200), network error swallowed
  - notify_all_subscribers: calls notify_subscriber for each registered subscriber
  - process_workitem: smoke test — at minimum transitions to IN_PROGRESS before heavy work
"""
import sys
from types import SimpleNamespace
from unittest import mock

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

import os as _os
_ROUTER_DIR = _os.path.abspath(
    _os.path.join(_os.path.dirname(__file__), '..', '..', '..', 'router')
)


def _ensure_router_path():
    """Ensure router/ is at front of sys.path so ups.* resolves to router/ups/."""
    if _ROUTER_DIR in sys.path:
        sys.path.remove(_ROUTER_DIR)
    sys.path.insert(0, _ROUTER_DIR)


def _evict_ups():
    _ensure_router_path()
    for key in [k for k in sys.modules if k == "ups" or k.startswith("ups.")]:
        del sys.modules[key]


def _make_workitem(uid="2.25.proc1"):
    _evict_ups()
    from ups.workitem import UPSWorkitem
    return UPSWorkitem(
        study_uid="1.2.3",
        series_uids=["1.2.3.1"],
        wado_rs_retrieval=[
            {"retrieval_url": "http://x/studies/1.2.3", "study_uid": "1.2.3", "series_uid": "1.2.3.1"}
        ],
        priority="MEDIUM",
        workitem_uid=uid,
    )


@pytest.fixture(autouse=True)
def _router_path_guard():
    """Ensure router/ is at sys.path[0] for each test; restore after."""
    saved = list(sys.path)
    _ensure_router_path()
    yield
    sys.path[:] = saved


@pytest.fixture
def proc():
    _evict_ups()
    import ups.processor as p
    return p


@pytest.fixture
def fake_workitem():
    return _make_workitem()


# ---------------------------------------------------------------------------
# notify_subscriber
# ---------------------------------------------------------------------------

def test_notify_subscriber_happy_path(proc, fake_workitem):
    """Successful POST returns 200; no exception raised."""
    mock_response = SimpleNamespace(status_code=200)
    with mock.patch('ups.processor.requests.post', return_value=mock_response) as m:
        proc.notify_subscriber(fake_workitem, "http://viewer:8042")
    m.assert_called_once()
    call_kwargs = m.call_args
    # URL should include workitem UID
    url_arg = call_kwargs[0][0] if call_kwargs[0] else call_kwargs[1].get('url', '')
    assert fake_workitem.workitem_uid in url_arg


def test_notify_subscriber_non_200_does_not_raise(proc, fake_workitem):
    """Non-200 response is logged but does not raise."""
    mock_response = SimpleNamespace(status_code=503)
    with mock.patch('ups.processor.requests.post', return_value=mock_response):
        proc.notify_subscriber(fake_workitem, "http://viewer:8042")  # must not raise


def test_notify_subscriber_network_error_swallowed(proc, fake_workitem):
    """Network exception is swallowed (subscriber failure must not crash workflow)."""
    import requests as req_lib
    with mock.patch('ups.processor.requests.post', side_effect=req_lib.exceptions.ConnectionError("refused")):
        proc.notify_subscriber(fake_workitem, "http://unreachable:9999")  # must not raise


def test_notify_subscriber_posts_to_correct_url(proc, fake_workitem):
    """POST URL should be subscriber_url/ups-rs/workitems/{uid}."""
    captured = {}
    def fake_post(url, **kwargs):
        captured['url'] = url
        return SimpleNamespace(status_code=200)
    with mock.patch('ups.processor.requests.post', side_effect=fake_post):
        proc.notify_subscriber(fake_workitem, "http://viewer:8042")
    assert captured['url'] == f"http://viewer:8042/ups-rs/workitems/{fake_workitem.workitem_uid}"


def test_notify_subscriber_sends_json_content_type(proc, fake_workitem):
    """POST should include application/dicom+json Content-Type header."""
    captured = {}
    def fake_post(url, **kwargs):
        captured['headers'] = kwargs.get('headers', {})
        return SimpleNamespace(status_code=200)
    with mock.patch('ups.processor.requests.post', side_effect=fake_post):
        proc.notify_subscriber(fake_workitem, "http://viewer:8042")
    assert captured['headers'].get('Content-Type') == 'application/dicom+json'


# ---------------------------------------------------------------------------
# notify_all_subscribers
# ---------------------------------------------------------------------------

def test_notify_all_subscribers_calls_notify_for_each_subscriber(proc, fake_workitem):
    """notify_all_subscribers should call notify_subscriber for every registered subscriber."""
    from ups.subscription_storage import subscription_storage
    subscription_storage.add_subscription(fake_workitem.workitem_uid, "http://viewer-a:8042")
    subscription_storage.add_subscription(fake_workitem.workitem_uid, "http://viewer-b:8042")

    notified = []
    with mock.patch.object(proc, 'notify_subscriber', side_effect=lambda wi, url: notified.append(url)):
        proc.notify_all_subscribers(fake_workitem)

    assert "http://viewer-a:8042" in notified
    assert "http://viewer-b:8042" in notified
    assert len(notified) == 2


def test_notify_all_subscribers_no_subscribers_does_not_raise(proc, fake_workitem):
    """No subscribers registered: should not raise, just log."""
    with mock.patch('ups.processor.requests.post') as m:
        proc.notify_all_subscribers(fake_workitem)
    m.assert_not_called()


def test_notify_all_subscribers_includes_global_subscriber(proc, fake_workitem):
    """Global subscriptions should be included in notifications."""
    from ups.subscription_storage import subscription_storage
    subscription_storage.add_global_subscription("http://global-viewer:8042")

    notified = []
    with mock.patch.object(proc, 'notify_subscriber', side_effect=lambda wi, url: notified.append(url)):
        proc.notify_all_subscribers(fake_workitem)

    assert "http://global-viewer:8042" in notified


# ---------------------------------------------------------------------------
# process_workitem (smoke)
# ---------------------------------------------------------------------------

def test_process_workitem_transitions_state_to_in_progress(proc, fake_workitem, monkeypatch):
    """
    With a 500 model mock, process_workitem must move SCHEDULED -> IN_PROGRESS -> CANCELED.
    Captures the state sequence via a wrapped store_workitem so we can pin the transition.
    """
    mock_model_resp = SimpleNamespace(
        status_code=500,
        text="mocked model error",
        json=lambda: {},
    )
    monkeypatch.setattr('ups.processor.requests.post', lambda *a, **kw: mock_model_resp)
    monkeypatch.setattr(proc, 'notify_all_subscribers', lambda *a, **kw: None)

    # Patch via proc.ups_storage (NOT a fresh `from ups.storage import ...` — that
    # would re-import after `_make_workitem` evicted `ups.*` from sys.modules,
    # producing a different singleton from the one process_workitem actually uses).
    states = []
    real_store = proc.ups_storage.store_workitem

    def _capture_then_store(wi):
        states.append(wi.get_state())
        real_store(wi)

    monkeypatch.setattr(proc.ups_storage, 'store_workitem', _capture_then_store)

    assert fake_workitem.get_state() == 'SCHEDULED'

    try:
        proc.process_workitem(fake_workitem)
    except Exception:
        pass  # processor may bail out on model error; that's expected

    # The state sequence must show IN_PROGRESS before terminating in CANCELED.
    # Captures any silent regression that skips the IN_PROGRESS transition.
    assert 'IN_PROGRESS' in states, f"expected IN_PROGRESS in transitions, got {states}"
    assert states[-1] == 'CANCELED', f"expected final state CANCELED, got {states[-1]!r}"


def test_process_workitem_cancels_on_model_network_error(proc, fake_workitem, monkeypatch):
    """
    When the model backend call raises a network exception,
    process_workitem should catch it and set state to CANCELED.
    """
    import requests as req_lib

    monkeypatch.setattr(
        'ups.processor.requests.post',
        mock.Mock(side_effect=req_lib.exceptions.ConnectionError("refused"))
    )
    monkeypatch.setattr(proc, 'notify_all_subscribers', lambda *a, **kw: None)

    try:
        proc.process_workitem(fake_workitem)
    except Exception:
        pass

    final_state = fake_workitem.get_state()
    assert final_state == 'CANCELED'


def test_process_workitem_stores_updated_workitem(proc, fake_workitem, monkeypatch):
    """process_workitem must persist state changes to ups_storage."""
    mock_model_resp = SimpleNamespace(
        status_code=500,
        text="mocked error",
        json=lambda: {},
    )
    monkeypatch.setattr('ups.processor.requests.post', lambda *a, **kw: mock_model_resp)
    monkeypatch.setattr(proc, 'notify_subscriber', lambda *a, **kw: None)

    try:
        proc.process_workitem(fake_workitem)
    except Exception:
        pass

    from ups.storage import ups_storage
    stored = ups_storage.get_workitem(fake_workitem.workitem_uid)
    assert stored is not None
    assert stored.get_state() == 'CANCELED'
