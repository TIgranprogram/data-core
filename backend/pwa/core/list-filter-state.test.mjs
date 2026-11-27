import test from 'node:test';
import assert from 'node:assert/strict';
import { listFilterState } from './list-filter-state.js';
import { listQuery } from '../ui/kit/list-view.js';

test('статус прямого входа действует в таблице, но не учитывается и не сбрасывается на доске', async () => {
  const L = { filters: [{ key: 'status', type: 'chips' }, { key: 'supplier' }] };
  const params = { status: 'requested' };
  const board = listFilterState(L, params, { board: true });
  assert.equal(board.count, 0);
  assert.ok(!Object.hasOwn(board.clear, 'status'));
  assert.equal((await listQuery(L, params, L.filters, true)).status, undefined);
  assert.equal(listFilterState(L, params, {}).count, 1);
  assert.equal((await listQuery(L, params, L.filters)).status, 'requested');
  assert.equal(listFilterState(L, { ...params, supplier: 'a' }, { board: true }).count, 1);
});

test('сброс выбранного по умолчанию статуса оставляет «Все», поиск и страницу очищает', () => {
  const L = { filters: [{ key: 'status', type: 'chips', defaultValue: 'active' }, { key: 'supplier' }] };
  const first = listFilterState(L, { q: 'труба', page: '3', supplier: 'a' }, {});
  assert.equal(first.count, 2);
  const after = { q: 'труба', page: '3', supplier: 'a' };
  for (const [key, value] of Object.entries(first.clear)) { if (value === undefined) delete after[key]; else after[key] = value; }
  assert.deepEqual(after, { status: 'all' });
  assert.equal(listFilterState(L, after, {}).count, 0);
});

test('составное значение трубы с внутренними разделителями считается одним признаком', () => {
  const L = { extraKeys: ['ft', 'all'] };
  assert.equal(listFilterState(L, { all: '1', ft: 'pipe:rect|20х20|6000' }, {}).count, 1);
  assert.equal(listFilterState(L, { ft: 'wash:Мытая|pipe:rect|20х20|6000' }, {}).count, 2);
});

test('сброс фильтров галереи сохраняет её текущую категорию, но очищает обычный отбор', () => {
  const L = { extraKeys: ['categoryId', 'ft'], gallery: { pathKeys: ['categoryId'] } };
  const state = listFilterState(L, { categoryId: 'c', ft: 'wash:Мытая' }, { gallery: true });
  assert.equal(state.count, 1);
  assert.ok(!Object.hasOwn(state.clear, 'categoryId'));
  assert.ok(Object.hasOwn(state.clear, 'ft'));
});

test('диаграмма не считает и не сбрасывает статус обычного списка', () => {
  const state = listFilterState({ filters: [{ key: 'status', type: 'chips' }, { key: 'customer' }] }, { status: 'reserved', customer: 'c' }, { gantt: true });
  assert.equal(state.count, 1);
  assert.ok(!Object.hasOwn(state.clear, 'status'));
});
