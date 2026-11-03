import json
import re
import subprocess
import tarfile
import tempfile
import uuid
from pathlib import Path
import yaml
from .paths import ROOT
from .execution import safe_env, now
from .masking import mask_text, mask_obj

OWNER_LABEL = 'io.datacore.nightshift.owner'
FORBIDDEN_PORTS = {3000, 3001, 3002, 3102, 27017, 27018, 27118}


class StandError(Exception):
    pass


class AppFailure(StandError):
    pass


def pick_backup(names):
    found = [n for n in names if re.fullmatch(r'datacore-[\d_-]+\.tgz', n)]
    return max(found) if found else None


def context(project=None):
    ident = uuid.uuid4().hex if project is None else str(project).removeprefix('nsqa-')
    if not re.fullmatch(r'[a-f0-9]{32}', ident) or (project is not None and project != 'nsqa-' + ident):
        raise StandError('Нужен уникальный project nsqa-<32 hex>; legacy/nightshift/dcnight запрещены')
    return {'project': 'nsqa-' + ident, 'owner': ident, 'db': 'datacore-' + ident + '-night',
            'test_db': 'datacore-test-' + ident + '-night', 'created_at': now()}


def compose_env(ctx):
    username = ctx.get('admin_username', 'admin')
    if not isinstance(username, str) or not re.fullmatch(r'[\w.@+\-]{1,128}', username):
        raise StandError('Небезопасный bootstrap username')
    return {'NS_PROJECT': ctx['project'], 'NS_OWNER': ctx['owner'], 'NS_DB': ctx['db'], 'NS_TEST_DB': ctx['test_db'], 'NS_ADMIN_USERNAME': username}


def render(root=ROOT, ctx=None):
    ctx = ctx or context()
    text = (Path(root) / 'stand/docker-compose.yml').read_text(encoding='utf-8')
    for k, v in compose_env(ctx).items():
        text = text.replace('${' + k + '}', v)
    if '${' in text:
        raise StandError('В Compose есть неподтверждённые переменные')
    assert_stand_safe(ctx['db'], text, ctx['project'], ctx['owner'])
    return text


def assert_stand_safe(db, compose_text, project=None, owner=None):
    ctx = context(project) if project else None
    if not ctx or owner != ctx['owner'] or db != ctx['db']:
        raise StandError('Нет однозначного уникального project/owner/DB с суффиксом -night')
    data = yaml.safe_load(compose_text)
    if data.get('name') != project:
        raise StandError('Compose project не совпадает')
    nets = data.get('networks', {})
    if set(nets) != {'isolated'} or nets['isolated'].get('internal') is not True or nets['isolated'].get('external'):
        raise StandError('Разрешена только одна внутренняя сеть')
    if nets['isolated'].get('name') != project + '-internal' or set(data.get('volumes', {})) != {'mongo-data'} or data['volumes']['mongo-data'].get('name') != project + '-mongo-data':
        raise StandError('Имена сети/volume должны точно соответствовать project')
    for kind in ['networks', 'volumes']:
        for item in data.get(kind, {}).values():
            if item.get('external') or not item.get('name', '').startswith(project + '-') or item.get('labels', {}).get(OWNER_LABEL) != owner:
                raise StandError('Неоднозначное владение сетью/volume')
    services = data.get('services', {})
    if set(services) != {'mongo', 'mongo-init', 'mailpit', 'app'}:
        raise StandError('Неизвестный состав services')
    for name, s in services.items():
        if s.get('container_name') != project + '-' + name or s.get('labels', {}).get(OWNER_LABEL) != owner:
            raise StandError('Неоднозначное владение контейнером')
        if s.get('networks') != ['isolated'] or any(s.get(k) for k in ['network_mode', 'privileged', 'extra_hosts', 'env_file', 'external_links']):
            raise StandError('Небезопасная сеть или env_file')
        if s.get('ports'):
            raise StandError('Публикация портов отключена; API проверяется внутри app')
        allowed_mounts = {'mongo': ['mongo-data:/data/db'], 'app': ['./regression.cjs:/nightshift/regression.cjs:ro']}
        if s.get('volumes', []) != allowed_mounts.get(name, []):
            raise StandError('Неизвестный mount запрещён')
        for mount in s.get('volumes', []):
            if 'docker.sock' in str(mount) or '.env' in str(mount):
                raise StandError('Запрещённый mount')
    env = services['app'].get('environment', {})
    if env.get('MONGO_DB') != db or env.get('MONGO_DB_TEST') != ctx['test_db'] or env.get('MONGO_URI') != f'mongodb://mongo:27017/{db}?replicaSet=rs0':
        raise StandError('Mongo target не совпадает с уникальным стендом')
    username = env.get('ADMIN_USERNAME')
    if not isinstance(username, str) or not re.fullmatch(r'[\w.@+\-]{1,128}', username):
        raise StandError('Не подтверждён bootstrap username')
    expected_env = {'NODE_ENV': 'test', 'PORT': '3000', 'MONGO_URI': f'mongodb://mongo:27017/{db}?replicaSet=rs0',
                    'MONGO_DB': db, 'MONGO_DB_TEST': ctx['test_db'], 'JWT_SECRET': 'synthetic-nightshift-jwt-minimum-32',
                    'JWT_REFRESH_SECRET': 'synthetic-nightshift-refresh-minimum-32', 'ADMIN_PASSWORD': 'synthetic-nightshift-admin',
                    'ADMIN_USERNAME': username,
                    'SMTP_HOST': 'mailpit', 'SMTP_PORT': '1025', 'CORS_ORIGIN': 'http://app:3000'}
    if env != expected_env:
        raise StandError('Неизвестные environment/URL запрещены; только synthetic настройки')


