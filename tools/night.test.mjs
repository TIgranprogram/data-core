// node --test tools/night.test.mjs — защита стенда, замок, разбор итогов. Без Docker.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isNightDb, assertStandSafe, lockState, acquireLock, releaseLock, tailBytes, failSignature, makeStep, summarize, stepLine, parseEnvFile, pickBackup } from './night.mjs';

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
