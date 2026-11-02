import sys
from pathlib import Path

# Корень nightshift: папка exe после упаковки, иначе родитель пакета orchestrator.
ROOT = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]
