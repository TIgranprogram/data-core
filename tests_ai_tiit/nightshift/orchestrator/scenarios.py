import re
from pathlib import Path

def sync_scenarios(scenarios_file="scenarios.yaml", project_path=None):
    if project_path is None:
        try:
            import yaml as _  # noqa
        except Exception:
            pass
        # read from config/project.yaml if exists
        cfg = Path("config/project.yaml")
        if cfg.exists():
            for line in cfg.read_text(encoding="utf-8").splitlines():
                if line.strip().startswith("project_path:"):
                    project_path = line.split(":",1)[1].strip().strip('"')
    if project_path is None:
        project_path = "D:/data-core"
    modules_dir = Path(project_path) / "backend" / "src" / "modules"
    covered = set()
    try:
        text = Path(scenarios_file).read_text(encoding="utf-8")
        for line in text.splitlines():
            if "source:" in line:
                covered.add(line.split("source:")[-1].strip())
    except FileNotFoundError:
        pass
    uncovered = []
    if modules_dir.exists():
        for m in modules_dir.iterdir():
            if not m.is_dir():
                continue
            # scan controllers for routes
            routes = []
            for ctrl in m.glob("*.controller.ts"):
                for line in ctrl.read_text(encoding="utf-8").splitlines():
                    mm = re.search(r"@(Get|Post|Put|Patch|Delete)\s*\(\s*['\"]?([^'\")\s]*)", line)
                    if mm:
                        routes.append(mm.group(2) or "/")
            mod_name = m.name
            if not any(mod_name in c for c in covered):
                uncovered.append({"module": mod_name, "routes": routes})
    return uncovered

if __name__ == "__main__":
    import json
    print(json.dumps(sync_scenarios(), ensure_ascii=False, indent=2))