import yaml
from pathlib import Path
from .paths import ROOT


def load_profile(name, path=None):
    data = yaml.safe_load(Path(path or ROOT / 'config/profiles.yaml').read_text(encoding='utf-8')) or {}
    if name not in data:
        raise ValueError(f'unknown profile: {name}')
    return data[name]


def select_suites(suites, profile):
    order = profile.get('order', [])
    by_name = {s['name']: s for s in suites}
    missing = [n for n in order if n not in by_name]
    if missing:
        raise ValueError('В профиле отсутствуют обязательные suites: ' + ', '.join(missing))
    selected = []
    for name in order:
        s = dict(by_name[name])
        s['timeout_sec'] = profile.get('limits', {}).get(name, s.get('timeout_sec', 30))
        selected.append(s)
    return selected, [s['name'] for s in suites if s['name'] not in order]


def needs_isolation(suites, profile=None):
    return bool(profile and profile.get('isolation_gate')) or any(s.get('needs_stand') for s in suites)
