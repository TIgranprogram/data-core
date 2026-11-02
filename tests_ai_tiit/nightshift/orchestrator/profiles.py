import yaml
from .paths import ROOT

PROFILES_PATH = ROOT / "config" / "profiles.yaml"

def load_profile(name, path=PROFILES_PATH):
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    profiles = data.get("profiles") or {}
    if name not in profiles:
        raise ValueError(f"профиль не найден: {name}")
    return profiles[name]

def select_suites(suites, profile):
    """Наборы профиля в его порядке; вторым значением — имена, которых нет в suites/."""
    by_name = {s.get("name"): s for s in suites}
    names = profile.get("suites") or []
    return [by_name[n] for n in names if n in by_name], [n for n in names if n not in by_name]

def needs_isolation(selected, profile=None):
    if profile and profile.get("isolation_gate"):
        return True
    return any(s.get("needs_stand") for s in selected)
