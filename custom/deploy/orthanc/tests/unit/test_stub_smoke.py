"""Smoke test: every in-scope module must import under the stub."""
import os
import sys

_THIS = os.path.dirname(os.path.abspath(__file__))
_ORTHANC_DIR = os.path.abspath(os.path.join(_THIS, '..', '..'))


def _force_side(target_dir):
    """Put target_dir at sys.path[0] (removing if already present elsewhere).

    The per-side conftests in tests/unit/{viewer,router}/ also push their dir
    onto sys.path, but their order is non-deterministic at collection time.
    For the smoke tests we pin the order explicitly so `from ups import …`
    resolves to the intended side.
    """
    if target_dir in sys.path:
        sys.path.remove(target_dir)
    sys.path.insert(0, target_dir)


def test_viewer_modules_import():
    _force_side(os.path.join(_ORTHANC_DIR, 'viewer'))
    import feedback_db  # noqa: F401
    import feedback_routes  # noqa: F401
    import router as viewer_router  # noqa: F401


def test_router_modules_import():
    _force_side(os.path.join(_ORTHANC_DIR, 'router'))
    import server  # noqa: F401
    import wado_utils  # noqa: F401
    from ups import routes, processor, storage, subscription_storage, workitem  # noqa: F401
