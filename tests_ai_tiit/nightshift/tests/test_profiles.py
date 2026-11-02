import argparse
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from orchestrator import cli
from orchestrator.masking import mask_obj, mask_text
from orchestrator.profiles import load_profile, needs_isolation, select_suites


def test_night_profile_keeps_order_and_excludes_demo():
    profile = load_profile("night")
    suites = [{"name": "regression"}, {"name": "demo"}, {"name": "static"}]
    selected, skipped = select_suites(suites, profile)
    assert [s["name"] for s in selected] == ["static", "regression"]
    assert "load" in skipped and "demo" not in skipped


def test_unknown_profile_is_error():
    with pytest.raises(ValueError):
        load_profile("нет-такого")


def test_needs_isolation():
    assert needs_isolation([], {"isolation_gate": True})
    assert needs_isolation([{"needs_stand": True}])
    assert not needs_isolation([{"name": "demo"}])


def _fake_suites(monkeypatch, isolation_rc, ran):
    suites = [
        {"name": "isolation_check", "command": ["x"]},
        {"name": "regression", "command": ["x"], "needs_stand": True},
    ]
    def fake_run(suite, timeout_sec=30):
        ran.append(suite["name"])
        rc = isolation_rc if suite["name"] == "isolation_check" else 0
        return {"name": suite["name"], "returncode": rc, "stdout": "", "stderr": ""}
    monkeypatch.setattr(cli, "find_suites", lambda: suites)
    monkeypatch.setattr(cli, "run_suite", fake_run)
    monkeypatch.setattr(cli, "generate", lambda results: "r")
    monkeypatch.setattr(cli, "create_handoff", lambda results: "h")


def test_gate_red_isolation_stops_run_with_code_2(monkeypatch):
    ran = []
    _fake_suites(monkeypatch, 1, ran)
    with pytest.raises(SystemExit) as e:
        cli.cmd_run(argparse.Namespace(suite="regression", profile=None))
    assert e.value.code == 2
    assert ran == ["isolation_check"]


def test_gate_green_isolation_runs_suite(monkeypatch):
    ran = []
    _fake_suites(monkeypatch, 0, ran)
    with pytest.raises(SystemExit) as e:
        cli.cmd_run(argparse.Namespace(suite="regression", profile=None))
    assert e.value.code == 0
    assert ran == ["isolation_check", "regression"]


def test_cli_runs_from_any_folder(tmp_path):
    r = subprocess.run([sys.executable, "-m", "orchestrator.cli", "run", "--suite", "demo"],
                       cwd=tmp_path, capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 1, r.stdout + r.stderr
    assert not (tmp_path / "reports").exists()


def test_masking_hides_secrets():
    text = "kppd_abc123 mongodb://root:hunter2@mongo:27017 JWT_SECRET=topsecret password: qwerty"
    out = mask_text(text)
    for secret in ("kppd_abc123", "hunter2", "topsecret", "qwerty"):
        assert secret not in out
    assert "mongo:27017" in out


def test_mask_obj_is_recursive():
    assert mask_obj({"a": ["Bearer abc.def"], "n": 1}) == {"a": ["Bearer ***"], "n": 1}
