import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { COMMANDS } from '../pult/catalog.mjs';
import { canAutoPull, readStatus } from '../pult/server.mjs';
import { withManualStandLock } from './night.mjs';
import { DEVELOPMENT_METADATA_TARGET, localDockerEndpoint, newStandRun, ownerLabels, RELAY_COMMAND } from './night-owner.mjs';
import { createNightStand, developmentMetadata, snapshotAt } from './night-stand.mjs';
import { DEVELOPMENT_APP, WORK_APP, checkConnections, confirmDevelopmentMetadata, startDevelopment } from './work-modes.mjs';

const head = 'a'.repeat(40);
const backendHead = 'b'.repeat(40);
const savedBackup = 'datacore-2026-11-18_031040.tgz';
const restoredAt = '2026-11-18T14:42:00.000Z';
const ctx = { say() {}, log() {} };

test('автоподтягивание Git требует подтверждённой остановки локальных интерфейсов', () => {
  const idle = { behind: 1, ahead: 0, dirty: 0, localBackendRunning: false };
  assert.equal(canAutoPull(idle, 0, 600_001), true);
  for (const changed of [{ localBackendRunning: true }, { localBackendRunning: null }, { dirty: 1 }, { ahead: 1 }, { behind: 0 }]) {
    assert.equal(canAutoPull({ ...idle, ...changed }, 0, 600_001), false);
  }
  assert.equal(canAutoPull(idle, 1, 600_001), false);
  assert.equal(canAutoPull(idle, 0, 600_000), false);
});

test('автоподтягивание пропускает неизвестный Docker и backend без действующего указателя', async () => {
  const cases = [
    { endpoint: 'unix:///var/run/docker.sock', ps: { ok: false, out: '' }, running: null, queries: 1 },
    { endpoint: 'unix:///var/run/docker.sock', ps: { ok: true, out: 'dcnight-backend\n' }, running: true, queries: 1 },
    { endpoint: 'unix:///var/run/docker.sock', ps: { ok: true, out: `dc-${'a'.repeat(24)}-night-backend\r\n` }, running: true, queries: 1 },
    { endpoint: 'unix:///var/run/docker.sock', ps: { ok: true, out: 'datacore-backend\n' }, running: true, queries: 1 },
    { endpoint: 'ssh://production', ps: { ok: true, out: '' }, running: null, queries: 0 },
    { endpoint: 'unix:///var/run/docker.sock', ps: { ok: true, out: 'datacore-mongo\n' }, running: false, queries: 1 },
  ];
  for (const { endpoint, ps, running, queries } of cases) {
    let psCalls = 0;
    const status = await readStatus({ docker: 'docker' }, {}, { standFn: () => null, dockerEnv: {}, shFn: async (file, args) => {
      if (file === 'docker' && args[0] === 'context') return { ok: true, out: endpoint };
      if (file === 'docker' && args[0] === 'ps') { psCalls++; return ps; }
      return { ok: true, out: args[0] === 'rev-list' ? '0 1' : '' };
    } });
    assert.equal(status.localBackendRunning, running);
    assert.equal(canAutoPull(status, 0, 600_001), running === false);
    assert.equal(psCalls, queries);
  }
});

test('ручные операции делят замок, после сбоя и старого PID доступ восстанавливается', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-lock-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const lock = path.join(temp, 'manual-lock');
  let done;
  const pending = withManualStandLock(() => new Promise((resolve) => { done = resolve; }), lock);
  await assert.rejects(withManualStandLock(() => assert.fail('одновременная операция'), lock), /Дождитесь/);
  done(0);
  assert.equal(await pending, 0);
  await assert.rejects(withManualStandLock(() => { throw new Error('ошибка сборки'); }, lock), /ошибка сборки/);
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, `2147483647-${'0'.repeat(24)}`), '');
  assert.equal(await withManualStandLock(() => 'повтор', lock), 'повтор');
  assert.deepEqual(fs.readdirSync(temp), []);
});

test('три кнопки доступны в обычном разделе сайта, рабочий адрес фиксирован', () => {
  const ids = ['link-srv-synology', 'development-start', 'connections-check'];
  const [work, development, check] = ids.map((id) => COMMANDS.find((c) => c.id === id));
  assert.ok([work, development, check].every((c) => c.section === 'day' && !c.hidden && !c.extra));
  assert.deepEqual(work.run, { open: WORK_APP });
  assert.deepEqual(development.run.node, ['tools/work-modes.mjs', 'start']);
  assert.deepEqual(check.run.node, ['tools/work-modes.mjs', 'check']);
});

