// node --test tools/night.test.mjs — защита стенда, замок, разбор итогов. Без Docker.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isNightDb, assertStandSafe, lockState, acquireLock, releaseLock, tailBytes, failSignature, makeStep, summarize, stepLine, parseEnvFile, pickBackup, pushRunToControl } from './night.mjs';

test('isNightDb: только имена на -night', () => {
  assert.ok(isNightDb('datacore-night'));
  assert.ok(isNightDb('datacore-test-night'));
  for (const bad of ['datacore', 'datacore-test', 'datacoreqa', 'night', 'datacore-night-x', '', null, undefined, '-night', 'a b-night']) assert.equal(isNightDb(bad), false, String(bad));
});

test('assertStandSafe: плохая БД или порт основного контура — код 2', () => {
  assert.ok(assertStandSafe());
  assert.throws(() => assertStandSafe({ db: 'datacore' }), (e) => e.code === 2 && /-night/.test(e.message));
  assert.throws(() => assertStandSafe({ testDb: 'datacore-test' }), (e) => e.code === 2);
  for (const p of [3001, 3002, 27018, 27017, 3000]) {
    assert.throws(() => assertStandSafe({ apiPort: p }), (e) => e.code === 2);
    assert.throws(() => assertStandSafe({ mongoPort: p }), (e) => e.code === 2);
  }
});

test('lockState: свободен, занят, протух (возраст, мёртвый pid), чужой ПК', () => {
  const now = 1_000_000_000;
  const mine = os.hostname();
  assert.equal(lockState(null, { now }), 'free');
  assert.equal(lockState({ host: mine, pid: 1, start: now - 1000 }, { now, host: mine, isAlive: () => true }), 'busy');
  assert.equal(lockState({ host: mine, pid: 1, start: now - 1000 }, { now, host: mine, isAlive: () => false }), 'stale');
  assert.equal(lockState({ host: mine, pid: 1, start: now - 5 * 3600e3 }, { now, host: mine, isAlive: () => true }), 'stale');
  // чужой ПК: pid не проверяем, только возраст
  assert.equal(lockState({ host: 'other', pid: 1, start: now - 1000 }, { now, host: mine, isAlive: () => false }), 'busy');
});

test('acquireLock: второй экземпляр отказывается, протухший заменяется, release снимает', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcn-'));
  const f = path.join(dir, 'lock.json');
  const a = acquireLock(f, { pid: 111, isAlive: () => true });
  assert.equal(a.ok, true);
  const b = acquireLock(f, { pid: 222, isAlive: () => true });
  assert.equal(b.ok, false);
  assert.equal(b.lock.pid, 111);
  const c = acquireLock(f, { pid: 333, isAlive: () => false });
  assert.equal(c.ok, true);
  assert.equal(c.replaced, true);
  releaseLock(f, 999); assert.ok(fs.existsSync(f), 'чужой pid замок не снимает');
  releaseLock(f, 333); assert.ok(!fs.existsSync(f));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tailBytes: не больше n байт, хвост сохраняется', () => {
  assert.equal(tailBytes('abc', 10), 'abc');
  const t = tailBytes('я'.repeat(5000) + 'КОНЕЦ', 4096);
  assert.ok(Buffer.byteLength(t) <= 4096);
  assert.ok(t.endsWith('КОНЕЦ'));
});

test('failSignature: одинаковый провал с другими числами и путями — одна сигнатура', () => {
  const a = 'src/a/b.ts(10,5): error TS2322: Type x\nsrc/c.ts(2,1): error TS2304: no';
  const b = 'src/zz/q.ts(99,7): error TS2322: Type x\nsrc/c.ts(8,3): error TS2304: no';
  assert.equal(failSignature('tsc', a), failSignature('tsc', b));
  assert.notEqual(failSignature('tsc', a), failSignature('tsc', 'src/a.ts(1,1): error TS9999: другое'));
  assert.equal(failSignature('unit', 'всё тихо'), 'unit:no-lines');
  assert.match(failSignature('unit', '  ● Suite › case\nFAIL src/x.spec.ts'), /^unit:[0-9a-f]{8}$/);
});

