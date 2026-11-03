import json
import shutil
import tarfile
from pathlib import Path
import pytest
from orchestrator import stand


def fixture_root(tmp_path):
    (tmp_path / 'stand').mkdir()
    shutil.copy(stand.ROOT / 'stand/docker-compose.yml', tmp_path / 'stand/docker-compose.yml')
    return tmp_path


def rows(ctx, wrong=False):
    labels = {stand.OWNER_LABEL: 'unknown' if wrong else ctx['owner'], 'com.docker.compose.project': ctx['project']}
    return [('container', {'Name': '/' + ctx['project'] + '-' + service,
                           'Config': {'Labels': labels}, 'HostConfig': {'PortBindings': {}},
                           'NetworkSettings': {'Networks': {ctx['project'] + '-internal': {}}}}) for service in ['mongo', 'app']] + [
        ('network', {'Name': ctx['project'] + '-internal', 'Labels': labels, 'Internal': True}),
        ('volume', {'Name': ctx['project'] + '-mongo-data', 'Labels': labels})]


def test_unknown_ownership_never_stops(monkeypatch, tmp_path):
    root = fixture_root(tmp_path)
    ctx = stand.context()
    stand._save(ctx, root)
    monkeypatch.setattr(stand, '_resources', lambda c: rows(c, wrong=True))
    calls = []
    monkeypatch.setattr(stand, '_compose', lambda *a: calls.append(a))
    with pytest.raises(stand.StandError, match='Ownership'):
        stand.down(ctx['project'], root)
    assert calls == []


def test_down_preserves_volume(monkeypatch, tmp_path):
    root = fixture_root(tmp_path)
    ctx = stand.context()
    stand._save(ctx, root)
    monkeypatch.setattr(stand, '_resources', rows)
    calls = []
    monkeypatch.setattr(stand, '_compose', lambda c, args, root: calls.append(args))
    assert stand.down(ctx['project'], root)['volume_preserved']
    assert calls == [['down']]


def test_missing_manifest_does_not_call_docker(monkeypatch, tmp_path):
    monkeypatch.setattr(stand, '_run', lambda *a, **kw: pytest.fail('Docker не должен вызываться'))
    with pytest.raises(stand.StandError, match='manifest'):
        stand.down(stand.context()['project'], tmp_path)


def test_fake_refresh_twice_unique_without_drop(monkeypatch, tmp_path):
    root = fixture_root(tmp_path)
    source = tmp_path / 'source/mongo-1/datacore'
    source.mkdir(parents=True)
    (source / 'users.bson').write_bytes(b'synthetic bson fixture')
    backup = tmp_path / 'datacore-2026-11-03_000000.tgz'
    with tarfile.open(backup, 'w:gz') as tar:
        tar.add(source.parent, arcname='mongo-1')
    commands = []
    allocated = set()
    def resources(c):
        return rows(c) if c['project'] in allocated else []
    def run(cmd, **kw):
        commands.append(cmd)
        if cmd[:3] == ['docker', 'exec', next(iter(allocated), '') + '-mongo'] or 'mongo' in cmd:
            if cmd[-1] == 'print(db.getCollectionNames().length)':
                return '0'
            if 'isOwner:true' in cmd[-1]:
                return json.dumps({'username': 'restored-admin'})
            if 'JSON.stringify' in cmd[-1]:
                return json.dumps({'users': 5})
        return ''
    def compose(c, args, root):
        commands.append(['compose', c['project'], *args])
        allocated.add(c['project'])
    monkeypatch.setattr(stand, '_resources', resources)
    monkeypatch.setattr(stand, '_run', run)
    monkeypatch.setattr(stand, '_compose', compose)
    first = stand.refresh(backup, root)
    second = stand.refresh(backup, root)
    assert first['project'] != second['project']
    assert first['db'] != second['db']
    assert len(list((root / 'data/stands').glob('*.json'))) == 2
    text = json.dumps(commands)
    assert all(not {'--drop', 'down', 'rm', '-v'} & set(cmd) for cmd in commands)
    assert 'nightshift-mongo' not in text and 'dcnight' not in text
    assert sum('mongorestore' in cmd for cmd in commands) == 2


def test_existing_name_refused(monkeypatch):
    ctx = stand.context()
    monkeypatch.setattr(stand, '_resources', lambda c: [])
    monkeypatch.setattr(stand, '_run', lambda *a, **kw: ctx['project'] + '-mongo-data')
    with pytest.raises(stand.StandError, match='занято'):
        stand.assert_absent(ctx)


def test_readonly_isolation_no_network_probe(monkeypatch, tmp_path):
    root = fixture_root(tmp_path)
    ctx = stand.context()
    stand._save(ctx, root)
    monkeypatch.setattr(stand, '_resources', rows)
    assert stand.check_isolation(ctx['project'], root)['isolated']
    def unsafe(c):
        out = rows(c)
        out[0][1]['NetworkSettings']['Networks']['data-core_default'] = {}
        return out
    monkeypatch.setattr(stand, '_resources', unsafe)
    with pytest.raises(stand.StandError, match='чужой'):
        stand.check_isolation(ctx['project'], root)
