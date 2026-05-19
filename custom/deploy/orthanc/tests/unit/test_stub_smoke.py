"""Smoke test: every in-scope module must import under the stub."""


def test_viewer_modules_import():
    # These modules import `orthanc` at top level; should succeed under the stub.
    import sys
    # Add viewer dir to path (matches what tests/unit/viewer/conftest.py will do later)
    import os
    repo = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    viewer_dir = os.path.join(repo, 'viewer')
    if viewer_dir not in sys.path:
        sys.path.insert(0, viewer_dir)
    import feedback_db  # noqa: F401
    import feedback_routes  # noqa: F401
    import router as viewer_router  # noqa: F401


def test_router_modules_import():
    import sys, os
    repo = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    router_dir = os.path.join(repo, 'router')
    if router_dir not in sys.path:
        sys.path.insert(0, router_dir)
    import server  # noqa: F401
    import wado_utils  # noqa: F401
    from ups import routes, processor, storage, subscription_storage, workitem  # noqa: F401
