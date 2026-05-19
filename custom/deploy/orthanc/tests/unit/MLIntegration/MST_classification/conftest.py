"""Path setup for MST-classification tests + sibling-name eviction."""
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_MST_DIR = os.path.abspath(os.path.join(_HERE, '..', '..', '..', '..', 'MLIntegration', 'MST-classification'))


@pytest.fixture(autouse=True)
def _force_mst_path():
    """Ensure MST-classification dir is at sys.path[0] and evict colliding sibling names."""
    saved = list(sys.path)
    if _MST_DIR in sys.path:
        sys.path.remove(_MST_DIR)
    sys.path.insert(0, _MST_DIR)
    # Evict names that exist in multiple ML services (collision risk)
    colliders = ('config', 'preprocessing', 'model_service', 'model_loader', 'app',
                 'dicom_converter', 'dicom_utils', 'exceptions', 'response_builder',
                 'retrieval_strategy', 'wado_helper')
    for k in list(sys.modules):
        top = k.split('.', 1)[0]
        if top in colliders:
            del sys.modules[k]
    try:
        yield
    finally:
        sys.path[:] = saved