test('разработка открывается после ready и сверки метаданных, ошибка и --no-open не открывают браузер', async () => {
  const events = [];
  const expected = { data: { backup: savedBackup }, code: { head } };
  const prepare = (_ctx, done) => { events.push('guard/up/refresh'); return done(expected); };
  const confirmReady = () => { events.push('ready'); return true; };
  const confirmMetadata = (metadata) => { assert.deepEqual(metadata, expected); events.push('metadata'); return true; };
  const open = () => events.push('open');
  const say = (message) => events.push(message);
  assert.equal(await startDevelopment({ prepare, confirmReady, confirmMetadata, say, open }), 0);
  assert.deepEqual(events, ['guard/up/refresh', 'ready', 'metadata', `Разработка готова: ${DEVELOPMENT_APP}`, 'open']);
  events.length = 0;
  await assert.rejects(startDevelopment({ prepare, confirmReady: () => false, say, open }), /Локальная копия не прошла/);
  assert.deepEqual(events, ['guard/up/refresh']);
  events.length = 0;
  await assert.rejects(startDevelopment({ prepare, confirmReady, confirmMetadata: () => false, say, open }), /не подтвердило копию/);
  assert.deepEqual(events, ['guard/up/refresh', 'ready']);
  events.length = 0;
  await assert.rejects(startDevelopment({ prepare: () => { throw new Error('неизвестный стенд'); }, confirmReady, say, open }), /неизвестный стенд/);
  assert.deepEqual(events, []);
  await startDevelopment({ prepare, confirmReady, confirmMetadata, say, open, noOpen: true });
  assert.deepEqual(events, ['guard/up/refresh', 'ready', 'metadata', `Разработка готова: ${DEVELOPMENT_APP}`]);
});

test('подтверждение метаданных читает loopback без кэша, чужая копия, редирект и сбой дают отказ', async () => {
  const expected = { data: { backup: savedBackup }, code: { head } };
  const requests = [];
  const ok = (body) => async (url, init) => { requests.push({ url, init }); return { ok: true, json: async () => body }; };
  assert.equal(await confirmDevelopmentMetadata(expected, ok(expected)), true);
  assert.equal(await confirmDevelopmentMetadata(expected, ok({ ...expected, data: { backup: 'other.tgz' } })), false);
  assert.equal(await confirmDevelopmentMetadata(expected, ok({ ...expected, code: { head: backendHead } })), false);
  assert.equal(await confirmDevelopmentMetadata(expected, async () => ({ status: 302, ok: false })), false);
  assert.equal(await confirmDevelopmentMetadata(expected, async () => { throw new Error('offline'); }), false);
  assert.ok(requests.every(({ url, init }) => url === 'http://127.0.0.1:3102/app/development.json' && init.cache === 'no-store' && init.redirect === 'error'));
});

test('локальный Docker ограничен именованным каналом Windows и Unix-сокетом', () => {
  for (const endpoint of ['npipe:////./pipe/dockerDesktopLinuxEngine\r\n', 'unix:///var/run/docker.sock', 'unix:///home/user/.docker/desktop/docker.sock']) assert.ok(localDockerEndpoint(endpoint));
  for (const endpoint of ['ssh://production', 'tcp://localhost:2376', 'tcp://192.168.1.1:2375', 'npipe:////host/pipe/docker_engine', '']) assert.equal(localDockerEndpoint(endpoint), false);
});

test('метаданные различают снимок, восстановление и успешную сборку, неизвестные значения остаются null', () => {
  assert.equal(snapshotAt(savedBackup), '2026-11-18T03:10:40');
  for (const backup of ['datacore-2026-02-31_031040.tgz', 'datacore-2026-11-18_240000.tgz', 'datacore-2026-11-18.tgz', null]) assert.equal(snapshotAt(backup), null);
  const run = { apiPort: 3102, backup: savedBackup, restoredAt, dataAt: 33, db: 'private-db', password: 'private-password' };
  assert.deepEqual(developmentMetadata(run), {
    mode: 'development', origin: 'http://localhost:3102', data: { backup: savedBackup, snapshotAt: '2026-11-18T03:10:40', restoredAt },
    code: { branch: null, head: null, dirty: null, builtAt: null },
  });
  const unknown = developmentMetadata({ ...run, backup: '/private/backup.tgz', restoredAt: undefined }, { branch: 'bad\nbranch', head: '/private/path', dirty: 'dirty' });
  assert.deepEqual(unknown.data, { backup: null, snapshotAt: null, restoredAt: null });
  assert.deepEqual(unknown.code, { branch: null, head: null, dirty: null, builtAt: null });
});

