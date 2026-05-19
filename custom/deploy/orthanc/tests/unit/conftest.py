"""Orthanc test stub.

Installs a fake `orthanc` module into sys.modules before any module under test
imports it. Provides FakeOutput, opt-in REST/DICOM fakes, and per-test reset.
"""
import os
import sys
from types import ModuleType
import pytest

# Allow feedback_db to initialize its SQLite store in a writable temp location.
os.environ.setdefault("ORTHANC_FEEDBACK_DB_DIR", "/tmp/odv133_test_feedback")


def _install_orthanc_stub():
    if 'orthanc' in sys.modules and getattr(sys.modules['orthanc'], '_is_test_stub', False):
        return

    m = ModuleType('orthanc')
    m._is_test_stub = True

    # ---- Constants ----
    class _ChangeType:
        STABLE_STUDY = 'STABLE_STUDY'
        STABLE_SERIES = 'STABLE_SERIES'
        NEW_INSTANCE = 'NEW_INSTANCE'
        STABLE_PATIENT = 'STABLE_PATIENT'
    m.ChangeType = _ChangeType

    class _ResourceType:
        STUDY = 'STUDY'
        SERIES = 'SERIES'
        INSTANCE = 'INSTANCE'
        PATIENT = 'PATIENT'
    m.ResourceType = _ResourceType

    # ---- Callback registration: capture for inspection ----
    m._rest_callbacks = []
    m._onchange_callbacks = []
    m.RegisterRestCallback = lambda uri, fn: m._rest_callbacks.append((uri, fn))
    m.RegisterOnChangeCallback = m._onchange_callbacks.append

    # ---- KV store: backed by a dict; tests can inspect _kv directly ----
    m._kv = {}  # {(bucket, key): bytes}

    def _put(bucket, key, value):
        m._kv[(bucket, key)] = value if isinstance(value, bytes) else str(value).encode()
    def _get(bucket, key):
        return m._kv.get((bucket, key))
    def _del(bucket, key):
        m._kv.pop((bucket, key), None)
    def _iter(bucket):
        return iter([(k, v) for (b, k), v in sorted(m._kv.items()) if b == bucket])
    m.StoreKeyValue = _put
    m.GetKeyValue = _get
    m.DeleteKeyValue = _del
    m.CreateKeysValuesIterator = _iter

    # ---- REST + DICOM: default raises; tests bind via fixtures ----
    def _no_handler(*a, **kw):
        raise RuntimeError(
            'orthanc REST/DICOM call from a test that did not request the rest_fake or '
            'dicom_fake fixture; bind responses explicitly'
        )
    m.RestApiGet = m.RestApiPost = m.RestApiPut = m.RestApiDelete = _no_handler
    m.GetDicomForInstance = _no_handler

    # ---- Logging: no-op ----
    m.LogInfo = m.LogWarning = m.LogError = lambda msg: None

    sys.modules['orthanc'] = m


_install_orthanc_stub()


# =====================================================================
# Helpers & fixtures
# =====================================================================

class FakeOutput:
    """Captures Orthanc Output object method calls."""
    def __init__(self):
        self.status = None
        self.body = None
        self.content_type = None
        self.allowed = None

    def AnswerBuffer(self, body, content_type):
        self.status, self.body, self.content_type = 200, body, content_type

    def SendHttpStatus(self, code, body=''):
        self.status, self.body = code, body

    def SendMethodNotAllowed(self, allowed):
        self.status, self.allowed = 405, allowed


@pytest.fixture
def out():
    return FakeOutput()


@pytest.fixture(autouse=True)
def _reset_orthanc_state():
    """Clear KV store + captured callbacks + REST/DICOM stubs between tests."""
    import orthanc
    orthanc._kv.clear()
    orthanc._rest_callbacks.clear()
    orthanc._onchange_callbacks.clear()
    # restore default raisers in case a prior test bound a fake
    def _no_handler(*a, **kw):
        raise RuntimeError('orthanc REST/DICOM call without rest_fake/dicom_fake fixture')
    orthanc.RestApiGet = lambda uri: _no_handler('GET', uri)
    orthanc.RestApiPost = lambda uri, body=b'': _no_handler('POST', uri, body)
    orthanc.RestApiPut = lambda uri, body=b'': _no_handler('PUT', uri, body)
    orthanc.RestApiDelete = lambda uri: _no_handler('DELETE', uri)
    orthanc.GetDicomForInstance = _no_handler
    # Drop path-local package caches so viewer/ups and router/ups don't collide.
    for key in [k for k in sys.modules if k == 'ups' or k.startswith('ups.')]:
        del sys.modules[key]
    yield


@pytest.fixture
def rest_fake():
    """Records orthanc.RestApi* calls and lets tests bind responses.

    Usage:
        def test_x(rest_fake):
            rest_fake.responses[('GET', '/studies/abc')] = b'{"foo":1}'
            ... call code that invokes orthanc.RestApiGet('/studies/abc') ...
            assert rest_fake.calls == [('GET', '/studies/abc', None)]
    """
    import orthanc
    calls = []
    responses = {}

    def _dispatch(method, uri, body=None):
        calls.append((method, uri, body))
        key = (method, uri)
        if key not in responses:
            raise RuntimeError(f'rest_fake: no response bound for {method} {uri}')
        v = responses[key]
        return v(body) if callable(v) else v

    orthanc.RestApiGet = lambda uri: _dispatch('GET', uri)
    orthanc.RestApiPost = lambda uri, body=b'': _dispatch('POST', uri, body)
    orthanc.RestApiPut = lambda uri, body=b'': _dispatch('PUT', uri, body)
    orthanc.RestApiDelete = lambda uri: _dispatch('DELETE', uri)

    return type('RestFake', (), {'calls': calls, 'responses': responses})()


@pytest.fixture
def dicom_fake():
    """Bind {instance_id: bytes} for orthanc.GetDicomForInstance calls."""
    import orthanc
    store = {}

    def _get(instance_id):
        if instance_id not in store:
            raise KeyError(f'dicom_fake: no fixture for instance_id={instance_id!r}')
        return store[instance_id]

    orthanc.GetDicomForInstance = _get
    return store