def _run(cmd, cwd=None, timeout=600, env=None):
    if cmd and cmd[0] == 'docker':
        cmd = ['docker', '--context', 'default', *cmd[1:]]
    try:
        r = subprocess.run(cmd, cwd=cwd, env=safe_env(env), capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise StandError(mask_text(str(exc))) from exc
    if r.returncode:
        # Компьютер хранит полный безопасный журнал; ИИ читает только точную строку ошибки.
        log_dir = Path(ROOT) / 'logs'
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = log_dir / ('stand-' + uuid.uuid4().hex + '.log')
        text = mask_text(r.stdout + r.stderr)
        log_file.write_text(text, encoding='utf-8')
        if cmd[-1] == '/nightshift/regression.cjs' and r.returncode == 1 and 'APP_FAILURE:' in r.stderr:
            raise AppFailure(mask_text(r.stderr[-500:]))
        detail = next((line for line in text.splitlines() if 'error TS' in line or 'Error:' in line), text[-500:])
        raise StandError(mask_text(f'Команда {cmd[0]} {cmd[1]}: exit {r.returncode}; {detail}; полный лог: {log_file}'))
    # JSON inspect разбирается в памяти; redaction выполняется на persisted/output границах.
    return r.stdout


def _compose(ctx, args, root=ROOT):
    render(root, ctx)
    return _run(['docker', 'compose', '--env-file', str(Path(root) / 'stand/compose.env'),
                 '-f', str(Path(root) / 'stand/docker-compose.yml'), '-p', ctx['project'], *args],
                cwd=Path(root) / 'stand', env=compose_env(ctx))


def _resources(ctx):
    result = []
    for kind, cmd in [('container', ['docker', 'ps', '-a']), ('network', ['docker', 'network', 'ls']), ('volume', ['docker', 'volume', 'ls'])]:
        raw = _run([*cmd, '--filter', 'label=com.docker.compose.project=' + ctx['project'], '--format', '{{.ID}}' if kind != 'volume' else '{{.Name}}'])
        # Находим также подменённый ресурс с нашим именем, но без compose labels.
        named = _run([*cmd, '--filter', 'name=' + ctx['project'] + '-', '--format', '{{.ID}}' if kind != 'volume' else '{{.Name}}'])
        for ident in sorted(set(raw.splitlines() + named.splitlines())):
            if ident.strip():
                obj = json.loads(_run(['docker', kind, 'inspect', ident.strip()]))[0]
                result.append((kind, obj))
    return result


def _labels(kind, obj):
    return obj.get('Config', {}).get('Labels', {}) if kind == 'container' else obj.get('Labels', {})


def assert_owned(ctx, require=True):
    rows = _resources(ctx)
    if require and not rows:
        raise StandError('Контур отсутствует; ownership подтвердить нельзя')
    for kind, obj in rows:
        labels = _labels(kind, obj) or {}
        name = obj.get('Name', '').lstrip('/')
        allowed = {ctx['project'] + '-' + n for n in ['mongo', 'mongo-init', 'mailpit', 'app', 'internal', 'mongo-data']}
        if labels.get(OWNER_LABEL) != ctx['owner'] or labels.get('com.docker.compose.project') != ctx['project'] or name not in allowed:
            raise StandError('Ownership неоднозначен; операция запрещена')
        if kind == 'network' and obj.get('Internal') is not True:
            raise StandError('Сеть существующего контура не internal')
        if kind == 'container':
            nets = obj.get('NetworkSettings', {}).get('Networks', {})
            if set(nets) != {ctx['project'] + '-internal'} or obj.get('HostConfig', {}).get('PortBindings'):
                raise StandError('Контейнер подключён к чужой сети или публикует порт')
    return rows


def assert_absent(ctx):
    if _resources(ctx):
        raise StandError('Project уже существует; новый volume обязателен')
    for kind, cmd, fmt in [('container', ['docker', 'ps', '-a'], '{{.Names}}'), ('network', ['docker', 'network', 'ls'], '{{.Name}}'), ('volume', ['docker', 'volume', 'ls'], '{{.Name}}')]:
        names = _run([*cmd, '--format', fmt]).splitlines()
        if any(n.startswith(ctx['project'] + '-') for n in names):
            raise StandError(f'Имя {kind} уже занято; ownership неизвестен')


def _manifest(root, project):
    context(project)
    return Path(root) / 'data/stands' / (project + '.json')


def load_context(project, root=ROOT):
    if not project:
        raise StandError('Нужен явный уникальный --project; fallback запрещён')
    expected = context(project)
    path = _manifest(root, project)
    if not path.exists():
        raise StandError('Нет локального ownership manifest; чужой контур не трогаем')
    ctx = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(ctx, dict) or any(ctx.get(k) != expected[k] for k in ['project', 'owner', 'db', 'test_db']):
        raise StandError('Повреждён ownership manifest')
    render(root, ctx)
    return ctx


def _save(ctx, root):
    path = _manifest(root, ctx['project'])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(mask_obj(ctx), ensure_ascii=False, indent=2), encoding='utf-8')


