from pathlib import Path
from datetime import datetime
import json
import zipfile

def create_handoff(results, out_dir="handoff"):
    d = Path(out_dir) / datetime.now().strftime("%Y-%m-%d_%H%M%S")
    d.mkdir(parents=True, exist_ok=True)
    for sub in ["issues", "fix_history", "needs_big_ai", "metrics"]:
        (d / sub).mkdir(exist_ok=True)
    # issues per suite
    for r in results:
        if r.get("returncode") != 0:
            issue_dir = d / "issues" / str(r.get("name"))
            issue_dir.mkdir(parents=True, exist_ok=True)
            (issue_dir / "issue.json").write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
    (d / "README_FOR_AI.md").write_text("# Handoff\nRead summary.md first.\n", encoding="utf-8")
    (d / "summary.md").write_text("# Summary\n" + str(results), encoding="utf-8")
    (d / "summary.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    (d / "environment.json").write_text(json.dumps({"platform": "windows"}, ensure_ascii=False), encoding="utf-8")
    # zip archive
    zip_path = d.parent / (d.name + ".zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in d.rglob("*"):
            if f.is_file():
                z.write(f, f.relative_to(d.parent))
    return d