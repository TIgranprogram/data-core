import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const missingFirm = () => Object.assign(new Error('Выберите фирму'), { status: 400 });
function load({ firstError, selected = 'firm-b', cancel = false, failRetry = false, onModal = () => {} } = {}) {
  const calls = [], remembered = [], dialogs = [];
  const context = vm.createContext({
    api: async (_path, options) => {
      calls.push(options.body);
      if (calls.length === 1 && firstError) throw firstError;
      if (calls.length > 1 && failRetry) throw new Error('Нет связи');
      return { id: 'draft', supplierOrgId: options.body.supplierOrgId || 'order-firm' };
    },
    ourCompanies: async () => [{ id: 'firm-a', name: 'Фирма А' }, { id: 'firm-b', name: 'Фирма Б' }],
    firmFor: async () => ({ id: 'firm-a', from: 'memory' }),
    rememberFirm: (id) => remembered.push(id),
    field: () => ({}), hint: () => ({}), stack: (...children) => children,
    select: (options) => { assert.equal(options.value, 'firm-a'); return { value: selected }; },
    modal: async (options) => { dialogs.push(options); onModal(); return cancel ? null : options.onOk(); },
  });
  const source = readFileSync(new URL('./create-book-draft.js', import.meta.url), 'utf8')
    .replace(/^import .+;\s*$/gm, '').replace(/export /g, '');
  vm.runInContext(source + '\nglobalThis.create = createBookDraft;', context);
  return { create: context.create, calls, remembered, dialogs };
}

test('известная серверу фирма заказа или единственная не требуют выбора', async () => {
  const t = load();
  const row = await t.create({ productId: 'product', incomeId: 'line' });
  assert.equal(row.supplierOrgId, 'order-firm');
  assert.equal(t.calls.length, 1); assert.equal(t.dialogs.length, 0);
});
test('несколько фирм: подтверждённый выбор идёт в повторный POST с исходным заказом', async () => {
  const t = load({ firstError: missingFirm() });
  await t.create({ productId: 'product', incomeId: 'line', salesOrderId: 'order' });
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[1].supplierOrgId, 'firm-b');
  assert.equal(t.calls[1].incomeId, 'line'); assert.equal(t.calls[1].salesOrderId, 'order');
  assert.deepEqual(t.remembered, ['firm-b']);
});
test('отмена выбора не делает повторный POST и не запоминает фирму', async () => {
  const t = load({ firstError: missingFirm(), cancel: true });
  assert.equal(await t.create({ productId: 'product' }), null);
  assert.equal(t.calls.length, 1); assert.deepEqual(t.remembered, []);
});
test('пустой выбор остаётся ошибкой поля, случайная фирма не подставляется', async () => {
  const t = load({ firstError: missingFirm(), selected: '' });
  await assert.rejects(t.create({ productId: 'product' }), /Выберите фирму/);
  assert.equal(t.calls.length, 1);
});
test('сеть и другие ошибки не превращаются в запрос фирмы', async () => {
  for (const firstError of [new Error('Нет связи'), Object.assign(new Error('Нет прав'), { status: 403 })]) {
    const t = load({ firstError });
    await assert.rejects(t.create({ productId: 'product' }), (e) => e === firstError);
    assert.equal(t.dialogs.length, 0);
  }
});
test('неудачный повторный POST не запоминает фирму', async () => {
  const t = load({ firstError: missingFirm(), failRetry: true });
  await assert.rejects(t.create({ productId: 'product' }), /Нет связи/);
  assert.deepEqual(t.remembered, []);
});
test('смена изделия во время выбора не создаёт паспорт старому изделию', async () => {
  let current = true;
  const t = load({ firstError: missingFirm(), onModal: () => { current = false; } });
  assert.equal(await t.create({ productId: 'product' }, () => current), null);
  assert.equal(t.calls.length, 1);
});
test('устаревший вход не делает ни одного запроса', async () => {
  const t = load();
  assert.equal(await t.create({ productId: 'product' }, () => false), null);
  assert.equal(t.calls.length, 0);
});
