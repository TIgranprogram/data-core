// node --test backend/pwa/core/write-retry.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { WRITE_LIMIT, isBackgroundPath, newKey, waitable, withWriteRetry, writeDelay } from './write-retry.js';

const down = () => Object.assign(new Error('x'), { status: 0 });
const ro = () => Object.assign(new Error('x'), { status: 503, readOnly: true });
const clock = () => { let t = 0; return { now: () => t, sleep: async (ms) => { t += ms; } }; };

test('паузы 3, 5, 10, 15, 30 и дальше по 30 с', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(writeDelay), [3000, 5000, 10000, 15000, 30000, 30000, 30000]);
});

test('ключ случайный и непустой', () => {
  assert.notEqual(newKey(), newKey());
  assert.ok(newKey().length >= 16);
});

test('ждём: READ_ONLY, нет связи, шлюз; не ждём: 400, 403, таймаут', () => {
  assert.ok(waitable(ro()) && waitable(down()) && waitable({ status: 502 }));
  assert.ok(!waitable({ status: 400 }) && !waitable({ status: 403 }) && !waitable({ status: 0, timeout: true }) && !waitable(null));
});

test('фоновые пути не ждут', () => {
  assert.ok(isBackgroundPath('/auth/refresh') && isBackgroundPath('/prefs/ui') && isBackgroundPath('/me/counters'));
  assert.ok(!isBackgroundPath('/supply/requests') && !isBackgroundPath('/incomes/1/payments'));
});

test('пауза записи прошла: запрос повторён, тот же вызов, полоса включена и выключена', async () => {
  const c = clock(), ev = [], calls = [];
  const out = await withWriteRetry(async (i) => { calls.push(i); if (i < 2) throw ro(); return 'ok'; }, { ...c, onStart: () => ev.push('start'), onEnd: (ok) => ev.push(ok) });
  assert.equal(out, 'ok');
  assert.deepEqual(calls, [0, 1, 2]);
  assert.deepEqual(ev, ['start', true]);
  assert.equal(c.now(), 8000);
});

test('без ошибок полоса не показывается', async () => {
  const ev = [];
  await withWriteRetry(async () => 1, { ...clock(), onStart: () => ev.push('start'), onEnd: () => ev.push('end') });
  assert.deepEqual(ev, []);
});

test('3 минуты вышли: бросаем исходную ошибку, полоса снята с неудачей', async () => {
  const c = clock(), ev = [], err = down();
  await assert.rejects(withWriteRetry(async () => { throw err; }, { ...c, onStart: () => ev.push('start'), onEnd: (ok) => ev.push(ok) }), (e) => e === err);
  assert.equal(c.now(), WRITE_LIMIT);
  assert.deepEqual(ev, ['start', false]);
});

test('обычная ошибка (400) — сразу, без ожидания', async () => {
  const c = clock(), err = Object.assign(new Error('bad'), { status: 400 });
  await assert.rejects(withWriteRetry(async () => { throw err; }, c), (e) => e === err);
  assert.equal(c.now(), 0);
});

test('ошибка после ожидания (400) — полоса снята без «восстановлено»', async () => {
  const ev = [];
  await assert.rejects(withWriteRetry(async (i) => { throw i === 0 ? down() : Object.assign(new Error('bad'), { status: 400 }); }, { ...clock(), onStart: () => ev.push('s'), onEnd: (ok) => ev.push(ok) }));
  assert.deepEqual(ev, ['s', false]);
});
