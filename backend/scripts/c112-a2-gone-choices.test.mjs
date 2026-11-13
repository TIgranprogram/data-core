import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { buildPlan } = createRequire(import.meta.url)('./c112-a2-gone-choices.js');

const root = { _id: 'r1', section: 'purpose', parentId: null, name: 'Назначение' };
const L = (id, name, extra = {}) => ({ _id: id, section: 'purpose', parentId: 'r1', name, allCategories: true, ...extra });
const prod = (id, from, cat = 'TRN') => ({ _id: id, sku: id, name: id, passportDefaults: { passportCategory: cat, textChoices: { r1: from } } });

test('один действующий аналог по названию — в план; живой вариант не трогаем', () => {
  const nodes = [root, L('old', 'Брусья', { deletedAt: new Date() }), L('new', 'брусья'), L('live', 'Турник')];
  const { plan, manual } = buildPlan(nodes, [prod('p1', 'old'), prod('p2', 'live')]);
  assert.deepEqual(plan.map((r) => [r.id, r.to]), [['p1', 'new']]);
  assert.equal(manual.length, 0);
});
test('несколько, ни одного, стёртый совсем — вручную; категория учитывается', () => {
  const nodes = [root, L('old', 'Брусья', { deletedAt: new Date() }), L('a', 'Брусья'), L('b', 'Брусья'), L('o2', 'Кольца', { deletedAt: new Date() }), L('c', 'Кольца', { allCategories: false, categories: 'WRK' })];
  const { plan, manual } = buildPlan(nodes, [prod('p1', 'old'), prod('p2', 'o2'), prod('p3', 'ghost'), prod('p4', 'o2', 'WRK')]);
  assert.deepEqual(plan.map((r) => r.id), ['p4']);
  assert.deepEqual(manual.map((r) => r.id).sort(), ['p1', 'p2', 'p3']);
});
