"""sys.path setup for MLIntegration tests; minimal version.

ODV-192 ships only the sys.path manipulation needed by the two seed tests.
ODV-133 rebase replaces this file with its richer version.
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_MLI_DIR = os.path.abspath(os.path.join(_HERE, "..", "..", "..", "MLIntegration"))

if _MLI_DIR not in sys.path:
    sys.path.insert(0, _MLI_DIR)
