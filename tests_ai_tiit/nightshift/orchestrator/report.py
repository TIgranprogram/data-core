import json
from pathlib import Path
from datetime import datetime

def generate(results, out_dir="reports"):
    d = Path(out_dir) / datetime.now().strftime("%Y-%m-%d_%H%M%S")
    d.mkdir(parents=True, exist_ok=True)
    passed = sum(1 for r in results if r.get("returncode") == 0)
    failed = sum(1 for r in results if r.get("returncode") != 0)
    issues = []
    for r in results:
        if r.get("returncode") != 0:
            issues.append({
                "suite": r.get("name"),
                "test": r.get("name"),
                "run_time": datetime.now().isoformat(),
                "commit_hash": "",
                "expected": "exit code 0",
                "actual": f"exit code {r.get('returncode')}",
                "error": r.get("stderr", "") or r.get("error", ""),
                "stacktrace": r.get("stderr", ""),
                "log_fragment": (r.get("stdout", "") or "")[:500],
                "file": "",
                "line": 0,
                "repro": " ".join(r.get("command", [])) if r.get("command") else r.get("name"),
                "repeatability": "always",
                "resource_metrics": {},
                "priority": "critical",
                "scenario_id": "",
                "group_id": "",
                "timed_out": r.get("timed_out", False),
                "status": r.get("status", "failed"),
            })
    report = {
        "summary": {"passed": passed, "failed": failed, "total": len(results)},
        "issues": issues,
        "config_diff": [],
    }
    (d / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    html = "<html><body><h1>Report</h1><pre>" + json.dumps(report, ensure_ascii=False, indent=2) + "</pre></body></html>"
    (d / "report.html").write_text(html, encoding="utf-8")
    return d