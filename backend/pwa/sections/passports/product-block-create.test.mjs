import test from 'node:test';
import assert from 'node:assert/strict';
import { load, fakeEl } from './funnel/test-vm.mjs';

/** C096 Э4: «+ Создать изделие» из старой формы паспорта — категория по группе; частичный успех не прячется. */
async function fixture({ confirm = true, partial = null } = {}) {
  const buttons = []; const cards = []; const sets = []; const confirms = []; const toasts = [];
  const mod = await load(new URL('./product-block.js', import.meta.url), {
    '../../core/dom.js': { h: (tag, attrs) => fakeEl(tag, attrs || {}) },
    '../../ui/kit/index.js': { button: (o) => { const b = fakeEl('button', { label: o.label, onClick: o.onClick }); buttons.push(b); return b; }, segmented: () => ({ el: fakeEl() }), modal: async () => false, sku: () => '' },
    '../../ui/kit/card.js': { openCard: (section, opts, cb) => cards.push({ section, opts, cb }) },
    '../products/form-fields.js': { productForm: () => ({ create: async () => { throw new Error('умолчания'); }, partial: () => partial }) },
    '../products.js': { products: { id: 'products' } },
    '../../ui/kit/dialog.js': { confirmDlg: async (title, text) => { confirms.push({ title, text }); return confirm; } },
    '../../ui/kit/toast.js': { toast: (t) => toasts.push(t), toastError() {} },
    '../../core/api.js': { api: async () => ({ items: [] }), PREFIX: '' },
    './common.js': { st: {}, V2_CATS: [], LATER_CATS: [], V2_NUMS: [], kinds: () => [], STATUS_LABEL: {}, canEdit: () => true, num: Number, dims: () => '', api_get: async () => ({ id: 'p1', name: 'Горка', passportDefaults: {} }) },
    './models.js': { productsAll: async () => [], models: async () => [], mmOf: (v) => v, resetProducts() {} },
    './form-state.js': { clearProductSelection() {} },
  });
  const values = { passportCategory: 'TRN' };
  const api = {
    input: (k) => (k === '_product' ? { el: fakeEl() } : { classList: { contains: () => false } }), root: fakeEl(),
    get: (k) => values[k] ?? '', set: (k, v) => { values[k] = v; sets.push([k, v]); }, manual: () => false, field: () => fakeEl(), open() {}, keys: () => [],
  };
  mod.productBlock(api, { r: null, catBy: new Map([['TRN', { catalogNames: 'Тренажёры' }]]) });
  await new Promise((r) => setTimeout(r, 0));
  const add = buttons.find((b) => b.label === '');
  add.onclick();
  return { card: cards[0], sets, confirms, toasts };
}

test('фильтр категории не становится своей категорией нового изделия; раздел — подсказка', async () => {
  const f = await fixture();
  assert.equal('pdCategory' in f.card.opts.initial, false);
  assert.equal(f.card.opts.initial.type, 'Тренажёры');
});

test('сбой после создания и закрытие карточки → правда и выбор созданного изделия', async () => {
  const f = await fixture({ partial: { id: 'p1', name: 'Горка' } });
  await f.card.cb.close();
  assert.equal(f.confirms[0].title, 'Изделие уже создано');
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(f.sets.some(([k, v]) => k === 'productId' && v === 'p1'));
});

test('отказ выбрать созданное — сообщение, что оно осталось в «Продукции»', async () => {
  const f = await fixture({ partial: { id: 'p1', name: 'Горка' }, confirm: false });
  await f.card.cb.close();
  assert.match(f.toasts[0], /осталось в «Продукции»/);
  assert.equal(f.sets.some(([k]) => k === 'productId'), false);
});

test('создания не было — закрытие ничего не спрашивает', async () => {
  const f = await fixture();
  await f.card.cb.close();
  assert.equal(f.confirms.length, 0);
});
