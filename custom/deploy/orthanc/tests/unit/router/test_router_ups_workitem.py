"""Unit tests for router/ups/workitem.py — pure data class (router variant)."""
import importlib.util
import os
import sys
import pytest

# Absolute path to the router's ups/workitem.py — used so the fixture always
# loads the router variant even when both viewer/ and router/ are on sys.path
# (they share the bare module name `ups.workitem`).
_ROUTER_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), '..', '..', '..', 'router')
)
_WORKITEM_PATH = os.path.join(_ROUTER_DIR, 'ups', 'workitem.py')


@pytest.fixture
def mk_workitem():
    # Evict any cached ups/* modules to avoid getting the viewer's version.
    for key in [k for k in sys.modules if k == 'ups' or k.startswith('ups.')]:
        del sys.modules[key]
    spec = importlib.util.spec_from_file_location('ups.workitem', _WORKITEM_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.UPSWorkitem


def test_create_workitem_assigns_uid(mk_workitem):
    w = mk_workitem(
        study_uid='1.2.3', series_uids=['1.2.4', '1.2.5'],
        wado_rs_retrieval=[
            {'retrieval_url': 'http://x/studies/1.2.3', 'study_uid': '1.2.3', 'series_uid': '1.2.4'},
        ],
    )
    assert w.workitem_uid
    assert w.get_study_uid() == '1.2.3'


def test_workitem_initial_state_is_scheduled(mk_workitem):
    w = mk_workitem(
        study_uid='1.2.3', series_uids=['1.2.4'],
        wado_rs_retrieval=[
            {'retrieval_url': 'http://x/studies/1.2.3', 'study_uid': '1.2.3', 'series_uid': '1.2.4'},
        ],
    )
    assert w.get_state() == 'SCHEDULED'


def test_workitem_round_trips_through_json(mk_workitem):
    w = mk_workitem(
        study_uid='1.2.3', series_uids=['1.2.4'],
        wado_rs_retrieval=[
            {'retrieval_url': 'http://x/studies/1.2.3', 'study_uid': '1.2.3', 'series_uid': '1.2.4'},
        ],
        priority='HIGH',
    )
    s = w.to_json()
    restored = mk_workitem.from_json(s, w.workitem_uid)
    assert restored.get_study_uid() == '1.2.3'
    assert restored.workitem_uid == w.workitem_uid
    assert restored.get_state() == 'SCHEDULED'


def test_update_state_records_in_progress(mk_workitem):
    w = mk_workitem(study_uid='s', series_uids=[], wado_rs_retrieval=[])
    w.update_state('IN_PROGRESS', progress_percent=42, progress_description='running')
    assert w.get_state() == 'IN_PROGRESS'


def test_add_output_reference_appends(mk_workitem):
    w = mk_workitem(study_uid='s', series_uids=[], wado_rs_retrieval=[])
    w.add_output_reference(series_uid='1.2.5', study_uid='s')
    restored = mk_workitem.from_json(w.to_json(), w.workitem_uid)
    assert '00404033' in restored.data
    out_vals = restored.data['00404033']['Value']
    assert len(out_vals) == 1
    assert out_vals[0]['0020000E']['Value'][0] == '1.2.5'


def test_get_wado_rs_urls_returns_list(mk_workitem):
    w = mk_workitem(
        study_uid='1.2.3', series_uids=['1.2.4'],
        wado_rs_retrieval=[
            {'retrieval_url': 'http://x/studies/1.2.3', 'study_uid': '1.2.3', 'series_uid': '1.2.4'},
        ],
    )
    urls = w.get_wado_rs_urls()
    assert isinstance(urls, list)
    assert len(urls) == 1
    assert urls[0]['retrieval_url'] == 'http://x/studies/1.2.3'
    assert urls[0]['study_uid'] == '1.2.3'
    assert urls[0]['series_uid'] == '1.2.4'


def test_input_mapping_round_trips(mk_workitem):
    """Router-only: structured input mapping via Scheduled Processing Parameters."""
    mapping = {'leftCC': '1.2.100', 'leftMLO': '1.2.101'}
    w = mk_workitem(
        study_uid='1.2.3', series_uids=['1.2.100'],
        wado_rs_retrieval=[
            {'retrieval_url': 'http://x/studies/1.2.3', 'study_uid': '1.2.3', 'series_uid': '1.2.100'},
        ],
        input_mapping=mapping,
        input_configuration_id='cfg-v1',
    )
    result = w.get_input_mapping()
    assert result is not None
    assert result['mapping']['leftCC'] == '1.2.100'
    assert result['mapping']['leftMLO'] == '1.2.101'
    assert result['input_configuration_id'] == 'cfg-v1'
