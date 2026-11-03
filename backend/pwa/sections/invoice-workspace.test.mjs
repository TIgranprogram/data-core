import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const source = (file) => fs.readFileSync(new URL(file, root), 'utf8');
const pure = await import('data:text/javascript;base64,' + Buffer.from(source('sections/invoice-workspace-state.js')).toString('base64'));
const clean = (value) => JSON.parse(JSON.stringify(value));
const base = (extra = {}) => ({ id: 'invoice', status: 'issued', version: 8, amount: 100, requests: [{ id: 'line', title: 'Болт', qty: 3, priceHint: 100, lineAmount: 100, status: 'ordered' }], ...extra });
const rights = { canEdit: true, canMoney: true, role: 'admin', isAdmin: true };

class Element {
  constructor(tag, attrs = {}, ...children) {
    this.tag = tag; this.attrs = attrs || {}; this.dataset = { ...(attrs?.dataset || {}) }; this.listeners = {}; this.value = attrs?.value ?? ''; this.disabled = !!attrs?.disabled; this.hidden = !!attrs?.hidden; this.children = []; this.parentNode = null;
    for (const [key, value] of Object.entries(attrs || {})) if (key.startsWith('data-')) this.dataset[key.slice(5)] = value;
    const classes = new Set((attrs?.class || '').split(/\s+/).filter(Boolean));
    this.classList = { contains: (key) => classes.has(key), add: (...keys) => keys.forEach((key) => classes.add(key)), remove: (...keys) => keys.forEach((key) => classes.delete(key)), toggle: (key, force) => { const on = force ?? !classes.has(key); if (on) classes.add(key); else classes.delete(key); return on; } };
    for (const [key, value] of Object.entries(attrs || {})) if (key.startsWith('on') && typeof value === 'function') { this[key] = value; this.listeners[key.slice(2)] = value; }
    this.append(...children);
  }
  get textContent() { return this.children.map((child) => child instanceof Element ? child.textContent : String(child)).join(' '); }
  set textContent(value) { this.children = [String(value)]; }
  append(...nodes) { for (const node of nodes.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false)) { this.children.push(node); if (node instanceof Element) node.parentNode = this; } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this); this.parentNode = null; }
  addEventListener(key, fn) { this.listeners[key] = fn; }
  removeEventListener() {}
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; }
  contains(node) { return node === this || this.children.some((child) => child instanceof Element && child.contains(node)); }
  focus() { this.focused = true; }
  matches(selector) { if (selector.startsWith('.')) return this.classList.contains(selector.slice(1)); if (selector.startsWith('[name=')) return this.attrs.name === selector.slice(6, -1).replaceAll('"', ''); return this.tag === selector; }
  querySelectorAll(selector) { return this.children.filter((node) => node instanceof Element).flatMap((node) => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const h = (tag, attrs, ...children) => new Element(tag, attrs, ...children);
const buttonNamed = (el, label) => el.querySelectorAll('button').find((button) => button.textContent === label);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function buildForm(fields, initial = {}) {
  const widgets = new Map(), inputs = {};
  const el = h('div');
  for (const field of fields.filter(Boolean)) {
    if (!field.key) continue;
    const widget = field.type === 'widget' ? field.widget(initial[field.key]) : { el: h('input', { name: field.key, value: initial[field.key] || '' }) };
    if (field.type !== 'widget') Object.defineProperty(widget, 'value', { get: () => widget.el.value });
    widgets.set(field.key, widget); inputs[field.key] = widget.el; el.append(widget.el);
  }
  const values = () => Object.fromEntries([...widgets].map(([key, widget]) => { let value = widget.value; try { value = JSON.parse(value); } catch {} return [key, value]; }));
  const initialValue = JSON.stringify(values());
  return { el, inputs, read: () => ({ values: values() }), dirty: () => initialValue !== JSON.stringify(values()) };
}
async function modules({ invoice = base(), money = true, call, confirm = true } = {}) {
  const calls = [], session = { canEdit: true, canMoney: money };
  const api = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', ...opts });
    if (call) return call(path, opts);
    if (path === '/incomes/lookups') return { companies: [] };
    if (path === '/supply/contracts') return { items: [] };
    return invoice;
  };
  const kit = { buildForm, h, section: ({ title, body }) => h('details', null, title, body), table: ({ columns, rows, empty, label }) => h('table', { 'aria-label': label }, columns.map((c) => h('th', null, c.label)), rows.length ? rows.map((r) => h('tr', { 'data-id': r.data }, r.cells)) : h('p', null, empty?.title, empty?.hint)), button: ({ label, onClick, disabled }) => h('button', { onclick: onClick, disabled }, label), actions: (...children) => h('div', { class: 'actions' }, children), link: ({ label, href }) => h('a', { href }, label), badge: (map, key) => h('span', null, typeof map === 'string' ? map : key), INVOICE_STATUS: {}, SUPPLY_STATUS: {}, failBlock: (error, retry) => h('fail', { retry }, error.message), confirmDlg: async () => confirm, toast() {}, toastError() {}, photoField: () => ({ el: h('div'), ids: () => [] }) };
  const body = h('body');
  const document = { body, addEventListener() {}, removeEventListener() {}, querySelector: (selector) => body.querySelector(selector), dispatchEvent() {} };
  const context = vm.createContext({ console, Node: Element, window: { innerWidth: 1800, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }, document, Promise, setTimeout, clearTimeout, URLSearchParams, CustomEvent: class {}, KeyboardEvent: class {}, localStorage: { getItem: () => null, setItem() {} } });
  const common = { ...kit, api, session, PREFIX: '', h, canEditSection: () => session.canEdit, current: () => ({ section: 'requests', params: { view: 'board', q: 'гайка', page: '2' } }), date: (v) => String(v || ''), dateTime: (v) => v, money: (v) => `${v} ₽`, qty: (v) => String(v ?? ''), getPref: () => null, DOCK_MIN: 1400, setPref() {}, makeResizable() {}, errText: (e) => e.message, isFailure: () => false, actionText: (_, e) => e.message, busyBtn: (button) => { button.disabled = true; return () => { button.disabled = false; }; } };
  const cache = new Map();
  async function load(file) {
    if (cache.has(file)) return cache.get(file);
    const text = source(file);
    const mod = new vm.SourceTextModule(text, { context, identifier: file }); cache.set(file, mod);
    await mod.link(async (specifier) => {
      const url = new URL(specifier, new URL(file, root)); const rel = url.pathname.slice(root.pathname.length);
      if (rel.includes('invoice-workspace') || rel === 'ui/kit/readonly.js') return load(rel);
      const match = [...text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)].find((m) => m[2] === specifier);
      const names = match[1].split(',').map((name) => name.trim().split(/\s+as\s+/)[0]);
      return new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, common[name] ?? (() => {})); }, { context });
    });
    return mod;
  }
  const readonly = await load('ui/kit/readonly.js'); await readonly.evaluate(); common.readonlyGroup = readonly.namespace.readonlyGroup;
  const workspace = await load('sections/invoice-workspace.js'); await workspace.evaluate();
  // kit readonlyGroup в composition должен быть настоящим renderer, а не mock.
  common.readonlyGroup = cache.get('ui/kit/readonly.js')?.namespace?.readonlyGroup || (({ title, rows }) => h('section', null, title, rows.filter(Boolean).map(([label, value]) => [label, value])));
  return { load, context, common, calls, session, body, api, workspace: workspace.namespace, forms: cache.get('sections/invoice-workspace-forms.js').namespace };
}

