"""Unit tests for viewer/ups/storage.py — KV-backed UPS workitem storage."""
import sys

import pytest


@pytest.fixture
def storage():
    # Evict cached module so KV-backed state is fresh per test
    for key in [k for k in sys.modules if k == "ups" or k.startswith("ups.")]:
        del sys.modules[key]
    from ups.storage import UPSStorage
    return UPSStorage()


@pytest.fixture
def workitem():
    """Return a minimal UPSWorkitem for use in storage tests."""
    for key in [k for k in sys.modules if k == "ups" or k.startswith("ups.")]:
        del sys.modules[key]
    from ups.workitem import UPSWorkitem
    return UPSWorkitem(
        study_uid="1.2.3.4",
        series_uids=["1.2.3.4.1"],
        wado_rs_retrieval=[
            {
                "retrieval_url": "http://orthanc:8042/wado-rs/studies/1.2.3.4",
                "study_uid": "1.2.3.4",
                "series_uid": "1.2.3.4.1",
            }
        ],
        priority="MEDIUM",
        workitem_uid="2.25.99999",
    )


# ---------------------------------------------------------------------------
# Round-trip: store then get
# ---------------------------------------------------------------------------

def test_store_and_get_returns_workitem(storage, workitem):
    storage.store_workitem(workitem)
    retrieved = storage.get_workitem(workitem.workitem_uid)
    assert retrieved is not None
    assert retrieved.workitem_uid == workitem.workitem_uid


def test_get_workitem_preserves_study_uid(storage, workitem):
    storage.store_workitem(workitem)
    retrieved = storage.get_workitem(workitem.workitem_uid)
    assert retrieved.get_study_uid() == "1.2.3.4"


def test_get_workitem_preserves_state(storage, workitem):
    storage.store_workitem(workitem)
    retrieved = storage.get_workitem(workitem.workitem_uid)
    assert retrieved.get_state() == "SCHEDULED"


def test_get_workitem_missing_key_returns_none(storage):
    result = storage.get_workitem("does.not.exist")
    assert result is None


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_delete_removes_from_get(storage, workitem):
    storage.store_workitem(workitem)
    storage.delete_workitem(workitem.workitem_uid)
    assert storage.get_workitem(workitem.workitem_uid) is None


def test_delete_removes_from_list(storage, workitem):
    storage.store_workitem(workitem)
    storage.delete_workitem(workitem.workitem_uid)
    items = storage.list_workitems()
    assert workitem.workitem_uid not in [w.workitem_uid for w in items]


def test_delete_nonexistent_does_not_raise(storage):
    storage.delete_workitem("phantom.uid")


# ---------------------------------------------------------------------------
# list_workitems
# ---------------------------------------------------------------------------

def test_list_workitems_returns_stored(storage, workitem):
    storage.store_workitem(workitem)
    items = storage.list_workitems()
    assert len(items) == 1
    assert items[0].workitem_uid == workitem.workitem_uid


def test_list_workitems_empty_when_nothing_stored(storage):
    assert storage.list_workitems() == []


def test_list_workitems_state_filter_matches(storage, workitem):
    storage.store_workitem(workitem)
    items = storage.list_workitems(state="SCHEDULED")
    assert len(items) == 1
    assert items[0].workitem_uid == workitem.workitem_uid


def test_list_workitems_state_filter_excludes_other(storage, workitem):
    storage.store_workitem(workitem)
    items = storage.list_workitems(state="COMPLETED")
    assert items == []


def test_list_workitems_multiple_entries(storage):
    for key in [k for k in sys.modules if k == "ups" or k.startswith("ups.")]:
        del sys.modules[key]
    from ups.workitem import UPSWorkitem
    for uid in ["2.25.1", "2.25.2", "2.25.3"]:
        w = UPSWorkitem(
            study_uid="1.1.1",
            series_uids=["1.1.1.1"],
            wado_rs_retrieval=[
                {"retrieval_url": "http://x", "study_uid": "1.1.1", "series_uid": "1.1.1.1"}
            ],
            priority="LOW",
            workitem_uid=uid,
        )
        storage.store_workitem(w)
    items = storage.list_workitems()
    assert len(items) == 3