def _allocate(root):
    ctx = context()
    render(root, ctx)
    assert_absent(ctx)
    path = _manifest(root, ctx['project'])
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as f:
        json.dump(ctx, f)
    return ctx


def up(root=ROOT):
    ctx = _allocate(root)
    _compose(ctx, ['up', '-d', '--build', '--wait', '--wait-timeout', '180'], root)
    assert_owned(ctx)
    ctx['state'] = 'running'
    _save(ctx, root)
    return ctx


def status(project=None, root=ROOT):
    if not project:
        paths = sorted((Path(root) / 'data/stands').glob('*.json'))
        return {'known_projects': [p.stem for p in paths], 'detail': 'Выберите --project для read-only Docker status'}
    ctx = load_context(project, root)
    rows = assert_owned(ctx, require=False)
    return mask_obj({'project': project, 'state': 'absent' if not rows else 'present',
                     'resources': [{'kind': k, 'name': o.get('Name'), 'state': o.get('State', {})} for k, o in rows]})


def down(project, root=ROOT):
    ctx = load_context(project, root)
    assert_owned(ctx)
    _compose(ctx, ['down'], root)  # Без -v; volume сохраняется навсегда до явной ручной уборки.
    return {'project': project, 'state': 'stopped', 'volume_preserved': True}