for (const locked of [{ receiptBoundaryAt: '2026-01-01' }, { lockReason: 'receipt' }, { requests: [{ id: 'hidden', status: 'received' }] }]) test('authoritative/fallback boundary запрещает финансы, но разрешает metadata: ' + JSON.stringify(locked), () => {
  const p = pure.permissions(base(locked), rights); assert.equal(p.finance, false); assert.equal(p.meta, true); assert.equal(p.add, false); assert.equal(p.editLine, false);
});
for (const extra of [{ partial: true }, { status: 'cancelled' }]) test('partial/cancelled запрещает ВСЕ writes: ' + JSON.stringify(extra), () => {
  for (const op of ['meta', 'line', 'add', 'remove', 'issue', 'pay', 'receive']) assert.throws(() => pure.assertOperation(base(extra), rights, op, 'line'));
});
test('paid до приёмки: админ edit/add/remove; после boundary нельзя править позиции', () => {
  const p = pure.permissions(base({ status: 'paid' }), rights); assert.equal(p.editLine, true); assert.equal(p.add, true); assert.equal(p.removeLine, true); assert.equal(p.pay, false);
  assert.throws(() => pure.addBody(base({ status: 'paid' }), ['a']), /причину/);
  assert.deepEqual(pure.addBody(base({ status: 'paid' }), ['a', 'a'], 'Уточнение'), { requestIds: ['a'], reason: 'Уточнение' });
  const noAdmin = pure.permissions(base({ status: 'paid' }), { canEdit: true, canMoney: true, role: 'manager' });
  assert.equal(noAdmin.removeLine, false); assert.equal(noAdmin.editLine, false);
});
test('money=false не допускает финансовых writes, metadata допустима и whitelist после receipt', () => {
  const p = pure.permissions(base(), { ...rights, canMoney: false }); assert.equal(p.finance, false); assert.equal(p.pay, false); assert.equal(p.meta, true);
  const body = pure.metaBody(base({ receiptBoundaryAt: 'stamp' }), { no: ' А ', date: '2026-11-03', fileIds: ['f'], contractId: 'c', amount: 999, payerCompanyId: 'new' }, rights);
  assert.deepEqual(body, { no: 'А', date: '2026-11-03', fileIds: ['f'], contractId: 'c' });
});
test('received/cancelled line нельзя удалить; paid-строку до приёмки админ может убрать', () => {
  for (const line of [{ id: 'line', status: 'received' }, { id: 'line', status: 'cancelled' }]) assert.throws(() => pure.assertOperation(base({ requests: [line] }), rights, 'remove', 'line'));
  assert.doesNotThrow(() => pure.assertOperation(base({ requests: [{ id: 'line', status: 'ordered', paid: true }] }), rights, 'remove', 'line'));
});
test('формы используют новый helper: 100/3, qty, unit и reason не открывают второй drawer', async () => {
  const m = await modules(); const form = m.forms.buildLineForm(base({ status: 'paid' }), base().requests[0]);
  form.inputs.qty.value = '4'; form.inputs.qty.listeners.input(); assert.equal(form.inputs.lineAmount.value, '100');
  assert.throws(() => form.payload(), /причину/); form.inputs.reason.value = ' Исправление '; assert.equal(form.payload().lineAmount, 100);
  form.inputs.unitPrice.value = '40'; form.inputs.unitPrice.listeners.input(); assert.equal(form.payload().lineAmount, 160);
  assert.equal(m.calls.length, 0);
});
test('каждая transport-команда делает ровно один write без скрытого GET/перехода', async () => {
  const m = await modules(); const apiModule = await m.load('sections/invoice-workspace-api.js'); await apiModule.evaluate();
  for (const [op, inv, body] of [['line', base(), { qty: 3, lineAmount: 100, version: 8 }], ['meta', base(), { no: 'А' }], ['add', base(), { requestIds: ['a'] }], ['remove', base(), {}], ['issue', base({ status: 'draft' }), {}], ['pay', base(), {}], ['receive', base(), { requestIds: ['line'] }]]) {
    m.calls.length = 0; await apiModule.namespace.writeInvoice(inv, rights, op, body, 'line'); assert.equal(m.calls.length, 1); assert.notEqual(m.calls[0].method, 'GET');
  }
});
test('успех line write → один fresh GET, fresh version и 409 без replay', async () => {
  let fail = false;
  const m = await modules({ call: async (path, opts) => { if (opts.method && fail) throw Object.assign(new Error('Версия изменилась'), { status: 409 }); return base({ version: 9 }); } });
  const values = { invoice: base(), operation: 'line', lineId: 'line', body: { lineAmount: 100, qty: 3, version: 8 } };
  assert.equal((await m.workspace.invoiceCard.form.update('invoice', values)).version, 9); assert.deepEqual(m.calls.map((c) => c.method), ['PATCH', 'GET']);
  m.calls.length = 0; fail = true; await assert.rejects(m.workspace.invoiceCard.form.update('invoice', values)); assert.equal(m.calls.length, 1);
});
test('подтверждённый write + ошибка GET не называется несохранённым и не повторяет POST', async () => {
  const m = await modules({ call: async (_path, opts) => { if (!opts.method) throw new Error('Нет связи'); return {}; } });
  const saved = await m.workspace.invoiceCard.form.update('invoice', { invoice: base(), operation: 'add', body: { requestIds: ['candidate'] } });
  assert.equal(saved.id, 'invoice'); assert.ok(saved._refreshError); assert.deepEqual(m.calls.map((c) => c.method), ['POST', 'GET']);
});
test('candidate total не теряется на полностью привязанной первой странице; search/page идут на сервер', async () => {
  const m = await modules({ call: async () => ({ items: [{ id: 'linked', invoiceId: 'other' }], total: 201, page: 1, limit: 50 }) });
  const apiModule = await m.load('sections/invoice-workspace-api.js'); await apiModule.evaluate();
  const result = await apiModule.namespace.getCandidates(base({ supplierId: 'supplier' }), { page: 1, q: 'болт' });
  assert.equal(result.items.length, 0); assert.equal(result.total, 201); assert.equal(m.calls[0].query.search, 'болт'); assert.equal(m.calls[0].query.page, 1);
});
test('add форма хранит выбор между страницами/поисками и paid reason; conflict сохраняет draft', async () => {
  const m = await modules(); let pages = [], refresh = 0;
  const form = await m.forms.buildWorkspaceForm(base({ status: 'paid' }), { operation: 'add' }, { candidates: async (_inv, opts) => { pages.push(opts.page); return { items: [{ id: 'candidate-' + opts.page, title: 'Заявка', qty: 1 }], total: 101 }; }, overview: () => h('div'), href: () => '#fixture', refresh: () => { refresh++; } });
  await tick(); const cb = form.el.querySelector('input'); // search — не checkbox
  const first = form.el.querySelectorAll('input').find((input) => input.attrs.type === 'checkbox'); first.listeners.change({ target: { checked: true } });
  await buttonNamed(form.el, 'Далее ›').attrs.onclick();
  const second = form.el.querySelectorAll('input').find((input) => input.attrs.type === 'checkbox'); second.listeners.change({ target: { checked: true } });
  assert.throws(() => form.read(), /причину/); form.el.querySelector('[name="reason"]').value = 'Добавление';
  assert.deepEqual(clean(form.read().values.body), { requestIds: ['candidate-1', 'candidate-2'], reason: 'Добавление' }); assert.equal(form.dirty(), true);
  let enabled = true; form.bindSave((value) => { enabled = value; }); form.onError({ status: 409, data: { existingInvoiceId: 'existing' } }); assert.equal(enabled, false); assert.equal(form.conflicted, true);
  assert.equal(form.read().values.body.requestIds.length, 2); assert.equal(refresh, 0); assert.ok(pages.includes(2));
});
test('router wiring: lazy invoicecard, four router-only входа, legacy invoice links, отсутствие циклов/second openCard', async () => {
  assert.match(source('main.js'), /invoicecard: \[\(\) => import\('\.\/sections\/invoice-workspace.js'\)/);
  assert.match(source('main.js'), /guardRoute\(c\)/);
  assert.match(source('main.js'), /params\.tab === 'invoices' && params\.open && !params\.of/);
  for (const file of ['sections/requests.js', 'sections/invoices-tab.js', 'sections/request-step.js']) assert.match(source(file), /of: 'invoicecard'/);
  assert.match(source('ui/kit/board.js'), /rs\.length < 2 && !g\?\.open/);
  for (const file of ['sections/invoice-workspace.js', 'sections/invoice-workspace-forms.js', 'sections/invoice-workspace-state.js', 'sections/invoice-workspace-api.js']) assert.doesNotMatch(source(file), /openCard\(|from ['"].*\/(requests|invoices-tab|request-step|invoice)\.js/);
  assert.doesNotMatch(source('ui/card.js'), /from ['"]\.\/kit\/index\.js/);
  const m = await modules(); const href = m.workspace.workspaceHref({ of: 'invoicecard', open: 'invoice' }); assert.match(href, /view=board/); assert.match(href, /page=2/); assert.match(href, /of=invoicecard/);
});

test('readonly renderer: группы/0/DOM links/пустоты; DOM-узел не склеивается в строку', async () => {
  const m = await modules(); const readonly = await m.load('ui/kit/readonly.js'); await readonly.evaluate();
  const a = h('a', { href: '#requests' }, 'Заявка');
  const group = readonly.namespace.readonlyGroup({ title: 'Сведения', rows: [['Ноль', 0], ['Связь', a], ['Пусто', ''], ['Нет', null]] });
  assert.ok(group.contains(a)); assert.match(group.textContent, /0/); assert.doesNotMatch(group.textContent, /Пусто/);
  assert.equal(readonly.namespace.readonlyGroup({ title: 'Пусто', rows: [['Нет', '']] }), null);
  const marker = h('span', { class: 'fields-grp' }, 'Цена'); const groups = readonly.namespace.readonlyGroups([[marker, h('span')], ['Ноль', 0], [h('span', { class: 'fields-grp' }, 'Пустая'), h('span')], ['Пусто', '']]);
  assert.match(groups.textContent, /Цена/); assert.doesNotMatch(groups.textContent, /Пустая/);
});

test('общий openCard guard: та же панель, dirty internal edit/load/reload/close; saving защищён', async () => {
  const m = await modules({ confirm: false }); const card = await m.load('ui/card.js'); await card.evaluate(); let ctx, dirty = false, saved = 0, changed = 0;
  const section = { title: 'Счёт', get: async () => base(), card: { heading: () => 'Счёт', noHistory: true, view: () => [], extra: (_inv, next) => { ctx = next; return h('div'); } }, form: { build: () => ({ el: h('div'), dirty: () => dirty, read: () => ({ values: {} }) }), toBody: (v) => v, update: async () => { saved++; return base(); } } };
  const handle = card.namespace.openCard(section, { id: 'invoice' }, { close() {}, changed: () => changed++ }); await tick();
  await ctx.edit({ _operation: 'line' }); assert.equal(m.body.querySelectorAll('.drawer').length, 1); assert.equal(handle.editing, true);
  dirty = true; assert.equal(await handle.canLeave(), false); assert.equal(await handle.load('other'), false); await ctx.edit({ _operation: 'meta' }); await ctx.reload(); assert.equal(handle.editing, true); assert.equal(saved, 0);
  const save = buttonNamed(m.body, 'Сохранить'); await save.onclick(); assert.equal(saved, 1); assert.equal(changed, 1); assert.equal(m.body.querySelectorAll('.drawer').length, 1); assert.equal(handle.editing, false);
  handle.close(); assert.equal(m.body.querySelectorAll('.drawer').length, 0);
});

test('metadata paid не отправляет неподдерживаемый DTO reason; boundary whitelist исключает duplicateReason', () => {
  const body = pure.metaBody(base({ status: 'paid', payerCompanyId: 'old' }), { no: '1', payerCompanyId: 'new', reason: 'Не поле DTO' }, rights);
  assert.equal(body.payerCompanyId, 'new'); assert.equal('reason' in body, false);
  const locked = pure.metaBody(base({ receiptBoundaryAt: 'stamp' }), { no: '1', duplicateReason: 'Нельзя после приёмки', payerCompanyId: 'new' }, rights);
  assert.deepEqual(Object.keys(locked).sort(), ['contractId', 'date', 'fileIds', 'no']);
});

test('readonly renderer реально сохраняет 0, false→Нет, true→Да и DOM-ссылку', async () => {
  const m = await modules(); const readonly = await m.load('ui/kit/readonly.js');
  const anchor = h('a', { href: '#requests' }, 'Ссылка');
  const group = readonly.namespace.readonlyGroup({ title: 'Реквизиты', rows: [['Ноль', 0], ['Флаг', false], ['Включено', true], ['Связь', anchor], ['Пустое', '']] });
  const dd = group.querySelectorAll('dd');
  assert.deepEqual(dd.map(x => x.textContent), ['0', 'Нет', 'Да', 'Ссылка']);
  assert.equal(group.querySelector('a'), anchor);
  assert.equal(readonly.namespace.readonlyGroup({ rows: [['Нет значения', '']] }), null);
});

test('фиксировать реальную оплату уже полученного issued-счёта можно; его цены менять нельзя', () => {
  const p = pure.permissions(base({ requests: [{ id: 'line', status: 'received' }] }), rights);
  assert.equal(p.pay, true); assert.equal(p.editLine, false); assert.equal(p.add, false); assert.equal(p.removeLine, false);
});

test('добавление соблюдает DTO максимум200 уникальных заявок', () => {
  assert.throws(() => pure.addBody(base(), Array.from({ length: 201 }, (_, i) => 'r' + i)), /не более 200/);
  assert.equal(pure.addBody(base(), Array(201).fill('r')).requestIds.length, 1);
});
