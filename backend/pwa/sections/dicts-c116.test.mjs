import test from 'node:test';
import assert from 'node:assert/strict';
import { dictSearchTokens, dictHaystack, menuGroups } from './dicts-search.js';
const matches = (q, row) => dictSearchTokens(q).every((word) => dictHaystack(row).includes(word));
test('поиск по коду, описанию, словам и регистру', () => {
  const row = { name: 'Сталь оцинкованная', code: 'GALV_HOT', description: 'Длинное описание' };
  assert.equal(matches('  GALV_HOT  ', row), true);
  assert.equal(matches('ОПИСАНИЕ сталь', row), true);
  assert.equal(matches('оцинк', row), true);
  assert.equal(matches('сталь отсутствует', row), false);
});
test('группы меню упорядочены и объединяют исходные разделы', () => {
  const groups = menuGroups([{group:'Паспорта',items:[{key:'p'}]}, {group:'Склад и позиции',items:[{key:'a'}]}, {group:'Склад и позиции',items:[{key:'b'}]}]);
  assert.deepEqual(groups.map(x=>x.name), ['Склад и продукция','Документы (паспорта)']);
  assert.deepEqual(groups[0].items.map(x=>x.key), ['a','b']);
});

test('каркас находится по имени элемента и тексту осмотра', () => {
  const rows = [
    { name: 'Каркас', inspect: 'Крепления' },
    { name: 'Кровля (крыша)', inspect: 'Проверить каркас' },
    { name: 'Площадка', inspect: 'Каркас и соединения' },
  ];
  assert.deepEqual(rows.filter((row) => matches('каркас', row)).map((row) => row.name), ['Каркас', 'Кровля (крыша)', 'Площадка']);
});
