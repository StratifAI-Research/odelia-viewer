"""Smoke tests for measure_timings.py.

Per spec: this is a profiling driver, not a library. We cover only the
side-effect-free helpers and the TimingProfiler accumulator.
Functions that require docker, network I/O, or running Orthanc instances
(get_study_info, send_to_ai_and_profile, fetch_component_logs, etc.) are
excluded deliberately.
"""
import os
import sys
import pytest
import requests


@pytest.fixture(autouse=True)
def _add_orthanc_to_path():
    here = os.path.dirname(os.path.abspath(__file__))
    orthanc_dir = os.path.abspath(os.path.join(here, '..', '..'))
    if orthanc_dir not in sys.path:
        sys.path.insert(0, orthanc_dir)


# ---------------------------------------------------------------------------
# create_http_session
# ---------------------------------------------------------------------------

def test_create_http_session_returns_requests_session():
    from measure_timings import create_http_session
    s = create_http_session()
    assert isinstance(s, requests.Session)


def test_create_http_session_mounts_http_and_https():
    from measure_timings import create_http_session
    s = create_http_session()
    # Session should have adapters mounted for http:// and https://
    assert 'http://' in s.adapters
    assert 'https://' in s.adapters


# ---------------------------------------------------------------------------
# TimingProfiler — __init__, record, measurements accumulation
# ---------------------------------------------------------------------------

def test_timing_profiler_construct(tmp_path):
    from measure_timings import TimingProfiler
    prof = TimingProfiler(trace_id='test-trace-01', output_dir=str(tmp_path))
    assert prof is not None
    assert prof.trace_id == 'test-trace-01'


def test_timing_profiler_starts_empty(tmp_path):
    from measure_timings import TimingProfiler
    prof = TimingProfiler(trace_id='t1', output_dir=str(tmp_path))
    assert prof.measurements == []


def test_timing_profiler_record_adds_measurement(tmp_path):
    from measure_timings import TimingProfiler
    prof = TimingProfiler(trace_id='t2', output_dir=str(tmp_path))
    prof.record(component='router', operation='fetch', duration_ms=123.4)
    assert len(prof.measurements) == 1


def test_timing_profiler_record_stores_fields(tmp_path):
    from measure_timings import TimingProfiler
    prof = TimingProfiler(trace_id='t3', output_dir=str(tmp_path))
    prof.record(component='model', operation='infer', duration_ms=250.0)
    m = prof.measurements[0]
    assert m['component'] == 'model'
    assert m['operation'] == 'infer'
    assert m['duration_ms'] == 250.0
    assert m['trace_id'] == 't3'


def test_timing_profiler_record_multiple(tmp_path):
    from measure_timings import TimingProfiler
    prof = TimingProfiler(trace_id='t4', output_dir=str(tmp_path))
    prof.record('router', 'fetch', 100.0)
    prof.record('model', 'infer', 200.0)
    prof.record('router', 'send', 50.0)
    assert len(prof.measurements) == 3


def test_timing_profiler_record_with_metadata(tmp_path):
    from measure_timings import TimingProfiler
    prof = TimingProfiler(trace_id='t5', output_dir=str(tmp_path))
    prof.record('router', 'fetch', 99.9, metadata={'key': 'value'})
    m = prof.measurements[0]
    # metadata field is json-serialized in record()
    assert 'key' in m['metadata']


# ---------------------------------------------------------------------------
# parse_timing_logs — exercises real parsing logic
#
# parse_timing_logs(profiler, container, logs) parses TIMING:/PROFILE: markers
# from docker-style log output. The container name is mapped via component_map.
# Lines without a recognised container name fall through as-is.
# ---------------------------------------------------------------------------

def test_parse_timing_logs_handles_empty_input(tmp_path):
    from measure_timings import TimingProfiler, parse_timing_logs
    prof = TimingProfiler(trace_id='p0', output_dir=str(tmp_path))
    parse_timing_logs(prof, 'some-container', '')
    # Should not raise and should add no measurements
    assert prof.measurements == []


def test_parse_timing_logs_no_timing_markers(tmp_path):
    from measure_timings import TimingProfiler, parse_timing_logs
    prof = TimingProfiler(trace_id='p1', output_dir=str(tmp_path))
    logs = "INFO: loading model\nDEBUG: checkpoint loaded\n"
    parse_timing_logs(prof, 'odelia-orthanc-router', logs)
    assert prof.measurements == []


def test_parse_timing_logs_recognises_timing_marker(tmp_path):
    from measure_timings import TimingProfiler, parse_timing_logs
    prof = TimingProfiler(trace_id='p2', output_dir=str(tmp_path))
    # A plain line (no docker timestamp) containing TIMING: marker
    # parse_timing_logs falls back to using the full line when there is no
    # leading docker timestamp — so a bare TIMING: line is always included.
    logs = "TIMING: dicom_send: 375.50ms\n"
    parse_timing_logs(prof, 'odelia-orthanc-router', logs)
    assert len(prof.measurements) == 1
    m = prof.measurements[0]
    assert m['operation'] == 'dicom_send'
    assert m['duration_ms'] == 375.5


def test_parse_timing_logs_maps_container_to_component(tmp_path):
    from measure_timings import TimingProfiler, parse_timing_logs
    prof = TimingProfiler(trace_id='p3', output_dir=str(tmp_path))
    logs = "TIMING: inference_run: 800.00ms\n"
    parse_timing_logs(prof, 'odelia-breast-cancer-classification', logs)
    assert len(prof.measurements) == 1
    assert prof.measurements[0]['component'] == 'ml-breast-cancer'


def test_parse_timing_logs_profile_marker_also_works(tmp_path):
    from measure_timings import TimingProfiler, parse_timing_logs
    prof = TimingProfiler(trace_id='p4', output_dir=str(tmp_path))
    logs = "PROFILE: weight_load: 1200.00ms\n"
    parse_timing_logs(prof, 'odelia-mst-classifier', logs)
    assert len(prof.measurements) == 1
    assert prof.measurements[0]['duration_ms'] == 1200.0


def test_parse_timing_logs_seconds_unit_converted(tmp_path):
    from measure_timings import TimingProfiler, parse_timing_logs
    prof = TimingProfiler(trace_id='p5', output_dir=str(tmp_path))
    # Parser also handles "N s" (seconds) format and converts to ms
    logs = "TIMING: long_op: 2.5s\n"
    parse_timing_logs(prof, 'odelia-orthanc-router', logs)
    assert len(prof.measurements) == 1
    assert prof.measurements[0]['duration_ms'] == pytest.approx(2500.0)


def test_parse_timing_logs_unknown_container_uses_name_as_is(tmp_path):
    from measure_timings import TimingProfiler, parse_timing_logs
    prof = TimingProfiler(trace_id='p6', output_dir=str(tmp_path))
    logs = "TIMING: some_op: 42.0ms\n"
    parse_timing_logs(prof, 'my-unknown-container', logs)
    assert len(prof.measurements) == 1
    assert prof.measurements[0]['component'] == 'my-unknown-container'
