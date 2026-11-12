import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNightStand, uploadsManifest } from './night-stand.mjs';
import { ownerLabels, assertOwned, newStandRun } from './night-owner.mjs';

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'night-uploads-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = path.join(root, 'legacy'), volume = path.join(root, 'volume');
  fs.mkdirSync(legacy); fs.mkdirSync(volume);
  fs.mkdirSync(path.join(legacy, 'empty')); fs.writeFileSync(path.join(legacy, 'паспорт.pdf'), 'original-pdf');
  let snapshot = { containers: [], volumes: [], networks: [] }, run;
  const state = { calls: [], failCopy: false, corrupt: false };
  const ok = { code: 0, out: '', stdout: '' };
  const docker = args => {
    state.calls.push(args);
    if (args[0] === 'compose') {
      if (!run) {
        run = newStandRun({ id: args[args.indexOf('-p') + 1].slice(3, -6) });
        const labels = ownerLabels(run);
        snapshot = { volumes: ['mongo-data', 'mongo-config', 'secrets'].map(n => ({ name: `${run.project}_${n}`, labels })), networks: [{ name: `${run.project}_default`, internal: true, labels }], containers: [{ id: 'a'.repeat(64), name: `${run.project}-backend`, service: 'backend', running: true, labels, db: run.db, uriTarget: `mongo:27017/${run.db}`, ports: {}, mounts: [], networks: [`${run.project}_default`] }] };
      } else if (args.includes('--no-start')) {
        assert.ok(args.includes('up') && args.includes('--no-deps') && args.includes('--build'));
        assert.equal(args.at(-1), 'backend');
        snapshot.containers[0].id = 'b'.repeat(64); snapshot.containers[0].running = false;
        snapshot.containers[0].mounts = [{ type: 'volume', name: `${run.project}_uploads`, destination: '/app/uploads' }];
        if (!snapshot.volumes.some(v => v.name.endsWith('_uploads'))) snapshot.volumes.push({ name: `${run.project}_uploads`, labels: ownerLabels(run) });
      } else if (args.includes('start') || args.includes('up')) snapshot.containers[0].running = true;
    }
    if (args[0] === 'container' && args[1] === 'stop') snapshot.containers[0].running = false;
    if (args[0] === 'cp') {
      if (state.failCopy) return { code: 1, out: 'copy failed' };
      const fromContainer = args[1].includes(':/app/uploads');
      const source = fromContainer ? args[1].startsWith('a') ? legacy : volume : args[1];
      const target = fromContainer ? args[2] : volume;
      fs.cpSync(source, target, { recursive: true });
      if (state.corrupt && !fromContainer) fs.writeFileSync(path.join(volume, 'паспорт.pdf'), 'bad');
    }
    return ok;
  };
  const ctx = { say() {}, log() {} };
  const stand = createNightStand({ docker, root, nightDir: path.join(root, 'night'), composeFile: 'test.yml', backupDir: root, inventoryFn: () => structuredClone(snapshot), portFreeFn: async () => true, healthFn: async () => true, bootFn: async (r, src, c, ops) => { ops.compose(r, ['up'], src, { capture: true }); } });
  await stand.up(ctx);
  state.calls = [];
  return { stand, ctx, state, legacy, volume, snapshot: () => snapshot };
}

test('legacy 3 volumes → uploads: backup перед create, сверка перед start; повтор не копирует', async t => {
  const f = await fixture(t);
  await f.stand.refresh(f.ctx);
  assert.deepEqual(uploadsManifest(f.volume), uploadsManifest(f.legacy));
  assert.equal(f.snapshot().volumes.length, 4);
  assert.equal(f.stand.current().uploadsMigration.state, 'verified');
  const calls = f.state.calls;
  assert.ok(calls.findIndex(a => a[0] === 'cp') < calls.findIndex(a => a.includes('--no-start')));
  assert.ok(!calls.some(a => a.includes('create')));
  assert.ok(calls.findLastIndex(a => a[0] === 'cp') < calls.findIndex(a => a.includes('start')));
  assert.ok(!calls.some(a => a.includes('rm') || a.includes('down')));
  f.state.calls = []; await f.stand.refresh(f.ctx);
  assert.ok(!f.state.calls.some(a => a[0] === 'cp'));
});
test('ошибка backup запрещает recreate; исходные файлы сохранены', async t => {
  const f = await fixture(t); f.state.failCopy = true;
  await assert.rejects(f.stand.refresh(f.ctx), /резервная копия uploads/);
  assert.ok(!f.state.calls.some(a => a.includes('--no-start')));
  assert.equal(fs.readFileSync(path.join(f.legacy, 'паспорт.pdf'), 'utf8'), 'original-pdf');
});
test('несовпадение после restore запрещает start; повтор восстанавливает из журнала', async t => {
  const f = await fixture(t); f.state.corrupt = true;
  await assert.rejects(f.stand.refresh(f.ctx), /не совпали/);
  assert.equal(f.stand.current().uploadsMigration.state, 'saved');
  assert.ok(!f.state.calls.some(a => a.includes('start')));
  f.state.corrupt = false; f.state.calls = []; await f.stand.refresh(f.ctx);
  assert.equal(f.stand.current().uploadsMigration.state, 'verified');
  assert.deepEqual(uploadsManifest(f.volume), uploadsManifest(f.legacy));
});
test('owner допускает свой uploads, отвергает чужие labels и bind', async t => {
  const f = await fixture(t); await f.stand.refresh(f.ctx);
  const run = f.stand.current(); assertOwned(run, f.snapshot());
  const s = structuredClone(f.snapshot()); s.volumes.at(-1).labels = {};
  assert.throws(() => assertOwned(run, s), /volume/);
  const b = structuredClone(f.snapshot()); b.containers[0].mounts[0].type = 'bind';
  assert.throws(() => assertOwned(run, b), /uploads/);
});
test('compose хранит uploads в отдельном owned volume', () => {
  const compose = fs.readFileSync(new URL('./night/compose.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n'); // checkout с CRLF (autocrlf)
  assert.match(compose, /- uploads:\/app\/uploads/);
  assert.match(compose, /\n  uploads:\n    labels: \*owner/);
});