function fixture(t, { noRun = false, port = 3102, edit = () => {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-modes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nightDir = path.join(root, '.night');
  const backupDir = path.join(root, 'backups');
  const run = newStandRun({ apiPort: port });
  Object.assign(run, { initialized: true, backup: savedBackup, restoredAt, createdContainers: ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)] });
  const runDir = path.join(nightDir, 'stands', run.id);
  if (!noRun) {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(nightDir, 'current-stand.json'), JSON.stringify(run));
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run));
    const secretKeys = [['NIGHT_ROOT_PW', 12], ['NIGHT_APP_PW', 12], ['NIGHT_JWT', 24], ['NIGHT_JWT_REFRESH', 24], ['NIGHT_ADMIN_PW', 12], ['NIGHT_KEYFILE', 48], ['NIGHT_QA_PW', 12]];
    fs.writeFileSync(path.join(runDir, 'stand.env'), secretKeys.map(([key, size]) => `${key}=${'ab'.repeat(size)}`).join('\n'));
  }
  const labels = ownerLabels(run);
  const localNet = `${run.project}_default`, proxyNet = `${run.project}_access`;
  const container = (service, i, properties) => ({ service, id: run.createdContainers[i], name: `${run.project}-${service}`, labels, running: true, networks: [localNet], mounts: [], ports: {}, ...properties });
  const volumeMount = (name, destination) => ({ type: 'volume', name: `${run.project}_${name}`, destination });
  const snapshot = {
    volumes: ['secrets', 'mongo-data', 'mongo-config', 'uploads'].map((name) => ({ name: `${run.project}_${name}`, labels })),
    networks: [{ name: localNet, internal: true, labels }, { name: proxyNet, internal: false, labels }],
    containers: [
      container('mongo', 0, { mounts: [volumeMount('mongo-data', '/data/db')] }),
      container('backend', 1, { db: run.db, uriTarget: `mongo:27017/${run.db}`, mounts: [volumeMount('uploads', '/app/uploads')] }),
      container('proxy', 2, { networks: [localNet, proxyNet], command: [RELAY_COMMAND], entrypoint: ['/bin/sh', '-c'], ports: {
        '27017/tcp': [{ HostIp: '127.0.0.1', HostPort: String(run.mongoPort) }],
        '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(run.apiPort) }],
      } }),
    ],
  };
  edit(snapshot, run);
  const metadataPath = path.join(runDir, 'development.json');
  const readMetadata = () => JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const calls = [];
  const docker = (args, { env } = {}) => {
    calls.push(args);
    assert.equal(args[0], 'compose');
    assert.equal(args[args.indexOf('-p') + 1], run.project);
    assert.equal(env.NIGHT_DEVELOPMENT_METADATA, metadataPath.replace(/\\/g, '/'));
    assert.equal(env.NIGHT_SRC, root.replace(/\\/g, '/'));
    if (args.includes('--build')) {
      assert.equal(readMetadata().code.builtAt, null);
      snapshot.containers[1].mounts.push({ type: 'bind', destination: DEVELOPMENT_METADATA_TARGET, readOnly: true });
    }
    return { code: 0, out: '' };
  };
  const inventoryFn = () => noRun ? { containers: [], volumes: [], networks: [] } : structuredClone(snapshot);
  const stand = createNightStand({ docker, root, composeFile: 'fake.yml', nightDir, backupDir, inventoryFn, portFreeFn: async () => true, buildCode: () => ({ branch: 'main', head, dirty: true }), healthFn: async () => {
    assert.equal(readMetadata().code.builtAt, null);
    return true;
  } });
  return { stand, calls, root, nightDir, run, snapshot, readMetadata };
}

test('refresh собирает текущую папку поверх существующих Mongo и uploads, готовая сборка отмечается после ready', async (t) => {
  const { stand, calls, run, snapshot, readMetadata } = fixture(t);
  const volumes = structuredClone(snapshot.volumes);
  assert.equal(await stand.prepareDevelopment(ctx), 0);
  assert.deepEqual(snapshot.volumes, volumes);
  assert.equal(stand.current().id, run.id);
  assert.equal(stand.developmentOwned({ requireMetadata: true }).data.backup, savedBackup);
  assert.deepEqual(stand.developmentOwned({ requireMetadata: true }), readMetadata());
  assert.equal(calls.filter((args) => args.includes('--build')).length, 1);
  assert.equal(calls.filter((args) => args.includes('mongorestore')).length, 0);
  assert.deepEqual(readMetadata().data, { backup: savedBackup, snapshotAt: '2026-11-18T03:10:40', restoredAt });
  assert.equal(readMetadata().code.head, head);
  assert.equal(readMetadata().code.dirty, true);
  assert.ok(Number.isFinite(Date.parse(readMetadata().code.builtAt)));
});

