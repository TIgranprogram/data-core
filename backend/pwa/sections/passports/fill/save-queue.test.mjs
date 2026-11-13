import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { saveQueue } = await import('data:text/javascript;base64,' + Buffer.from(readFileSync(new URL('./save-queue.js', import.meta.url), 'utf8')).toString('base64'));

test('после ошибки соседняя запись не уничтожает ввод; повтор выполняет прежнюю очередь', async () => {
  const queue = saveQueue(); let fail = true; const written = [];
  const first = queue.add(async () => { if (fail) { fail = false; throw new Error('PATCH'); } written.push('размер'); });
  const second = queue.add(async () => { written.push('вес'); });
  await assert.rejects(first, /PATCH/); assert.equal(await second, false);
  assert.equal(queue.failed(), true); assert.deepEqual(written, []);
  await queue.retry(); assert.deepEqual(written, ['размер', 'вес']); assert.equal(queue.failed(), false);
});

test('повторный сбой сохраняет очередь до следующего повтора', async () => {
  const queue = saveQueue(); let count = 0;
  await assert.rejects(queue.add(async () => { if (++count < 3) throw new Error('PATCH'); }));
  await assert.rejects(queue.retry()); assert.equal(queue.failed(), true);
  await queue.retry(); assert.equal(queue.failed(), false); assert.equal(count, 3);
});

test('явная отмена не запускает неуспешные записи', async () => {
  const queue = saveQueue(); let count = 0;
  await assert.rejects(queue.add(async () => { count++; throw new Error('PATCH'); }));
  await queue.discard(); assert.equal(queue.failed(), false); assert.equal(count, 1);
  await queue.add(async () => { count++; }); assert.equal(count, 2);
});

test('два повтора используют одну попытку и ждут запись', async () => {
  const queue = saveQueue(); let count = 0; let release;
  await assert.rejects(queue.add(async () => { if (++count === 1) throw new Error('PATCH'); await new Promise((resolve) => { release = resolve; }); }));
  const first = queue.retry(); const second = queue.retry();
  assert.equal(first, second);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(count, 2); assert.equal(queue.pending.size, 1);
  release(); await Promise.all([first, second]);
  assert.equal(queue.pending.size, 0); assert.equal(queue.failed(), false);
});

test('Р2: сервер на паузе — очередь сама повторяет после retryAfter, ввод не теряется', async () => {
  const timers = []; const waits = []; let resumed = 0;
  const queue = saveQueue({ auto: {
    delayOf: (e) => (e.readOnly ? (e.retryAfter || 30) * 1000 : 0), max: 5,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
    onWait: (ms) => waits.push(ms), onResume: () => { resumed++; },
  } });
  let calls = 0; const written = [];
  const paused = () => Object.assign(new Error('503'), { readOnly: true, status: 503, retryAfter: 30 });
  await assert.rejects(queue.add(async () => { if (++calls === 1) throw paused(); written.push('вес'); }));
  assert.equal(queue.failed(), true); assert.equal(queue.waiting(), true);
  assert.deepEqual(waits, [30000]); assert.equal(timers[0].ms, 30000);
  assert.equal(await queue.add(async () => { written.push('рост'); }), false); // соседняя правка ждёт, не теряется
  timers[0].fn(); await new Promise((r) => setTimeout(r, 0)); await queue.pending.size && Promise.all([...queue.pending]);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(written, ['вес', 'рост']); assert.equal(queue.failed(), false); assert.equal(resumed, 1);
});

test('Р2: обычная ошибка (400) автоповтор не запускает; повторы ограничены max', async () => {
  const timers = [];
  const queue = saveQueue({ auto: { delayOf: (e) => (e.readOnly ? 1000 : 0), max: 2, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} } });
  await assert.rejects(queue.add(async () => { throw Object.assign(new Error('bad'), { status: 400 }); }));
  assert.equal(timers.length, 0); assert.equal(queue.waiting(), false);
  await queue.discard();
  const ro = () => Object.assign(new Error('503'), { readOnly: true });
  await assert.rejects(queue.add(async () => { throw ro(); }));
  for (let i = 0; i < 4; i++) { const t = timers.shift(); if (t) { t.fn(); await new Promise((r) => setTimeout(r, 5)); } }
  assert.equal(queue.waiting(), false); assert.equal(queue.failed(), true); // после max попыток — ждёт ручного повтора
});
