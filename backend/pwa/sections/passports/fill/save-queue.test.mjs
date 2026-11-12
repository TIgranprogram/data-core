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
