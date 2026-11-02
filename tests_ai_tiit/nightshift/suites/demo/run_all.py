import subprocess
import sys
from pathlib import Path

base = Path(__file__).resolve().parent
r1 = subprocess.run([sys.executable, str(base / "pass_test.py")])
r2 = subprocess.run([sys.executable, str(base / "fail_test.py")])
sys.exit(0 if r1.returncode == 0 and r2.returncode == 0 else 1)