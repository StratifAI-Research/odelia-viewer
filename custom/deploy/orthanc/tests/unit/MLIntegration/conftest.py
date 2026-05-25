import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_MLI_DIR = os.path.abspath(os.path.join(_HERE, "..", "..", "..", "MLIntegration"))

if _MLI_DIR not in sys.path:
    sys.path.insert(0, _MLI_DIR)
