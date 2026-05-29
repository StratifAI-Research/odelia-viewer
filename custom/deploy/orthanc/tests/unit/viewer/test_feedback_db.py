"""Unit tests for viewer/feedback_db.py — sqlite-backed feedback storage."""
import importlib

import pytest


@pytest.fixture
def fb(tmp_path, monkeypatch):
    # Reset module-level singleton state so each test gets a fresh DB.
    monkeypatch.setenv('ORTHANC_FEEDBACK_DB_DIR', str(tmp_path))
    monkeypatch.setenv('ORTHANC_FEEDBACK_DB_PATH', str(tmp_path / 'fb.sqlite'))
    import feedback_db
    importlib.reload(feedback_db)
    return feedback_db


def _payload(study='1.2.3', user='u1', verdict_L=1, verdict_R=-1, **extra):
    return {
        'study_uid': study,
        'model_name': 'M',
        'model_version': '1',
        'result_ts': '2026-01-01T00:00:00Z',
        'user_id': user,
        'verdict_L': verdict_L,
        'verdict_R': verdict_R,
        **extra,
    }


def test_health_reports_db_ready(fb):
    info = fb.health()
    assert info['db_ready'] is True
    assert 'sqlite_version' in info


def test_register_result_idempotent(fb):
    r1 = fb.register_result('1.2.3', 'M', '1', '2026-01-01T00:00:00Z', None)
    r2 = fb.register_result('1.2.3', 'M', '1', '2026-01-01T00:00:00Z', None)
    assert r1['created'] is True
    assert r2['created'] is False
    assert r1['id'] == r2['id']


def test_submit_happy_path_returns_initial(fb):
    saved = fb.submit_feedback(_payload())
    assert saved['submission_kind'] == 'initial'
    assert saved['verdict_L'] == 1
    assert saved['verdict_R'] == -1
    assert saved['study_uid'] == '1.2.3'


def test_submit_duplicate_without_edited_raises_conflict(fb):
    fb.submit_feedback(_payload())
    with pytest.raises(fb.ConflictError):
        fb.submit_feedback(_payload())


def test_submit_edited_replaces_verdict(fb):
    fb.submit_feedback(_payload(verdict_L=1, verdict_R=0))
    saved = fb.submit_feedback(_payload(verdict_L=-1, verdict_R=1, edited=True))
    assert saved['submission_kind'] == 'edit'
    assert saved['verdict_L'] == -1
    assert saved['verdict_R'] == 1


def test_read_feedback_aggregates(fb):
    fb.submit_feedback(_payload(user='alice', verdict_L=1, verdict_R=-1))
    fb.submit_feedback(_payload(user='bob', verdict_L=1, verdict_R=1))
    agg = fb.read_feedback(
        study_uid='1.2.3', model_name='M', model_version='1',
        result_ts='2026-01-01T00:00:00Z',
        include_users=False, include_history=False,
    )
    assert agg['n_submissions'] >= 2
    assert agg['aggregate']['L']['agree'] >= 2


def test_read_feedback_no_submissions_returns_zeros(fb):
    agg = fb.read_feedback(
        study_uid='9.9.9', model_name='M', model_version='1',
        result_ts='2026-01-01T00:00:00Z',
    )
    assert agg['n_submissions'] == 0
    assert agg['aggregate']['L']['agree'] == 0


def test_export_ndjson_includes_submitted_row(fb):
    fb.submit_feedback(_payload())
    # export_rows_ndjson yields dicts (not strings)
    rows = list(fb.export_rows_ndjson(model_name='M', model_version='1', scope='current'))
    assert len(rows) == 1
    row = rows[0]
    assert row['user_id'] == 'u1'
    assert row['verdict_L'] == 1
    assert row['verdict_R'] == -1
    assert row['submission_kind'] == 'initial'


def test_export_csv_header_and_rows(fb):
    fb.submit_feedback(_payload())
    # export_rows_csv returns (header_str, iterable_of_tuples)
    header, rows_iter = fb.export_rows_csv(model_name='M', model_version='1', scope='current')
    assert 'submission_kind' in header
    assert 'study_uid' in header
    data_rows = list(rows_iter)
    assert len(data_rows) == 1
    # Each row is a tuple; the last column is submission_kind
    assert data_rows[0][-1] == 'initial'
