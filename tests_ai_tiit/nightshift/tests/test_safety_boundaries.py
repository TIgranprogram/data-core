import json
import sqlite3
from types import SimpleNamespace
import pytest
from orchestrator import stand, runner
from orchestrator.db import init_db
from orchestrator.resume import mark_stage
from orchestrator.report import category
from tests.test_isolation_stand import fixture_root, rows


def test_missing_project_refused():
    with pytest.raises(stand.StandError, match='fallback'):
        stand.load_context(None)


def test_remote_context_cannot_be_inherited(monkeypatch):
    seen = []
    def run(cmd, **kw):
        seen.append(cmd)
        return SimpleNamespace(returncode=0, stdout='[]', stderr='')
    monkeypatch.setattr(stand.subprocess, 'run', run)
    assert stand._run(['docker', 'version']) == '[]'
    assert seen == [['docker', '--context', 'default', 'version']]


def test_app_failure_not_runner_error(monkeypatch):
    monkeypatch.setattr(stand.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=1, stdout='', stderr='APP_FAILURE: invalid response password=synthetic-value'))
    with pytest.raises(stand.AppFailure) as e:
        stand._run(['docker', 'exec', 'nsqa-test-app', 'node', '/nightshift/regression.cjs'])
    assert 'synthetic-value' not in str(e.value)
    with pytest.raises(stand.StandError) as e:
        stand._run(['docker', 'inspect', 'nsqa-test-app'])
    assert type(e.value) is stand.StandError


def test_inspect_json_parsed_before_masking(monkeypatch, tmp_path):
    ctx = stand.context()
    root = fixture_root(tmp_path)
    stand._save(ctx, root)
    objects = rows(ctx)
    objects[0][1]['Config']['Env'] = ['JWT_SECRET=synthetic-inspect-secret']
    by_kind = {kind: [obj for k, obj in objects if k == kind] for kind, _ in objects}
    def fake_run(cmd, **kw):
        # Настоящий _resources использует _run и JSON parser, не мокается целиком.
        if 'inspect' in cmd:
            kind = cmd[3]
            matching = next(obj for obj in by_kind[kind] if obj['Name'].lstrip('/') == cmd[-1])
            return SimpleNamespace(returncode=0, stdout=json.dumps([matching]), stderr='')
        kind = 'container' if 'ps' in cmd else 'network' if 'network' in cmd else 'volume'
        names = '\n'.join(obj['Name'].lstrip('/') for obj in by_kind[kind])
        return SimpleNamespace(returncode=0, stdout=names, stderr='')
    monkeypatch.setattr(stand.subprocess, 'run', fake_run)
    data = stand.status(ctx['project'], root)
    assert data['state'] == 'present'
    assert 'synthetic-inspect-secret' not in json.dumps(data)


def test_sqlite_redaction(tmp_path):
    db = tmp_path / 'run.db'
    init_db(db)
    mark_stage(1, 'kppd_syntheticstage', 'password=synthetic-status', str(db))
    with sqlite3.connect(db) as conn:
        text = str(conn.execute('SELECT name,status FROM stages').fetchall())
    assert 'kppd_syntheticstage' not in text and 'synthetic-status' not in text


def test_runner_timeout_category(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, 'ROOT', tmp_path)
    result = runner.run_suite({'name': 'timeout', 'command': ['python', '-c', 'import time;time.sleep(10)']}, timeout_sec=0.1)
    assert category(result) == 'timeout'
    assert result['status'] == 'timeout'
