import json
import zipfile
from pathlib import Path
import pytest
from orchestrator import runner, doctor
from orchestrator.execution import safe_env
from orchestrator.masking import mask_obj
from orchestrator.report import generate, category
from orchestrator.handoff import create_handoff
from orchestrator.logs import mask
from orchestrator.plugins import find_suites
from orchestrator.datacore_checks import commands, BACKEND


@pytest.mark.parametrize('result,expected', [
    ({'returncode': 0}, 'passed'),
    ({'returncode': 1}, 'app_failure'),
    ({'returncode': 1, 'expected_failure': True}, 'expected_demo_failure'),
    ({'returncode': 0, 'expected_failure': True}, 'demo_mismatch'),
    ({'returncode': 2}, 'runner_error'),
    ({'returncode': 124, 'timed_out': True}, 'timeout'),
    ({'returncode': 2, 'category': 'not_implemented'}, 'not_implemented'),
])
def test_categories(result, expected):
    assert category(result) == expected


def test_all_persisted_surfaces_redacted(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, 'ROOT', tmp_path)
    text = 'kppd_synthetic123 mongodb+srv://root:synthetic-mongo@mongo.invalid/db JWT_REFRESH_SECRET=synthetic-refresh password="synthetic spaced" Bearer synthetic-bearer'
    result = runner.run_suite({'name': 'secret', 'command': ['python', '-c', f'import sys; print({text!r}); print({text!r}, file=sys.stderr); sys.exit(1)']})
    # Структурные секреты могут приходить напрямую, в обход CLI.
    result['payload'] = {'password': 'synthetic-structured', 'token': 'synthetic-token', 'nested': [{'apiKey': 'synthetic-key'}]}
    rep = generate([result], tmp_path / 'reports')
    handoff = create_handoff([result], tmp_path / 'handoff')
    banned = ['kppd_synthetic123', 'synthetic-mongo', 'synthetic-refresh', 'synthetic spaced', 'synthetic-bearer', 'synthetic-structured', 'synthetic-token', 'synthetic-key']
    for file in tmp_path.rglob('*'):
        if file.is_file() and file.suffix != '.zip':
            content = file.read_text(encoding='utf-8')
            assert all(secret not in content for secret in banned), file
    with zipfile.ZipFile(handoff.with_suffix('.zip')) as z:
        for filename in z.namelist():
            assert all(secret not in z.read(filename).decode('utf-8') for secret in banned), filename
    data = json.loads((rep / 'report.json').read_text(encoding='utf-8'))
    assert data['results'][0]['commit_hash']
    assert data['results'][0]['command']
    assert data['summary']['executed'] == ['secret']
    assert mask(text) == mask_obj(text)


def test_structured_and_cli_list_secrets():
    obj = mask_obj({'password': 'hidden', 'argv': ['--password', 'hidden-arg', '--JWT_SECRET=hidden-env']})
    assert 'hidden' not in json.dumps(obj)


def test_missing_executable_redacted(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, 'ROOT', tmp_path)
    r = runner.run_suite({'name': 'bad', 'command': ['nonexistent-kppd_secretcommand']})
    assert category(r) == 'runner_error'
    assert 'kppd_secretcommand' not in json.dumps(r)


@pytest.mark.parametrize('name', ['backup', 'load', 'soak', 'chaos', 'fuzz', 'mutation', 'visual', 'monkey', 'flaky'])
def test_stub_cannot_pass(name, tmp_path, monkeypatch):
    monkeypatch.setattr(runner, 'ROOT', tmp_path)
    s = next(s for s in find_suites() if s['name'] == name)
    r = runner.run_suite(s)
    assert r['returncode'] == 2 and category(r) == 'not_implemented'
    assert r['executed'] is False


def test_subprocess_env_no_production_fallback(monkeypatch):
    monkeypatch.setenv('MONGO_URI', 'synthetic-prod-uri')
    monkeypatch.setenv('JWT_SECRET', 'synthetic-prod-secret')
    monkeypatch.setenv('NODE_OPTIONS', 'synthetic-node-option')
    monkeypatch.setenv('DOCKER_HOST', 'synthetic-host')
    assert not {'MONGO_URI', 'JWT_SECRET', 'NODE_OPTIONS', 'DOCKER_HOST'} & safe_env().keys()


def test_datacore_checks_not_placeholders():
    static = commands('static')
    assert any('typescript' in c[1] for c in static)
    assert any('eslint' in c[1] for c in static)
    assert any('pwa-import-check' in c[1] for c in static)
    assert 'jest/bin/jest.js' in commands('unit')[0][1].replace('\\', '/')
    assert BACKEND == Path(__file__).resolve().parents[3] / 'backend'


def test_doctor_missing_tools_real(monkeypatch):
    monkeypatch.setattr(doctor.shutil, 'which', lambda x: None)
    info = doctor.check()
    assert info['ok'] is False
    assert all(v['ok'] is False and 'отсутствует' in v['error'] for v in info['tools'].values())


@pytest.mark.parametrize('key', ['pwd', 'credential', 'private_key', 'private-key'])
def test_text_secret_key_variants(key):
    from orchestrator.masking import mask_text
    assert 'CANARY_VALUE' not in mask_text(f'{key}="CANARY_VALUE"')
    assert 'CANARY_VALUE' not in mask_text(f'--{key} CANARY_VALUE')


def test_short_password_flag_and_new_keys_all_persisted(tmp_path, monkeypatch):
    monkeypatch.setattr(runner, 'ROOT', tmp_path)
    text = 'pwd=CANARY_PWD credential=CANARY_CREDENTIAL private_key="CANARY_PRIVATE" tool -p CANARY_SHORT_PASSWORD'
    result = runner.run_suite({'name': 'redaction-regression', 'command': ['python', '-c', f'print({text!r})']})
    result['command'] = ['tool', '-p', 'CANARY_ARG_PASSWORD']
    report = generate([result], tmp_path / 'reports')
    handoff = create_handoff([result], tmp_path / 'handoff')
    assert report.exists()
    for file in tmp_path.rglob('*'):
        if file.is_file() and file.suffix != '.zip':
            assert 'CANARY_' not in file.read_text(encoding='utf-8'), file
    with zipfile.ZipFile(handoff.with_suffix('.zip')) as archive:
        for filename in archive.namelist():
            assert 'CANARY_' not in archive.read(filename).decode('utf-8'), filename


def test_stand_failure_keeps_full_redacted_log(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from orchestrator import stand
    monkeypatch.setattr(stand, 'ROOT', tmp_path)
    monkeypatch.setattr(stand.subprocess, 'run', lambda *a, **kw: SimpleNamespace(returncode=2, stdout='START\nerror TS9999: точная причина\npwd=CANARY_LOG_PASSWORD\nEND\n', stderr=''))
    with pytest.raises(stand.StandError, match='error TS9999') as caught:
        stand._run(['docker', 'compose', 'build'])
    logs = list((tmp_path / 'logs').glob('stand-*.log'))
    assert len(logs) == 1
    text = logs[0].read_text(encoding='utf-8')
    assert 'START' in text and 'END' in text
    assert 'CANARY_' not in text and 'CANARY_' not in str(caught.value)
