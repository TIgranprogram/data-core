import subprocess
import sys
from pathlib import Path

def test_isolation_suite():
    r = subprocess.run([sys.executable, "-m", "orchestrator.cli", "run", "--suite", "isolation_check"], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr

def test_stand_container_up():
    r = subprocess.run(["docker", "ps", "--filter", "name=nightshift-mongo", "--format", "{{.Names}}"], capture_output=True, text=True)
    assert "nightshift-mongo" in r.stdout