test('makeStep / summarize / stepLine', () => {
  const ok = makeStep('tsc', { code: 0, ms: 4000, out: 'ok' }, 'abc1234');
  const bad = makeStep('unit', { code: 1, ms: 9000, out: 'FAIL x\n' + 'z'.repeat(9000) }, 'abc1234');
  const tmo = makeStep('e2e', { code: 124, ms: 5, out: 'x', timedOut: true }, 'abc1234');
  assert.equal(ok.signature, null);
  assert.ok(bad.signature.startsWith('unit:'));
  assert.ok(Buffer.byteLength(bad.tail) <= 4096);
  assert.equal(tmo.timedOut, true);
  assert.deepEqual(summarize([ok, bad, tmo]), { total: 3, green: 1, red: 2, failed: ['unit', 'e2e'] });
  assert.match(stepLine(ok), /^✓ tsc/);
  assert.match(stepLine(tmo), /^✗ e2e.*таймаут/);
});

test('parseEnvFile и pickBackup', () => {
  assert.deepEqual(parseEnvFile('A=1\n\nB_2=x=y\r\n#c'), { A: '1', B_2: 'x=y' });
  assert.equal(pickBackup(['datacore-2026-10-27_171446.tgz', 'datacore-2026-10-30_200436.tgz', 'datacore-2026-10-28_071609.tgz.part', 'pull.log']), 'datacore-2026-10-30_200436.tgz');
  assert.equal(pickBackup(['pull.log']), null);
});

test('pushRunToControl: нет файла ключа — пропуск без падения; есть — POST с ключом; сеть упала — строка, не исключение', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-key-'));
  const file = path.join(dir, 'control-key.local.env');
  assert.match(await pushRunToControl({ total: 1 }, { file }), /control-key.local.env/);
  fs.writeFileSync(file, ['CONTROL_URL=https://example.test/db/', 'CONTROL_KEY=kppd_abc', ''].join('\n'));
  let seen;
  const ok = async (url, init) => { seen = { url, init }; return { ok: true, status: 201 }; };
  assert.match(await pushRunToControl({ total: 1, steps: [] }, { file, fetchFn: ok, node: 'pc1' }), /отправлен/);
  assert.equal(seen.url, 'https://example.test/db/api/control/runs');
  assert.equal(seen.init.headers.authorization, 'Bearer kppd_abc');
  assert.equal(JSON.parse(seen.init.body).node, 'pc1');
  assert.match(await pushRunToControl({}, { file, fetchFn: async () => ({ ok: false, status: 401 }) }), /ответ 401/);
  assert.match(await pushRunToControl({}, { file, fetchFn: async () => { throw new Error('fetch failed'); } }), /fetch failed/);
});

// T23: все lifecycle проверки используют только fake Docker и временную папку.
import { RELAY_COMMAND, assertRun, assertOwned, captureCreated, dockerInventory, newStandRun, ownerLabels, stopOwned } from './night-owner.mjs';
import { createNightStand } from './night-stand.mjs';

