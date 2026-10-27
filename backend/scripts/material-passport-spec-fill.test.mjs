// План первичной связи позиций склада с материалами паспорта (МЦ-4): node --test backend/scripts/material-passport-spec-fill.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { buildPlan, applyPlan } = createRequire(import.meta.url)('./material-passport-spec-fill.js');

// заглушка разбора: «труба» → материал m1 с размером, «краска» → покрытие c1, прочее — не опознано
const match = (lines) => {
  const t = lines[0].text.toLowerCase();
  if (t.includes('труба')) return { rows: [{ materialId: 'm1', sizes: ['∅89×3'], partIds: [] }], coatingIds: [], unmatched: [] };
  if (t.includes('краска')) return { rows: [], coatingIds: ['c1'], unmatched: [] };
  return { rows: [], coatingIds: [], unmatched: [lines[0].name] };
};

test('план: материал, покрытие и не опознанное', () => {
  const p = buildPlan([{ _id: 'a', name: 'Труба 89х3' }, { _id: 'b', name: 'Краска порошковая' }, { _id: 'c', name: 'Болт' }], [], [], match);
  assert.deepEqual(p.items.map((x) => [x.id, x.materialId, x.isCoating]), [['a', 'm1', false], ['b', 'c1', true]]);
  assert.deepEqual(p.unmatched.map((x) => x.id), ['c']);
});

test('запись: фильтр — живая позиция без passportSpec, пишется только passportSpec', async () => {
  const calls = [];
  const db = { collection: () => ({ updateOne: async (f, u) => { calls.push([f, u]); return { modifiedCount: 1 }; } }) };
  class Oid { constructor(v) { this.v = v; } }
  const n = await applyPlan(db, { items: [{ id: 'a', materialId: 'm1', sizes: ['2'], isCoating: false }] }, { ObjectId: Oid });
  assert.equal(n, 1);
  assert.deepEqual(calls[0][0].passportSpec, { $exists: false });
  assert.equal(calls[0][0].deletedAt, null);
  assert.deepEqual(Object.keys(calls[0][1].$set), ['passportSpec']);
});