def find_dump(extracted):
    candidates = [p for p in Path(extracted).glob('*/datacore') if p.is_dir()]
    if len(candidates) != 1:
        raise StandError('В backup нужна ровно одна папка */datacore')
    return candidates[0]


def _mongo(ctx, script):
    assert_owned(ctx)
    return _run(['docker', 'exec', ctx['project'] + '-mongo', 'mongo', '--quiet', ctx['db'], '--eval', script]).strip()


def refresh(backup, root=ROOT):
    """Восстановление только в новый project/volume; старые базы не очищаются."""
    backup = Path(backup)
    if not backup.is_file() or pick_backup([backup.name]) is None:
        raise StandError('Нужен явно выбранный datacore-<дата>.tgz')
    ctx = _allocate(root)
    # Приложение не стартует до restore: пустой Mongo проверяется до записи.
    _compose(ctx, ['up', '-d', '--wait', '--wait-timeout', '180', 'mongo', 'mongo-init', 'mailpit'], root)
    assert_owned(ctx)
    if _mongo(ctx, 'print(db.getCollectionNames().length)') != '0':
        raise StandError('Новая DB не пуста; restore запрещён')
    with tempfile.TemporaryDirectory(prefix=ctx['project'] + '-', dir=Path(root) / 'data') as td:
        with tarfile.open(backup, 'r:gz') as tar:
            tar.extractall(td, filter='data')
        dump = find_dump(td)
        expected = len(list(dump.glob('*.bson')))
        if not expected:
            raise StandError('В backup нет BSON')
        assert_owned(ctx)
        _run(['docker', 'cp', str(dump), ctx['project'] + '-mongo:/tmp/restore-input'])
        assert_owned(ctx)
        _run(['docker', 'exec', ctx['project'] + '-mongo', 'mongorestore', '--quiet', '--stopOnError', '--db', ctx['db'], '/tmp/restore-input'])
    restored = json.loads(_mongo(ctx, 'var o={};db.getCollectionNames().forEach(function(c){o[c]=db.getCollection(c).count()});print(JSON.stringify(o))'))
    if len(restored) < expected or sum(restored.values()) == 0:
        raise StandError('Restore не подтверждён количеством коллекций/документов')
    bootstrap = json.loads(_mongo(ctx, 'print(JSON.stringify(db.users.findOne({isOwner:true},{username:1})||db.users.findOne({role:"admin"},{username:1})))'))
    if not isinstance(bootstrap, dict) or not bootstrap.get('username'):
        raise StandError('В новой копии нет bootstrap admin')
    ctx['admin_username'] = bootstrap['username']
    compose_env(ctx)
    _compose(ctx, ['up', '-d', '--no-deps', '--build', '--wait', '--wait-timeout', '180', 'app'], root)
    assert_owned(ctx)
    ctx.update(state='restored', backup=backup.name, collections=len(restored), documents=sum(restored.values()))
    _save(ctx, root)
    return ctx


def check_isolation(project, root=ROOT):
    ctx = load_context(project, root)
    rows = assert_owned(ctx)
    kinds = {k for k, _ in rows}
    names = {o.get('Name', '').lstrip('/') for _, o in rows}
    if not {'container', 'network', 'volume'} <= kinds or not {project + '-mongo', project + '-app'} <= names:
        raise StandError('Неполный контур; изоляция не подтверждена')
    return {'project': project, 'isolated': True, 'proof': 'validated Compose + resource ownership/internal network/no published ports'}


def regression(project, root=ROOT):
    check_isolation(project, root)
    ctx = load_context(project, root)
    assert_owned(ctx)
    return mask_text(_run(['docker', 'exec', ctx['project'] + '-app', 'node', '/nightshift/regression.cjs'], timeout=120))
