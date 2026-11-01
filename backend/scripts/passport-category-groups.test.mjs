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

test('изделие: по названию, затем по группе, затем по заданной категории; иначе не определено', () => {
  const cats = [{ _id: 'root', name: 'Спортивное оборудование', type: 'product' }, grp('g1', 'Спорт оборудование'), grp('g2', 'Качели'), grp('g3', 'Разное', { passportCategory: 'BLG' }), grp('g4', 'Разное 2')];
  const prods = [prod('p1', 'g1', 'Турник 1'), prod('p2', 'g2', 'Модель А'), prod('p3', 'g3', 'Штука'), prod('p4', 'g4', 'Штука 2'), prod('p5', 'g2', 'Урна')];
  const p = buildPlan(cats, prods);
  assert.deepEqual(p.products.map((x) => [x.id, x.code]), [['p1', 'WRK'], ['p2', 'DIO'], ['p3', 'BLG'], ['p5', 'BLG']]);
  assert.deepEqual(p.unresolved.map((x) => [x.id, x.group]), [['p4', 'Разное 2']]);
});

test('заданная категория изделия не трогается; повторный запуск — нечего менять', () => {
  const cats = [grp('g1', 'Урны')];
  const prods = [prod('p1', 'g1', 'Урна', { passportDefaults: { passportCategory: 'DIO' } })];
  const p = buildPlan(cats, prods);
  assert.equal(p.alreadySet, 1);
  assert.equal(p.products.length, 0);
  assert.equal(p.unresolved.length, 0);
});
