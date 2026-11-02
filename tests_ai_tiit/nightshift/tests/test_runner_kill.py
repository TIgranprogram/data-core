import subprocess, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from orchestrator.runner import run_suite

def test_timeout_kills_tree():
    # бесконечный процесс с дочерним
    r = run_suite({"name": "inf", "command": ["cmd", "/c", "ping -t 127.0.0.1 >nul"]}, timeout_sec=2)
    assert r["timed_out"] is True
    assert r["returncode"] == 124