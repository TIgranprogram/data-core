import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./invoice-workspace-state.js', import.meta.url), 'utf8');
const state = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const invoice = { status: 'paid', version: 4 };

test('100 / 3 сохраняет точные 100, paid reason по желанию, version включена', () => {
  const draft = state.lineDraft({ qty: 3, priceHint: 100 });
  assert.equal(draft.unitPrice, '33.33');
  assert.deepEqual(state.lineBody(invoice, draft), { qty: 3, lineAmount: 100, version: 4 });
  assert.deepEqual(state.lineBody(invoice, { ...draft, reason: ' Уточнение количества ' }), { qty: 3, lineAmount: 100, reason: 'Уточнение количества', version: 4 });
});
test('точные 101 при qty 3 не превращаются в 101.01', () => {
  const draft = state.changeLine(state.lineDraft({ qty: 3, priceHint: 100 }), 'lineAmount', '101');
  assert.equal(draft.unitPrice, '33.67');
  assert.equal(state.lineBody({ version: 5, status: 'issued' }, draft).lineAmount, 101);
});
test('qty без явно введённой цены сохраняет сумму; явно введённая цена пересчитывает', () => {
  let draft = state.changeLine(state.lineDraft({ qty: 3, priceHint: 100 }), 'qty', '4');
  assert.equal(draft.lineAmount, '100');
  draft = state.changeLine(draft, 'unitPrice', '40');
  assert.equal(draft.lineAmount, '160');
  draft = state.changeLine(draft, 'qty', '5', true);
  assert.equal(draft.lineAmount, '200');
});
test('нулевые/отрицательные/пустые/NaN/неизвестная version запрещены', () => {
  const draft = state.lineDraft({ qty: 3, lineAmount: 100, priceHint: 5 });
  assert.equal(draft.lineAmount, '100');
  for (const qty of ['0', '-1', '', 'NaN']) assert.throws(() => state.lineBody({ status: 'issued', version: 0 }, { ...draft, qty }), /больше нуля/);
  for (const lineAmount of ['-1', '', 'NaN']) assert.throws(() => state.lineBody({ status: 'issued', version: 0 }, { ...draft, lineAmount }), /Сумма/);
  assert.equal(state.lineBody({ status: 'issued' }, draft).version, 0);
  for (const version of ['NaN', -1, 1.5]) assert.throws(() => state.lineBody({ status: 'issued', version }, draft), /версия/);
});
test('старый editLine/modal/openCard полностью удалён из invoices-tab', () => {
  const tab = readFileSync(new URL('./invoices-tab.js', import.meta.url), 'utf8');
  assert.doesNotMatch(tab, /editLine\(|openCard|modal\(|\/lines\//);
});