const emptyInventory = () => ({ containers: [], volumes: [], networks: [] });
function ownedSnapshot(run, { running = true, id = 'a'.repeat(64) } = {}) {
  const labels = ownerLabels(run);
  return {
    volumes: ['mongo-data', 'secrets', 'mongo-config'].map((name) => ({ name: `${run.project}_${name}`, labels })),
    networks: [{ name: `${run.project}_default`, labels, internal: true }, { name: `${run.project}_access`, labels, internal: false }],
    containers: [{ id, name: `${run.project}-mongo`, service: 'mongo', labels, running, ports: {}, mounts: [{ type: 'volume', name: `${run.project}_mongo-data`, destination: '/data/db' }], networks: [`${run.project}_default`] },
      { id: 'c'.repeat(64), name: `${run.project}-proxy`, service: 'proxy', labels, running, ports: { '27017/tcp': [{ HostIp: '127.0.0.1', HostPort: String(run.mongoPort) }], '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(run.apiPort) }] }, command: [RELAY_COMMAND], entrypoint: ['/bin/sh', '-c'], mounts: [], networks: [`${run.project}_default`, `${run.project}_access`] }],
  };
}
function fakeStand(t, { failBoot = false, unknown = false, busyPort = false, composeFailure = false } = {}) {
  const nightDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-owned-'));
  t.after(() => fs.rmSync(nightDir, { recursive: true, force: true }));
  const calls = []; let snapshot = emptyInventory();
  const docker = (args) => {
    calls.push(args);
    if (args[0] === 'compose') {
      const project = args[args.indexOf('-p') + 1];
      const id = project.slice(3, -6);
      snapshot = ownedSnapshot(newStandRun({ id }));
      if (unknown) snapshot.volumes[0].labels = {};
      return { code: composeFailure ? 1 : 0, out: 'fake compose', stdout: '' };
    }
    if (args.join(' ').startsWith('container stop')) snapshot.containers.forEach((c) => { c.running = false; });
    return { code: 0, out: '', stdout: '' };
  };
  const stand = createNightStand({ docker, sh: () => { throw new Error('real shell запрещён'); }, root: nightDir, composeFile: 'fake.yml', nightDir, backupDir: 'unused', inventoryFn: () => structuredClone(snapshot), portFreeFn: async () => !busyPort, healthFn: async () => true, bootFn: async (run, src, ctx, ops) => {
    const result = ops.compose(run, ['up', '-d', 'mongo'], src, { capture: true });
    if (failBoot || result.code) throw new Error('fake boot error');
  } });
  const ctx = { say() {}, log() {} };
  return { stand, calls, ctx, setSnapshot: (s) => { snapshot = s; }, getSnapshot: () => snapshot };
}

test('T23: каждый run уникальный; project и обе DB на -night, legacy/подделка паспорта отвергаются', () => {
  const a = newStandRun(), b = newStandRun();
  assert.notEqual(a.id, b.id);
  for (const field of ['project', 'db', 'testDb']) assert.match(a[field], /-night$/);
  for (const change of [{ project: 'dcnight' }, { db: 'datacore' }, { testDb: 'datacore-test' }, { owner: 'someone' }, { apiPort: 3001 }, { mongoPort: 27018 }, { createdContainers: ['other'] }]) assert.throws(() => assertRun({ ...a, ...change }), (e) => e.code === 2);
});

test('T23: чужой container/DB/volume/network/mount и неизвестный ID — fail-closed', () => {
  const run = newStandRun(); const good = ownedSnapshot(run); captureCreated(run, good);
  assertOwned(run, good);
  const corruptions = [
    (s) => { s.containers[0].name = 'dcnight-mongo'; },
    (s) => { s.containers[0].labels = {}; },
    (s) => { s.containers[1].ports['27017/tcp'][0].HostIp = '0.0.0.0'; },
    (s) => { s.containers[1].command = ['socat TCP-LISTEN:27017 TCP:production:27017']; },
    (s) => { s.containers[0].networks.push(`${run.project}_access`); },
    (s) => { s.containers[0].ports = { '27017/tcp': [{ HostIp: '127.0.0.1', HostPort: String(run.mongoPort) }] }; },
    (s) => { s.containers[0].id = 'b'.repeat(64); },
    (s) => { s.volumes[0].labels = {}; },
    (s) => { s.volumes[0].name = 'dcnight_mongo-data'; },
    (s) => { s.networks[0].name = 'data-core_default'; },
    (s) => { s.networks[0].internal = false; },
    (s) => { s.containers[0].mounts[0].name = 'old-volume'; },
    (s) => { s.containers[0].mounts[0] = { type: 'bind', destination: '/data/db' }; },
    (s) => { s.containers[0].service = 'backend'; s.containers[0].name = `${run.project}-backend`; s.containers[0].db = 'datacore'; },
  ];
  for (const corrupt of corruptions) { const s = structuredClone(good); corrupt(s); let touched = false; assert.throws(() => stopOwned(run, s, () => { touched = true; }), (e) => e.code === 2); assert.equal(touched, false); }
  assert.throws(() => assertOwned(run, good, { fresh: true }), /уже существует/);
});

test('T23: stop сохраняет ресурсы и использует только immutable IDs созданных контейнеров', () => {
  const run = newStandRun(); const snapshot = ownedSnapshot(run); captureCreated(run, snapshot);
  const before = structuredClone(snapshot); const calls = [];
  stopOwned(run, snapshot, (args) => { calls.push(args); return { code: 0 }; });
  assert.deepEqual(calls, [['container', 'stop', 'a'.repeat(64), 'c'.repeat(64)]]);
  assert.deepEqual(snapshot, before);
});

test('T23: новый up, read-only status, stop и повторный start без восстановления данных', async (t) => {
  const f = fakeStand(t);
  assert.equal(await f.stand.up(f.ctx), 0);
  const run = f.stand.current(); assert.ok(run.initialized); assert.equal(run.createdContainers.length, 2);
  const before = f.calls.length; assert.equal(await f.stand.status(f.ctx), 0); assert.equal(f.calls.length, before);
  assert.equal(f.stand.down(f.ctx), 0);
  assert.equal(f.getSnapshot().volumes.length, 3);
  assert.equal(await f.stand.up(f.ctx), 0);
  assert.ok(f.calls.at(-1).includes('start'));
  assert.equal(f.calls.filter((args) => args.includes('up')).length, 1);
});

test('T23: занятый порт и существующий project не меняются; down без паспорта отказывается', async (t) => {
  const f = fakeStand(t, { busyPort: true });
  await assert.rejects(f.stand.up(f.ctx), /порт .* занят/); assert.deepEqual(f.calls, []);
  assert.throws(() => f.stand.down(f.ctx), /нет паспорта/); assert.deepEqual(f.calls, []);
  const run = newStandRun(); f.setSnapshot(ownedSnapshot(run));
  await assert.rejects(f.stand.up(f.ctx, 'fake', run), /project уже существует/); assert.deepEqual(f.calls, []);
});

test('T23: исключение и неуспешный compose up очищают только свои созданные containers, volumes остаются', async (t) => {
  for (const options of [{ failBoot: true }, { composeFailure: true }]) {
    const f = fakeStand(t, options); const run = newStandRun();
    await assert.rejects(f.stand.up(f.ctx, 'fake', run), /fake boot error/);
    assert.ok(f.calls.at(-1).join(' ').startsWith('container stop'));
    assert.equal(f.getSnapshot().volumes.length, 3);
    assert.equal(f.getSnapshot().containers[0].running, false);
  }
});

test('T23: неизвестный ownership после partial up — cleanup НЕ останавливает ресурс', async (t) => {
  const f = fakeStand(t, { unknown: true }); const run = newStandRun();
  await assert.rejects(f.stand.up(f.ctx, 'fake', run), /volume/);
  assert.equal(f.calls.length, 1); assert.equal(f.getSnapshot().containers[0].running, true);
});

test('T23: Docker inventory отбирает project, не читает чужие ENV и при сбое отказывается', () => {
  const run = newStandRun(); const calls = [];
  const docker = (args) => { calls.push(args); return { code: 0, stdout: args[0] === 'container' ? JSON.stringify({ ID: 'legacy', Names: 'dcnight-mongo', Labels: 'com.docker.compose.project=dcnight' }) : '', out: '' }; };
  assert.deepEqual(dockerInventory(run, docker), emptyInventory());
  assert.equal(calls.some((args) => args.includes('inspect')), false);
  assert.throws(() => dockerInventory(run, () => ({ code: 1, out: 'fake Docker unavailable' })), /fake Docker unavailable/);
});

test('T23: lifecycle не содержит удаления томов/коллекций, полной ночи не нужен legacy и live upload', () => {
  const lifecycle = ['night.mjs', 'night-stand.mjs', 'night-owner.mjs'].map((f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  for (const bad of [/['"]down['"]\s*,\s*['"]-v/, /volume['"]?\s*,\s*['"]rm/, /mongorestore[^\n]*--drop/, /dropDatabase\s*\(/, /deleteMany\s*\(/]) assert.doesNotMatch(lifecycle, bad);
  const source = fs.readFileSync(new URL('night.mjs', import.meta.url), 'utf8');
  assert.match(source, /run = newStandRun/); assert.match(source, /standDown\(sctx, run\)/);
  assert.doesNotMatch(source.slice(source.indexOf('export async function cmdNight')), /pushRunToControl\(/);
  const compose = fs.readFileSync(new URL('night/compose.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(compose, /container_name:\s*dcnight|name:\s*dcnight/);
});

test('T23: настоящий boot использует только новую пустую DB, loopback ports и restore без удаления', async (t) => {
  for (const empty of [true, false]) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'night-import-'));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const backups = path.join(base, 'backups'); fs.mkdirSync(backups); fs.writeFileSync(path.join(backups, 'datacore-2026-11-03.tgz'), 'fake archive');
    const run = newStandRun(); let snapshot = emptyInventory(); const calls = [];
    const docker = (args, options = {}) => {
      calls.push({ args, input: options.input, env: options.env });
      if (args[0] === 'compose') {
        assert.equal(args[args.indexOf('-p') + 1], run.project);
        assert.equal(options.env.NIGHT_DB, run.db); assert.equal(options.env.MONGO_URI, undefined);
        assert.equal(options.env.NIGHT_API_PORT, String(run.apiPort));
        snapshot = ownedSnapshot(run);
        if (args.at(-1) === 'proxy') snapshot.containers.push({ id: 'b'.repeat(64), name: `${run.project}-backend`, service: 'backend', labels: ownerLabels(run), running: true, db: run.db, uriTarget: `mongo:27017/${run.db}`, ports: {}, mounts: [], networks: [`${run.project}_default`] });
      }
      const text = args[0] === 'logs' ? 'init process complete' : options.input?.includes('JSON.stringify({username') ? '{"username":"restored-admin","collections":141}' : options.input?.includes('getCollectionNames') ? String(empty) : options.input?.includes('isMaster') ? 'true' : args.includes('-e') && args.includes('node') ? '$2b$10$' + 'x'.repeat(53) : '';
      if (args[0] === 'container') snapshot.containers.forEach((c) => { c.running = false; });
      return { code: 0, out: text, stdout: text };
    };
    const stand = createNightStand({ docker, sh: (cmd, args, options) => { assert.equal(cmd, 'tar'); fs.mkdirSync(path.join(options.cwd, 'fake-dump', 'datacore'), { recursive: true }); return { code: 0, out: '', stdout: '' }; }, root: base, nightDir: base, composeFile: 'fake.yml', backupDir: backups, inventoryFn: () => structuredClone(snapshot), portFreeFn: async () => true, healthFn: async () => true, sleepFn: async () => {} });
    const ctx = { say() {}, log() {} };
    if (empty) assert.equal(await stand.up(ctx, base, run), 0);
    else await assert.rejects(stand.up(ctx, base, run), /БД не пуста/);
    const restore = calls.find((c) => c.args.some((arg) => arg.includes('mongorestore')));
    if (empty) { assert.ok(restore); assert.ok(restore.args.includes(`${run.project}-mongo`)); assert.match(restore.args.at(-1), new RegExp('--db ' + run.db)); assert.doesNotMatch(restore.args.at(-1), /--drop/); }
    else { assert.equal(restore, undefined); assert.equal(snapshot.containers[0].running, false); }
    assert.equal(snapshot.volumes.length, 3);
    assert.ok(calls.every((c) => !c.args.some((a) => /^dcnight-|datacore-mongo|https?:\/\//.test(a))));
  }
});

import { allSteps, runAll } from './run-all.mjs';
test('run-all: явные файлы тестов, без повторного backend Jest и без live/Docker/E2E команд', () => {
  const steps = allSteps();
  assert.equal(steps.length, 2); assert.deepEqual(steps[0].args, ['tools/dc.mjs', 'check']);
  assert.ok(steps[1].args.includes('pult/test/process.test.mjs'));
  assert.ok(steps.every((s) => !s.args.some((a) => /\*|status|docker|e2e|https?:/.test(a))));
});
test('run-all: fake runner; пути с пробелами без shell, полный журнал и честный код сбоя', (t) => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'all run-')); t.after(() => fs.rmSync(logDir, { recursive: true, force: true }));
  const steps = [{ name: 'fake', args: ['fake script.mjs'] }];
  const result = runAll({ logDir, steps, runFn: (file, args, options) => { assert.equal(options.shell, false); assert.deepEqual(args, ['fake script.mjs']); return { status: 0, stdout: 'ok\nADMIN_PASSWORD=fake' }; } });
  assert.equal(result.code, 0); assert.match(fs.readFileSync(result.logFile, 'utf8'), /ADMIN_PASSWORD=\*\*\*/);
  const failed = runAll({ logDir, steps, runFn: () => ({ status: null, error: new Error('fake ENOENT') }) });
  assert.equal(failed.code, 2); assert.match(fs.readFileSync(failed.logFile, 'utf8'), /fake ENOENT/);
});
