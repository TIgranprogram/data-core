import test from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS } from './help-guide-data.js';
import { RELATIONS, relationView } from './help-relations-data.js';

test('карта не теряет разделы общего путеводителя и не ссылается на выдуманные сущности', () => {
  assert.deepEqual(relationView('products').ids, Object.keys(SECTIONS));
  for (const [from, to, label] of RELATIONS) { assert.ok(SECTIONS[from]); assert.ok(SECTIONS[to]); assert.ok(label); }
});
test('ограниченная роль не получает скрытые связи или скрытый выбранный раздел', () => {
  const view = relationView('products', (id) => ['stock', 'movements'].includes(id));
  assert.equal(view.selected, 'stock');
  assert.deepEqual(view.incoming, []);
  assert.deepEqual(view.outgoing, [['stock', 'movements', 'история операций']]);
});
test('паспорт показывает оба источника: изделие и заказ, отдельно общие правила', () => {
  assert.deepEqual(relationView('docs').incoming.map(([id]) => id).sort(), ['dicts', 'products', 'salesorders']);
});
