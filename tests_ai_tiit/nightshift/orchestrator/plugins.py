from pathlib import Path
import yaml

def find_suites(root="suites"):
    root = Path(root)
    out = []
    if not root.exists():
        return out
    for p in root.glob("*/suite.yaml"):
        with open(p, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        if not isinstance(data, dict) or "name" not in data or "command" not in data:
            raise ValueError(f"битый suite.yaml: {p}")
        if not isinstance(data.get("command"), list):
            raise ValueError(f"command должен быть списком: {p}")
        data["_path"] = str(p)
        out.append(data)
    return out