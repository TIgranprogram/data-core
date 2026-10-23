// Объединение разделов «Продукции» (Т-11): node --test backend/scripts/category-merge-plan.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { mergePlan } = createRequire(import.meta.url)('./category-merge-plan.js');

const cats = [
  { _id: 'maf', name: 'МАФ', parentId: null }, { _id: 'blg', name: 'Благоустройство', parentId: null },
  { _id: 'maf-urns', name: 'Урны', parentId: 'maf' }, { _id: 'maf-benches', name: 'Скамьи', parentId: 'maf' },
  { _id: 'blg-benches', name: 'скамьи', parentId: 'blg' }, { _id: 'old', name: 'МАФ', parentId: null, deletedAt: new Date() },
];
const products = [
  { _id: 'p1', categoryId: 'maf' }, { _id: 'p2', categoryId: 'maf-urns' }, { _id: 'p3', categoryId: 'maf-benches' },
  { _id: 'p4', categoryId: 'blg' }, { _id: 'p5', categoryId: 'maf', deletedAt: new Date() },
];

test('изделия раздела → в целевой; группа без пары → под целевой; группа-дубль → изделия в пару, сама в корзину; раздел — в корзину', () => {
  const { ops, error } = mergePlan({ cats, products, from: 'МАФ', into: 'Благоустройство' });
  assert.equal(error, undefined);
  const by = (coll, id) => ops.filter((o) => o.coll === coll && o.id === id).map((o) => o.set);
  assert.deepEqual(by('products', 'p1'), [{ categoryId: 'blg' }]);
  assert.deepEqual(by('categories', 'maf-urns'), [{ parentId: 'blg' }]);
  assert.deepEqual(by('products', 'p2'), []); // остаётся в своей группе, группа переезжает
  assert.deepEqual(by('products', 'p3'), [{ categoryId: 'blg-benches' }]);
  assert.deepEqual(by('categories', 'maf-benches'), [{ deletedAt: 'NOW', mergedInto: 'blg-benches' }]);
  assert.deepEqual(by('categories', 'maf'), [{ deletedAt: 'NOW', mergedInto: 'blg' }]);
  assert.deepEqual(by('products', 'p4'), []);
  assert.deepEqual(by('products', 'p5'), []); // удалённые изделия не трогаем
  assert.equal(ops.some((o) => o.id === 'old'), false); // раздел в корзине — не источник
});

test('нет раздела или их несколько — ничего не делаем, объясняем', () => {
  assert.match(mergePlan({ cats, products, from: 'Нет такого', into: 'Благоустройство' }).error, /не найден/);
  const two = [...cats, { _id: 'blg2', name: 'Благоустройство', parentId: null }];
  assert.match(mergePlan({ cats: two, products, from: 'МАФ', into: 'Благоустройство' }).error, /несколько/);
});
