import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from .execution import commit_hash, now, safe_env
from .masking import mask_obj
from .paths import ROOT


def _kill_tree(pid):
    if sys.platform == 'win32':
        subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True)
    else:
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def run_suite(suite, timeout_sec=30, env=None):
    cmd = list(suite.get('command', []))
    if cmd and cmd[0] == 'python':
        cmd[0] = sys.executable
    start = time.monotonic()
    result = {'name': suite.get('name'), 'command': cmd, 'commit_hash': commit_hash(),
              'started_at': now(), 'timed_out': False, 'stdout': '', 'stderr': '',
              'expected_failure': bool(suite.get('expected_failure')),
              'failure_category': suite.get('failure_category', 'app_failure')}
    if suite.get('implemented') is False or not cmd:
        result.update(returncode=2, category='not_implemented', reason=suite.get('reason', 'suite не реализован'), executed=False)
    else:
        try:
            proc = subprocess.Popen(cmd, cwd=ROOT / suite.get('cwd', '.'), env=safe_env(env),
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                    encoding='utf-8', errors='replace', start_new_session=sys.platform != 'win32')
            result['executed'] = True
            try:
                stdout, stderr = proc.communicate(timeout=timeout_sec)
                result.update(returncode=proc.returncode, stdout=stdout or '', stderr=stderr or '')
            except subprocess.TimeoutExpired:
                _kill_tree(proc.pid)
                try:
                    stdout, stderr = proc.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    stdout, stderr = '', ''
                result.update(returncode=124, stdout=stdout or '', stderr=stderr or '', timed_out=True, category='timeout', reason='прерван по времени')
        except (OSError, ValueError) as exc:
            result.update(returncode=2, error=str(exc), category='runner_error', reason=str(exc), executed=False)
    result.update(finished_at=now(), duration_sec=round(time.monotonic() - start, 3))
    from .report import category
    result['category'] = category(result)
    result['status'] = result['category']
    result.setdefault('reason', 'exit code ' + str(result.get('returncode')))
    result = mask_obj(result)
    logs = ROOT / 'logs'
    logs.mkdir(exist_ok=True)
    import json
    import uuid
    (logs / f'{uuid.uuid4().hex}.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result
