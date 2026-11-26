import assert from 'node:assert/strict';
import test from 'node:test';
import { workerHistory, workerOperationGroups } from './stock-worker-history.js';
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('пять соседних корректировок объединяются одной группой без изменения количества/порядка', () => {
  const items = Array.from({ length: 5 }, (_, n) => ({ kind: 'movement', type: 'adjust', qty: 50 - n, date: new Date(10000 - n * 1000).toISOString() }));
  const groups = workerOperationGroups(items);
  assert.equal(groups.length, 1); assert.deepEqual(groups[0].items, items);
});
test('смешанные типы группируются только соседями, исходная хронология сохраняется', () => {
  const items = ['adjust', 'adjust', 'out', 'adjust', 'in'].map((type, n) => ({ type, qty: n, date: 5000 - n * 1000 }));
  const groups = workerOperationGroups(items);
  assert.deepEqual(groups.map(group => group.type), ['adjust', 'out', 'adjust', 'in']);
  assert.deepEqual(groups.flatMap(group => group.items), items);
});

test('история не загружается при создании; очередь не превышает2 и кэш повторно используется', async () => {
  const running = new Map(), calls = [];
  const cache = workerHistory(id => { calls.push(id); return new Promise(resolve => running.set(id, resolve)); });
  assert.equal(calls.length, 0);
  const a = cache.get('a'), same = cache.get('a'), b = cache.get('b'), c = cache.get('c');
  assert.equal(a, same); await settle(); assert.deepEqual(calls, ['a', 'b']);
  running.get('a')({ items: [] }); await a; await settle(); assert.deepEqual(calls, ['a', 'b', 'c']);
  running.get('b')({ items: [] }); running.get('c')({ items: [] }); await Promise.all([b, c]);
  await cache.get('a'); assert.equal(calls.length, 3);
});
test('инвалидация после записи и явный повтор ошибки касаются только выбранного ID', async () => {
  const calls = [], cache = workerHistory(async id => { calls.push(id); if (id === 'error' && calls.filter(x => x === id).length === 1) throw new Error('сбой'); return { items: [] }; });
  await cache.get('a'); await cache.get('b'); cache.invalidate('a'); await cache.get('a'); await cache.get('b');
  assert.deepEqual(calls, ['a', 'b', 'a']);
  await assert.rejects(cache.get('error')); await assert.rejects(cache.get('error')); assert.equal(calls.filter(x => x === 'error').length, 1);
  await cache.get('error', true); assert.equal(calls.filter(x => x === 'error').length, 2);
});
test('destroy не запускает оставшуюся очередь и не начинает даже запланированный микрозадачей GET', async () => {
  const calls = [], complete = [];
  const cache = workerHistory(id => { calls.push(id); return new Promise(resolve => complete.push(resolve)); });
  const a = cache.get('a'), b = cache.get('b'), c = cache.get('c'); const rejected = assert.rejects(c);
  await settle(); cache.destroy(); await rejected;
  complete.forEach(resolve => resolve({ items: [] })); await Promise.all([a, b]); await settle();
  assert.deepEqual(calls, ['a', 'b']); await assert.rejects(cache.get('d'));
  const early = workerHistory(async () => { calls.push('never'); }); const pending = early.get('x'); const cancelled = assert.rejects(pending); early.destroy(); await cancelled;
  assert.ok(!calls.includes('never'));
});
