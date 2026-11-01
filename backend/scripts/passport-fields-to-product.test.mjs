// План переноса полей паспорта в изделие: node --test backend/scripts/passport-fields-to-product.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { buildPlan } = createRequire(import.meta.url)('./passport-fields-to-product.js');

const pass = (productId, issuedAt, extra = {}) => ({ productId, issuedAt, ...extra });

test('переносит габариты, вес и числа в пустые поля; заполненное не трогает', () => {
  const prods = [{ _id: 'a', sku: 'A', name: 'Турник', dimensions: { length: 0, width: 500 }, weightKg: null, passportDefaults: { warrantyMonths: 12, maxUsers: 4 } }];
  const p = buildPlan(prods, [pass('a', '2026-01-01', { length: 2760, width: 999, height: 4850, weight: 176.7, maxUsers: 9, serviceLifeYears: 10, warrantyMonths: 24 })]);
  assert.deepEqual(p.items[0].set, { 'dimensions.length': 2760, 'dimensions.height': 4850, weightKg: 176.7, 'passportDefaults.serviceLifeYears': 10 });
  assert.equal(p.items[0].prev.dimensions.width, 500);
});

test('расходятся паспорта — берётся новейший, расхождение в списке; поле берётся из новейшего, где оно заполнено', () => {
  const prods = [{ _id: 'a', sku: 'A', name: 'Х' }];
  const p = buildPlan(prods, [pass('a', '2026-01-01', { weight: 100, siteLength: 6 }), pass('a', '2026-06-01', { weight: 120 })]);
  assert.equal(p.items[0].set.weightKg, 120);
  assert.equal(p.items[0].set['passportDefaults.siteLength'], 6);
  assert.equal(p.conflicts.length, 1);
  assert.deepEqual(p.conflicts[0].values.sort(), [100, 120]);
});

test('ссылки и списки идут строками; изделия без паспортов и повторный запуск — пусто', () => {
  const prods = [{ _id: 'a', name: 'А' }, { _id: 'b', name: 'Б' }, { _id: 'c', name: 'В', weightKg: 5, passportDefaults: { installationTypeId: 'x', elements: ['e'] } }];
  const ps = [pass('a', '2026-01-01', { installationTypeId: { toString: () => 'iid' }, elements: ['e1', 'e2'], isKit: false }), pass('c', '2026-01-01', { weight: 9, installationTypeId: 'x', elements: ['e'] })];
  const p = buildPlan(prods, ps);
  assert.equal(p.withPassports, 2);
  assert.equal(p.items.length, 1);
  assert.deepEqual(p.items[0].set, { 'passportDefaults.isKit': false, 'passportDefaults.elements': ['e1', 'e2'], 'passportDefaults.installationTypeId': 'iid' });
});
