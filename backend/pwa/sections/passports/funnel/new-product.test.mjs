import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load, fakeEl } from './test-vm.mjs';

const session = await import('data:text/javascript;base64,' + Buffer.from(readFileSync(new URL('../../products/create-session.js', import.meta.url), 'utf8')).toString('base64'));

/** C096 Э4: новое изделие воронки — частичный успех, перенос признаков, чужая категория. */
async function fixture({ values = { name: 'Горка', group: 'Силовые' }, failSku = 0, confirm = true, ctx = {} } = {}) {
  const calls = []; const confirms = []; const buttons = []; const created = []; const picked = [];
  const mod = await load(new URL('./new-product.js', import.meta.url), {
    '../../../core/dom.js': { h: (tag) => fakeEl(tag) },
    '../../../ui/kit/index.js': {
      button: (o) => { const b = fakeEl('button', { label: o.label, onClick: o.onClick }); buttons.push(b); return b; },
      buildForm: () => ({ el: fakeEl(), read: () => ({ values }), dirty: () => true }),
      confirmDlg: async (title, text) => { confirms.push({ title, text }); return confirm; },
      similarBox: (o) => ({ el: fakeEl(), check() {}, onPick: o.onPick }),
      toast() {}, toastError() {},
    },
    '../../products/data.js': {
      formValues: async () => ({ groups: [{ value: 'Силовые', section: 'Тренажёры' }, { value: 'Скамьи', section: 'Благоустройство' }] }),
      createProduct: async (b) => { calls.push(['POST', b]); return { id: 'p1', name: b.name }; },
      patchProduct: async (id, b) => { calls.push(['PATCH', id, b]); return { id, name: b.name }; },
      assignSku: async (id) => { calls.push(['SKU', id]); if (failSku > 0) { failSku--; throw new Error('артикул'); } return {}; },
      getProduct: async (id) => ({ id, name: 'Горка' }),
    },
    '../../products/create-session.js': session,
    './api.js': { setFacets: async (id, ids) => { calls.push(['FACETS', id, ids]); } },
  });
  const np = mod.newProduct({ group: 'Силовые', facetIds: ['f1'], onCreated: (p) => created.push(p), onPickExisting: (it) => picked.push(it), ...ctx });
  await new Promise((r) => setTimeout(r, 0));
  const createBtn = () => buttons.find((b) => b.label === 'Создать и продолжить');
  const click = async (label) => { await buttons.filter((b) => b.label === label).pop().onClick(); };
  return { np, calls, confirms, created, picked, createBtn, click };
}

test('сбой после POST → запись видна, повтор — PATCH той же записи, второго POST нет', async () => {
  const f = await fixture({ failSku: 1 });
  await f.createBtn().onClick();
  assert.equal(f.np.partial().id, 'p1');
  assert.equal(f.np.dirty(), true);
  await f.createBtn().onClick();
  assert.deepEqual(f.calls.map((c) => c[0]), ['POST', 'SKU', 'PATCH', 'SKU', 'FACETS']);
  assert.equal(f.calls.filter((c) => c[0] === 'POST').length, 1);
  assert.equal(f.np.partial(), null);
  assert.equal(f.created.length, 1);
  assert.equal('_sel' in f.calls[0][1], false, 'служебное поле воронки не уходит на сервер');
});

test('частичный успех → «Открыть созданное изделие» выбирает именно его', async () => {
  const f = await fixture({ failSku: 1 });
  await f.createBtn().onClick();
  await f.click('Открыть созданное изделие');
  assert.equal(f.picked[0].id, 'p1');
});

test('та же (единственная) группа — признаки переносятся; другая группа — нет', async () => {
  const same = await fixture();
  await same.createBtn().onClick();
  assert.equal(JSON.stringify(same.calls.find((c) => c[0] === 'FACETS')[2]), '["f1"]');
  const other = await fixture({ values: { name: 'Скамья', group: 'Скамьи' } });
  await other.createBtn().onClick();
  assert.equal(JSON.stringify(other.calls.find((c) => c[0] === 'FACETS')[2]), '[]');
});

test('группа не из выбранной категории — подтверждение; отмена не создаёт и не трогает ввод', async () => {
  const ctx = { group: '', category: { code: 'TRN', label: 'Тренажёры' }, knownGroups: ['Силовые'] };
  const no = await fixture({ values: { name: 'Скамья', group: 'Скамьи' }, confirm: false, ctx });
  await no.createBtn().onClick();
  assert.equal(no.confirms[0].title, 'Группа из другого типа паспорта?');
  assert.match(no.confirms[0].text, /Тренажёры/);
  assert.equal(no.calls.length, 0);
  assert.equal(no.np.dirty(), true, 'ввод на месте');
  const yes = await fixture({ values: { name: 'Скамья', group: 'Скамьи' }, confirm: true, ctx });
  await yes.createBtn().onClick();
  assert.equal(yes.calls[0][0], 'POST');
  const own = await fixture({ values: { name: 'Жим', group: 'Силовые' }, ctx });
  await own.createBtn().onClick();
  assert.equal(own.confirms.length, 0, 'своя группа категории — без вопроса');
});

test('setContext: возврат к отложенной форме берёт текущие признаки воронки', async () => {
  const f = await fixture({ failSku: 1 });
  await f.createBtn().onClick();
  f.np.setContext({ group: 'Силовые', facetIds: ['f2'] });
  await f.createBtn().onClick();
  assert.equal(JSON.stringify(f.calls.find((c) => c[0] === 'FACETS')[2]), '["f2"]');
});
