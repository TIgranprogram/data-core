// План категорий групп каталога: node --test backend/scripts/passport-category-groups.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { buildPlan, codeByName } = createRequire(import.meta.url)('./passport-category-groups.js');

const grp = (id, name, extra = {}) => ({ _id: id, name, type: 'product', parentId: 'root', ...extra });
const prod = (id, categoryId, name, extra = {}) => ({ _id: id, categoryId, name, ...extra });

test('правила по названию группы', () => {
  assert.equal(codeByName('Тренажеры'), 'TRN');
  assert.equal(codeByName('Детское спортивное оборудование'), 'DSP');
  assert.equal(codeByName('Горки'), 'DIO');
  assert.equal(codeByName('Скамьи'), 'BLG');
  assert.equal(codeByName('Столы'), 'BLG');
  assert.equal(codeByName('Военизированная полоса препятствий'), 'WRK');
  assert.equal(codeByName('Спорт оборудование'), null);
});

test('группа без совпадения — по большинству изделий; без большинства — не определено', () => {
  const cats = [{ _id: 'root', name: 'Спортивное оборудование', type: 'product' }, grp('g1', 'Спорт оборудование'), grp('g2', 'Разное')];
  const prods = [prod('p1', 'g1', 'Турник 1'), prod('p2', 'g1', 'Брусья'), prod('p3', 'g1', 'Рукоход'), prod('p4', 'g2', 'Турник'), prod('p5', 'g2', 'Урна')];
  const p = buildPlan(cats, prods);
  assert.deepEqual(p.groups.map((g) => [g.id, g.code]), [['g1', 'WRK']]);
  assert.deepEqual(p.unresolved.map((g) => g.id), ['g2']);
});

test('заданная категория не трогается; считаются наследующие изделия; корни не группы', () => {
  const cats = [{ _id: 'root', name: 'Благоустройство', type: 'product' }, grp('g1', 'Урны', { passportCategory: 'BLG' }), grp('g2', 'Качели')];
  const prods = [prod('p1', 'g1', 'Урна'), prod('p2', 'g2', 'Качели'), prod('p3', 'g2', 'Качели 2', { passportDefaults: { passportCategory: 'DIO' } })];
  const p = buildPlan(cats, prods);
  assert.equal(p.totalGroups, 2);
  assert.equal(p.alreadySet, 1);
  assert.deepEqual(p.groups.map((g) => g.code), ['DIO']);
  assert.equal(p.productsInherit, 2);
});

test('повторный запуск: нечего менять', () => {
  const p = buildPlan([grp('g1', 'Урны', { passportCategory: 'BLG' })], []);
  assert.equal(p.groups.length, 0);
  assert.equal(p.unresolved.length, 0);
});
