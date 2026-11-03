import argparse
import subprocess
import sys
import pytest
from orchestrator import cli, stand
from orchestrator.plugins import find_suites
from orchestrator.masking import mask_obj, mask_text
from orchestrator.profiles import load_profile, needs_isolation, select_suites


def test_night_profile_real_suites():
    selected, skipped = select_suites(find_suites(), load_profile('night'))
    assert [s['name'] for s in selected] == ['harness', 'static', 'backend_unit', 'isolation_check', 'regression']
    assert 'load' in skipped and 'demo' in skipped
    assert all(s.get('implemented', True) for s in selected)


def test_incomplete_profile_refused():
    with pytest.raises(ValueError, match='обязательные'):
        select_suites([{'name': 'static'}], load_profile('night'))


def test_unknown_profile():
    with pytest.raises(ValueError):
        load_profile('нет-такого')


def test_needs_isolation():
    assert needs_isolation([], {'isolation_gate': True})
    assert needs_isolation([{'needs_stand': True}])
    assert not needs_isolation([{'name': 'demo'}])


def test_no_implicit_selection(monkeypatch):
    monkeypatch.setattr(cli, 'find_suites', lambda *a: pytest.fail('Не должно быть автозапуска'))
    with pytest.raises(SystemExit) as e:
        cli.cmd_run(argparse.Namespace(profile=None, suite=None))
    assert e.value.code == 2


@pytest.mark.parametrize('safe', [False, True])
def test_gate(monkeypatch, safe):
    ran = []
    suites = [{'name': 'regression', 'command': ['x'], 'needs_stand': True}]
    monkeypatch.setattr(cli, 'find_suites', lambda *a: suites)
    monkeypatch.setattr(cli, 'generate', lambda r: 'r')
    monkeypatch.setattr(cli, 'create_handoff', lambda r: 'h')
    def gate(p):
        if not safe:
            raise stand.StandError('Небезопасная сеть')
    def run(s, **kw):
        ran.append(s['name'])
        return {'name': s['name'], 'returncode': 0, 'executed': True}
    monkeypatch.setattr(stand, 'check_isolation', gate)
    monkeypatch.setattr(cli, 'run_suite', run)
    with pytest.raises(SystemExit) as e:
        cli.cmd_run(argparse.Namespace(profile=None, suite='regression', project=stand.context()['project']))
    assert e.value.code == (0 if safe else 2)
    assert ran == (['regression'] if safe else [])


def test_cli_from_any_folder(tmp_path):
    r = subprocess.run([sys.executable, '-m', 'orchestrator.cli', 'run', '--suite', 'demo'],
                       cwd=tmp_path, capture_output=True, text=True, encoding='utf-8')
    assert r.returncode == 1, r.stdout + r.stderr
    assert not (tmp_path / 'reports').exists()


def test_masking():
    text = 'kppd_abc123 mongodb://root:hunter2@mongo:27017 JWT_SECRET=topsecret password: qwerty'
    out = mask_text(text)
    assert all(s not in out for s in ['kppd_abc123', 'hunter2', 'topsecret', 'qwerty'])
    assert 'mongo:27017' in out
    assert mask_obj({'a': ['Bearer abc.def'], 'n': 1}) == {'a': ['Bearer ***'], 'n': 1}