test('guard отказывает неизвестному project, рабочей БД, чужому volume, неверным портам и отсутствию копии', async (t) => {
  const cases = [
    { options: { edit: (s) => { s.containers[1].labels = {}; } }, message: /чужой/ },
    { options: { edit: (s) => { s.containers[1].uriTarget = 'production:27017/datacore'; } }, message: /БД backend/ },
    { options: { edit: (s) => { s.containers[0].mounts[0].name = 'datacore_prod'; } }, message: /volume/ },
    { options: { edit: (s) => { s.containers[1].mounts.push({ type: 'bind', destination: DEVELOPMENT_METADATA_TARGET, readOnly: false }); } }, message: /read-only bind/ },
    { options: { edit: (s) => { s.containers.shift(); } }, message: /Mongo/ },
    { options: { port: 3199 }, message: /портам разработки/ },
    { options: { noRun: true }, message: /нет архива/ },
  ];
  for (const { options, message } of cases) {
    const f = fixture(t, options);
    await assert.rejects(f.stand.prepareDevelopment(ctx), message);
    assert.deepEqual(f.calls, []);
    if (options.noRun) assert.equal(fs.existsSync(f.nightDir), false);
  }
});

test('check различает публичную версию и рабочий API, API 503 даёт код 1 даже при доступной версии', async () => {
  const requests = [], messages = [], gitQueries = [];
  const publicVersion = `${WORK_APP}version.json`;
  const publicReady = 'https://kppdf-crm.ru/db/api/health/ready';
  let readyStatus = 200;
  const args = {
    say: (message) => messages.push(message),
    fetchFn: async (url, init) => {
      requests.push({ url, init });
      if (url === publicVersion) return { ok: true, status: 200, json: async () => ({ v: 'aaaaaaa', b: 'ccccccc', n: 940 }) };
      assert.equal(url, publicReady);
      return { ok: readyStatus === 200, status: readyStatus, json: async () => ({ status: readyStatus === 200 ? 'ok' : 'error' }) };
    },
    git: () => ({ branch: 'main', head, dirty: true, upstream: 'origin/main', ahead: 2, behind: 1 }),
    gitHead: (paths) => { gitQueries.push(paths); return paths[0] === 'backend/pwa' ? head : backendHead; },
    docker: () => true,
    localBackup: () => 'datacore-2026-11-19_080000.tgz',
    development: () => ({ backup: savedBackup, snapshotAt: '2026-11-18T03:10:40', restoredAt }),
    confirmReady: () => true,
    remote: () => true,
  };
  assert.equal(await checkConnections(args), 0);
  assert.deepEqual(gitQueries, [['backend/pwa'], ['backend/src', 'backend/package.json', 'backend/Dockerfile', 'docker-compose.prod.yml']]);
  assert.deepEqual(requests.map(({ url }) => url), [publicVersion, publicReady]);
  for (const { init } of requests) {
    assert.equal(init.method, undefined); // GET по умолчанию.
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers, undefined);
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.match(messages.join('\n'), /Рабочий API: доступ к данным подтверждён/);
  assert.match(messages.join('\n'), /Приложение: .*совпадает/);
  assert.match(messages.join('\n'), /Сервер: .*различается/);
  assert.match(messages.join('\n'), /есть локальные изменения/);
  assert.match(messages.join('\n'), /впереди 2, позади 1/);
  assert.match(messages.join('\n'), /2026-11-19_080000.*\n.*\n.*\nКопия разработки: datacore-2026-11-18_031040/);
  assert.equal(await checkConnections({ ...args, docker: () => false, development: () => assert.fail('ownership без локального Docker') }), 1);
  readyStatus = 503;
  messages.length = 0;
  requests.length = 0;
  assert.equal(await checkConnections(args), 1);
  assert.deepEqual(requests.map(({ url }) => url), [publicVersion, publicReady]);
  assert.match(messages.join('\n'), /Рабочий сайт: публичная версия доступна/);
  assert.match(messages.join('\n'), /Рабочий API: доступ к данным не подтверждён/);
  assert.match(messages.join('\n'), /Разработка: локальное API готово/);
});
