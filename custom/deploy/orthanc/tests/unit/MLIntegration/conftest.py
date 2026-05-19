"""MLIntegration test setup.

Prepends `custom/deploy/orthanc/MLIntegration/` to sys.path so that the
`shared` package and the per-service sub-directories can be discovered.
Per-service conftests further prepend their specific dir.
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_MLI_DIR = os.path.abspath(os.path.join(_HERE, '..', '..', '..', 'MLIntegration'))

if _MLI_DIR not in sys.path:
    sys.path.insert(0, _MLI_DIR)
