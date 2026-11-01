// План значений по категории: node --test backend/scripts/passport-category-defaults.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { buildPlan } = createRequire(import.meta.url)('./passport-category-defaults.js');

const cats = [{ _id: 'root', passportCategory: 'WRK' }, { _id: 'g1', parentId: 'root' }, { _id: 'g2', parentId: 'root', passportCategory: 'BLG' }];

test('категория: своя, иначе группы, иначе родителя; нет категории — пропуск', () => {
  const prods = [{ _id: 'a', categoryId: 'g1' }, { _id: 'b', categoryId: 'g2' }, { _id: 'c', categoryId: 'zzz' }, { _id: 'd', categoryId: 'zzz', passportDefaults: { passportCategory: 'TRN' } }];
  const p = buildPlan(prods, cats);
  assert.deepEqual(p.items.map((i) => [i.id, i.code]), [['a', 'WRK'], ['b', 'BLG'], ['d', 'TRN']]);
  assert.equal(p.noCategory, 1);
});

test('срок службы 10 лет только в пустое; повторный запуск — пусто', () => {
  const prods = [{ _id: 'a', categoryId: 'g1', passportDefaults: { serviceLifeYears: 15 } }, { _id: 'b', categoryId: 'g1', passportDefaults: { serviceLifeYears: 10 } }, { _id: 'c', categoryId: 'g1', passportDefaults: { warrantyMonths: 12 } }];
  const p = buildPlan(prods, cats);
  assert.deepEqual(p.items.map((i) => [i.id, i.set.serviceLifeYears]), [['c', 10]]);
});
