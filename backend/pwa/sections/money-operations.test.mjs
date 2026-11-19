import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const context = vm.createContext({ Intl, Date, Object });
const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
const state = new vm.SourceTextModule(read('./money-operations-state.js'), { context });
await state.link(async () => new vm.SourceTextModule(read('./invoice-workspace-state.js'), { context }));
await state.evaluate(); const { operationsQuery, financialQuery, financialFilterChanges, classificationBody } = state.namespace;
const clean = value => JSON.parse(JSON.stringify(value));
test('C159: одинаковые канонические фильтры, legacy org и собственный sort/page без totals по странице', () => {
  const params = { month: '2026-11', from: '2026-11-01', to: '2026-11-19', type: 'expense', companyId: 'co', org: 'Старое имя', articleId: 'parent', salesOrderId: 'order', source: 'invoice', page: 3, limit: 200, sort: 'amount', dir: 'asc', view: 'operations', of: 'moneyclassification', open: 'id' };
  const query = operationsQuery(params);
  assert.equal(query.page, 3); assert.equal(query.limit, 100); assert.equal(query.includeDescendants, 1);
  assert.equal(query.articleId, 'parent'); assert.equal(query.companyId, 'co'); assert.equal(query.org, undefined);
  assert.equal(query.view, undefined); assert.equal(query.of, undefined); assert.equal(query.open, undefined);
  const { page, limit, includeDescendants, sort, dir, ...common } = clean(query); assert.deepEqual(common, clean(financialQuery(params)));
});
test('C159: период366 включительно, cross-year, реальные даты и направление сортировки', () => {
  assert.doesNotThrow(() => financialQuery({ from: '2025-12-01', to: '2026-11-30' }));
  for (const values of [{ from: '2026-02-30', to: '2026-03-03' }, { from: '2026-11-19', to: '2026-11-01' }, { from: '2025-01-01', to: '2026-01-02' }]) assert.throws(() => financialQuery(values));
  assert.equal(operationsQuery({ from: '2026-11-01', to: '2026-11-19', page: -7, sort: 'arbitrary', dir: 'arbitrary' }).page, 1);
});
test('C159: классификация — только аналитика, null/absence/reset различаются; деньги/дата/компания не уходят', () => {
  const row = { classificationEditable: true, classificationVersion: 4 };
  const values = { reason: 'Исправлена статья', articleId: '', amount: 999, date: '2020-01-01', companyId: 'wrong', paymentId: 'wrong' };
  assert.deepEqual(clean(classificationBody(row, values, 'stable')), { reason: 'Исправлена статья', clientUid: 'stable', version: 4, articleId: null });
  assert.deepEqual(clean(classificationBody(row, { ...values, action: 'reset', articleId: 'must-not-leak' }, 'reset')), { reason: 'Исправлена статья', clientUid: 'reset', version: 4, resetToOriginal: true });
  assert.throws(() => classificationBody(row, { reason: '  ', articleId: 'a' }, 'bad'), error => error.field === 'reason');
  assert.throws(() => classificationBody(row, { reason: 'Причина', costCenter: 'invented' }, 'bad'));
});
test('C159: неподдержанный source остаётся читаемым, но correction не формируется; версия обязательна', () => {
  assert.throws(() => classificationBody({ classificationEditable: false, classificationReason: 'Нужна сверка legacy' }, { reason: 'Причина' }, 'x'), /Нужна сверка legacy/);
  assert.throws(() => classificationBody({ classificationEditable: true }, { reason: 'Причина' }, 'x'), /версия/);
});


test('C159: «Все заказы» снимает canonical и legacy объект, сохраняя период/компанию/статью/прочие фильтры', () => {
  const before = { from: '2026-11-01', to: '2026-11-19', companyId: 'co', articleId: 'article', costCenter: 'smr', source: 'invoice', mode: 'object', order: 'legacy-order', salesOrderId: 'order', page: 3 };
  const changes = financialFilterChanges('salesOrderId', '');
  const after = { ...before, ...changes };
  assert.equal(after.salesOrderId, undefined); assert.equal(after.order, undefined); assert.equal(after.mode, undefined); assert.equal(after.page, undefined);
  for (const key of ['from', 'to', 'companyId', 'articleId', 'costCenter', 'source']) assert.equal(after[key], before[key]);
  assert.equal(financialQuery(after).salesOrderId, undefined);
  assert.equal(financialQuery({ ...after, mode: 'object' }).salesOrderId, undefined);
});
