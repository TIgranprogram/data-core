import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import migration from './c169-intake-indexes.js';

const { SPECS, ensure } = migration;

function fakeDb({ dirty = '', incompatible = '' } = {}) {
  const indexes = new Map();
  const writes = [];
  if (incompatible) {
    const spec = SPECS.find(index => index.name === incompatible);
    indexes.set(spec.collection, [{ key: { [spec.field]: 1 }, name: spec.name, unique: true, sparse: false }]);
  }
  return {
    writes,
    collection(name) {
      return {
        async indexes() { return indexes.get(name) ?? []; },
        aggregate(pipeline) {
          return { toArray: async () => Object.keys(pipeline[0].$match).includes(dirty) ? [{ count: 2 }] : [] };
        },
        async createIndex(key, options) {
          writes.push({ name, key, options });
          indexes.set(name, [...(indexes.get(name) ?? []), { key, ...options }]);
          return options.name;
        },
      };
    },
  };
}

test('план по умолчанию не меняет индексы', async () => {
  const db = fakeDb();
  assert.deepEqual((await ensure(db)).map(entry => entry.state), SPECS.map(() => 'missing'));
  assert.equal(db.writes.length, 0);
});

test('apply создаёт ровно указанные ключи, повтор проверяет их без записей', async () => {
  const db = fakeDb();
  assert.deepEqual((await ensure(db, true)).map(entry => entry.state), SPECS.map(() => 'created'));
  assert.deepEqual(db.writes.map(write => [write.name, write.options.name, write.options.unique === true, write.options.sparse]), SPECS
    .map(spec => [spec.collection, spec.name, spec.unique, true]));
  assert.deepEqual((await ensure(db, true)).map(entry => entry.state), SPECS.map(() => 'ready'));
  assert.equal(db.writes.length, 5);
});

test('несовместимый индекс и дубли останавливают apply до первого изменения', async () => {
  const mismatch = fakeDb({ incompatible: 'c169_supply_invoice_business' });
  await assert.rejects(ensure(mismatch, true), /несовместимый индекс/);
  assert.equal(mismatch.writes.length, 0);
  const duplicates = fakeDb({ dirty: 'intakeSourceSha256' });
  await assert.rejects(ensure(duplicates, true), /есть дубли или ключи не строкового типа/);
  assert.equal(duplicates.writes.length, 0);
});
