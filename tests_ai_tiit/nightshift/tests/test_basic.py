import json
import sys
from pathlib import Path
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from orchestrator.db import init_db
from orchestrator.plugins import find_suites
from orchestrator.runner import run_suite
from orchestrator.report import generate
from orchestrator.handoff import create_handoff

def test_db():
    import gc, sqlite3
    p = Path("data") / "test_tmp.db"
    p.parent.mkdir(exist_ok=True)
    init_db(p)
    c = sqlite3.connect(str(p))
    tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    c.close()
    gc.collect()
    try:
        p.unlink()
    except OSError:
        pass
    assert "runs" in tables

def test_plugins_find_demo():
    suites = find_suites("suites")
    names = [s.get("name") for s in suites]
    assert "demo" in names

def test_runner_success_failure_timeout():
    r1 = run_suite({"name": "p", "command": ["python", "-c", "print('ok')"]})
    assert r1["returncode"] == 0
    r2 = run_suite({"name": "f", "command": ["python", "-c", "import sys; sys.exit(1)"]})
    assert r2["returncode"] == 1
    r3 = run_suite({"name": "t", "command": ["python", "-c", "import time; time.sleep(10)"]}, timeout_sec=1)
    assert r3["timed_out"] is True

def test_report_and_handoff():
    with tempfile.TemporaryDirectory() as td:
        res = [{"name": "p", "returncode": 1, "stdout": "ok", "stderr": "boom", "command": ["python", "-c", "x"], "timed_out": False}]
        rep = generate(res, out_dir=str(Path(td) / "reports"))
        assert (rep / "report.json").exists()
        data = json.loads((rep / "report.json").read_text(encoding="utf-8"))
        assert data["issues"][0]["suite"] == "p"
        assert "expected" in data["issues"][0]
        assert "repro" in data["issues"][0]
        hd = create_handoff(res, out_dir=str(Path(td) / "handoff"))
        assert (hd / "README_FOR_AI.md").exists()
        assert (hd / "issues" / "p" / "issue.json").exists()
        # zip archive
        assert (Path(td) / "handoff" / (hd.name + ".zip")).exists()

def test_exit_codes():
    # all green
    r1 = run_suite({"name": "p", "command": ["python", "-c", "print('ok')"]})
    assert r1["returncode"] == 0
    # failed
    r2 = run_suite({"name": "f", "command": ["python", "-c", "import sys; sys.exit(1)"]})
    assert r2["returncode"] == 1
    # broken suite -> ValueError
    import tempfile as t
    with t.TemporaryDirectory() as td:
        p = Path(td) / "suites" / "bad"
        p.mkdir(parents=True)
        (p / "suite.yaml").write_text("name: bad\n", encoding="utf-8")
        try:
            find_suites(str(Path(td) / "suites"))
            raised = False
        except ValueError:
            raised = True
        assert raised

def test_timeout_kills():
    r = run_suite({"name": "t", "command": ["python", "-c", "import time; time.sleep(10)"]}, timeout_sec=1)
    assert r["timed_out"] is True
    assert r["returncode"] == 124

def test_one_failure_doesnt_stop_others():
    results = []
    results.append(run_suite({"name": "p", "command": ["python", "-c", "print('ok')"]}))
    results.append(run_suite({"name": "f", "command": ["python", "-c", "import sys; sys.exit(1)"]}))
    results.append(run_suite({"name": "p2", "command": ["python", "-c", "print('ok2')"]}))
    assert len(results) == 3
    assert results[1]["returncode"] == 1
    assert results[2]["returncode"] == 0