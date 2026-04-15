import sys
from pathlib import Path


ML_ROOT = Path(__file__).resolve().parents[2] / "src" / "ml"
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))
