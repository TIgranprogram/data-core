import test from 'node:test';
import assert from 'node:assert/strict';
import { load, fakeEl } from './test-vm.mjs';

/** C096 Э4: воронка не прячет созданное изделие и продолжает ту же запись; шаги следуют категории новой группы. */
async function fixture({ confirm = true, partial = { id: 'p1', name: 'Горка' } } = {}) {
  const made = []; const confirms = []; const updates = []; const toasts = [];
  let list; let state = partial;
  const mod = await load(new URL('./index.js', import.meta.url), {
    '../../../core/dom.js': { h: (tag) => fakeEl(tag) },
    '../../../ui/kit/index.js': {
      confirmDlg: async (title, text) => { confirms.push({ title, text }); return confirm; },
      stack: (...xs) => fakeEl('div', { children: xs }), toast: (t) => toasts.push(t), toastError() {},
    },
    './new-product.js': { newProduct: (opts) => {
      const c = { opts, el: fakeEl(), busy: () => false, dirty: () => !!state, partial: () => state, contexts: [], setContext(x) { this.contexts.push(x); } };
      made.push(c); return c;
    } },
    './pick-steps.js': { pickSteps: () => ({
      el: fakeEl(), update: (p) => updates.push(JSON.stringify(p)), setDone() {}, setNext() {}, ready: () => true, order: () => ['category', 'group'],
      labelOf: (k, id) => ({ BLG: 'Благоустройство' })[id] || '',
      effective: (k) => (k === 'group' ? { id: 'g1', label: 'Силовые' } : { id: 'TRN', label: 'Тренажёры' }), valuesOf: () => ['Силовые'],
    }) },
    './product-list.js': { productList: (o) => { list = o; return { el: fakeEl(), paint() {}, gate() {} }; } },
    './open.js': { takePending: () => null, peekReady: () => false },
    './api.js': { getProduct: async (id) => ({ id, name: 'x' }) },
    './issue.js': { openPositions: async () => [], issueBlock: () => ({ el: fakeEl(), paint() {} }), orderStep: () => fakeEl() },
    '../fill/index.js': { passportFill: async () => ({ el: fakeEl(), missingRequired: async () => [] }) },
  });
  mod.passFunnel.form.build();
  return { list, made, confirms, updates, toasts, setPartial: (v) => { state = v; } };
}

test('частичный успех → «Назад» говорит правду; «+ Новое изделие» продолжает ту же форму и запись', async () => {
  const f = await fixture();
  f.list.onNew();
  assert.equal(f.made[0].opts.group, 'Силовые', 'единственная группа воронки подставлена');
  assert.equal(JSON.stringify(f.made[0].opts.category), JSON.stringify({ code: 'TRN', label: 'Тренажёры' }));
  await f.made[0].opts.onCancel();
  assert.equal(f.confirms[0].title, 'Изделие уже создано');
  assert.doesNotMatch(f.confirms[0].text, /не сохранен/);
  f.list.onNew();
  assert.equal(f.made.length, 1, 'новой формы и второго POST нет');
  assert.equal(f.made[0].contexts.length, 1, 'контекст воронки обновлён');
});

test('«Создать другое изделие» — новая форма, о созданном сказано', async () => {
  const f = await fixture();
  f.list.onNew();
  f.made[0].opts.onFresh();
  assert.equal(f.made.length, 2);
  assert.match(f.toasts[0], /осталось в «Продукции»/);
});

test('отмена ухода — форма и запись остаются', async () => {
  const f = await fixture({ confirm: false });
  f.list.onNew();
  await f.made[0].opts.onCancel();
  f.setPartial(null);
  assert.equal(f.made.length, 1);
});

test('категория новой группы другая — шаги воронки обновляются, без записи категории', async () => {
  const f = await fixture({ partial: null });
  f.list.onNew();
  f.made[0].opts.onCreated({ id: 'p2', name: 'Скамья', passportCategory: { inherited: { code: 'BLG' } } });
  assert.equal(f.updates.at(-1), JSON.stringify({ category: 'BLG' }));
  assert.match(f.toasts.at(-1), /Благоустройство/);
});
