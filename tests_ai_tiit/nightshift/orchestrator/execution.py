import os
import subprocess
from datetime import datetime, timezone
from .paths import ROOT


def now():
    return datetime.now(timezone.utc).isoformat()


def safe_env(extra=None):
    # Нет наследования MONGO/JWT/SMTP/URL, DOCKER_HOST или NODE_OPTIONS.
    allowed = {'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'SYSTEMDRIVE'}
    env = {k: v for k, v in os.environ.items() if k.upper() in allowed}
    env.update({'PYTHONUTF8': '1', 'NODE_ENV': 'test', 'CI': 'true'})
    if extra:
        env.update(extra)
    return env


def commit_hash():
    try:
        r = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, env=safe_env(), capture_output=True, text=True, timeout=5)
        return r.stdout.strip() if r.returncode == 0 else 'unknown'
    except (OSError, subprocess.TimeoutExpired):
        return 'unknown'
