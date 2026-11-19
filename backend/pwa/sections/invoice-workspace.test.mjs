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
  const calls = [], session = { canEdit: true, canMoney: money, role: 'admin', isAdmin: true };
  const api = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', ...opts });
    if (call) return call(path, opts);
    if (path === '/incomes/lookups') return { companies: [] };
    if (path === '/supply/contracts') return { items: [] };
    return invoice;
  };
  const kit = { buildForm, h, section: ({ title, body }) => h('details', null, title, body), table: ({ columns, rows, empty, label }) => h('table', { 'aria-label': label }, columns.map((c) => h('th', null, c.label)), rows.length ? rows.map((r) => h('tr', { 'data-id': r.data }, r.cells)) : h('p', null, empty?.title, empty?.hint)), button: ({ label, onClick, disabled }) => h('button', { onclick: onClick, disabled }, label), actions: (...children) => h('div', { class: 'actions' }, children), link: ({ label, href }) => h('a', { href }, label), badge: (map, key) => h('span', { class: typeof map === 'string' ? key : '' }, typeof map === 'string' ? map : key), INVOICE_STATUS: {}, SUPPLY_STATUS: {}, failBlock: (error, retry) => h('fail', { retry }, error.message), confirmDlg: async () => confirm, toast() {}, toastError() {}, photoField: () => ({ el: h('div'), ids: () => [] }) };
  const body = h('body');
  const document = { body, addEventListener() {}, removeEventListener() {}, querySelector: (selector) => body.querySelector(selector), dispatchEvent() {} };
  const context = vm.createContext({ console, Node: Element, window: { innerWidth: 1800, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }, document, Promise, setTimeout, clearTimeout, URLSearchParams, CustomEvent: class {}, KeyboardEvent: class {}, localStorage: { getItem: () => null, setItem() {} } });
  const common = { ...kit, mark: (el) => el, markEl: (res) => res, api, session, PREFIX: '', h, canEditSection: () => session.canEdit, current: () => ({ section: 'requests', params: { view: 'board', q: 'гайка', page: '2' } }), date: (v) => String(v || ''), dateTime: (v) => v, money: (v) => `${v} ₽`, qty: (v) => String(v ?? ''), getPref: () => null, DOCK_MIN: 1400, setPref() {}, makeResizable() {}, errText: (e) => e.message, isFailure: () => false, actionText: (_, e) => e.message, busyBtn: (button) => { button.disabled = true; return () => { button.disabled = false; }; } };
  const cache = new Map();
  async function load(file) {
    if (cache.has(file)) return cache.get(file);
    const text = source(file);
    const mod = new vm.SourceTextModule(text, { context, identifier: file }); cache.set(file, mod);
    await mod.link(async (specifier) => {
      const url = new URL(specifier, new URL(file, root)); const rel = url.pathname.slice(root.pathname.length);
      if ((rel.includes('invoice-workspace') || rel.includes('financial-articles')) || rel === 'ui/kit/card-parent.js' || rel === 'ui/kit/readonly.js' || rel === 'ui/kit/auto-more.js' || rel === 'ui/op-row.js' || rel === 'ui/kit/screens/card.js' || rel.endsWith('money-operations-state.js')) return load(rel);
      const match = [...text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)].find((m) => m[2] === specifier);
      const names = match[1].split(',').map((name) => name.trim().split(/\s+as\s+/)[0]);
      return new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, common[name] ?? (() => {})); }, { context });
    });
    return mod;
  }
  const readonly = await load('ui/kit/readonly.js'); await readonly.evaluate(); common.readonlyGroup = readonly.namespace.readonlyGroup; const autoMoreMod = await load('ui/kit/auto-more.js'); await autoMoreMod.evaluate(); common.autoMore = autoMoreMod.namespace.autoMore;
  const workspace = await load('sections/invoice-workspace.js'); await workspace.evaluate();
  // kit readonlyGroup в composition должен быть настоящим renderer, а не mock.
  common.readonlyGroup = cache.get('ui/kit/readonly.js')?.namespace?.readonlyGroup || (({ title, rows }) => h('section', null, title, rows.filter(Boolean).map(([label, value]) => [label, value])));
  return { load, context, common, calls, session, body, api, workspace: workspace.namespace, forms: cache.get('sections/invoice-workspace-forms.js').namespace };
}

for (const locked of [{ receiptBoundaryAt: '2026-01-01' }, { lockReason: 'receipt' }, { requests: [{ id: 'hidden', status: 'received' }] }]) test('authoritative/fallback boundary запрещает финансы, но разрешает metadata: ' + JSON.stringify(locked), () => {
  const p = pure.permissions(base(locked), rights); assert.equal(p.finance, false); assert.equal(p.meta, true); assert.equal(p.add, false); assert.equal(p.editLine, true); assert.equal(pure.permissions(base(locked), { ...rights, role: 'manager', isAdmin: false }).editLine, false);
});
for (const extra of [{ partial: true }, { status: 'cancelled' }]) test('partial/cancelled запрещает ВСЕ writes: ' + JSON.stringify(extra), () => {
  for (const op of ['meta', 'line', 'add', 'remove', 'issue', 'pay', 'receive']) assert.throws(() => pure.assertOperation(base(extra), rights, op, 'line'));
});
test('paid до приёмки: админ edit/add/remove; после boundary нельзя править позиции', () => {
  const p = pure.permissions(base({ status: 'paid' }), rights); assert.equal(p.editLine, true); assert.equal(p.add, true); assert.equal(p.removeLine, true); assert.equal(p.pay, false);
  assert.deepEqual(pure.addBody(base({ status: 'paid' }), ['a']), { requestIds: ['a'] });
  assert.deepEqual(pure.addBody(base({ status: 'paid' }), ['a', 'a'], 'Уточнение'), { requestIds: ['a'], reason: 'Уточнение' });
  const noAdmin = pure.permissions(base({ status: 'paid' }), { canEdit: true, canMoney: true, role: 'manager' });
  assert.equal(noAdmin.removeLine, false); assert.equal(noAdmin.editLine, true); // решение Б: менеджер правит цену до приёмки
});
test('money=false не допускает финансовых writes, metadata допустима и whitelist после receipt', () => {
  const p = pure.permissions(base(), { ...rights, canMoney: false }); assert.equal(p.finance, false); assert.equal(p.pay, false); assert.equal(p.meta, true);
  const body = pure.metaBody(base({ receiptBoundaryAt: 'stamp' }), { no: ' А ', date: '2026-11-03', fileIds: ['f'], contractId: 'c', amount: 999, payerCompanyId: 'new' }, rights);
  // неоплаченный счёт после приёмки: «Наша компания» доступна (иначе не оплатить), сумма — нет
  assert.deepEqual(body, { no: 'А', date: '2026-11-03', fileIds: ['f'], contractId: 'c', payerCompanyId: 'new' });
  const paidLocked = pure.metaBody(base({ status: 'paid', receiptBoundaryAt: 'stamp' }), { no: '1', payerCompanyId: 'new' }, rights);
  assert.equal('payerCompanyId' in paidLocked, false);
});
test('received/cancelled line нельзя удалить; paid-строку до приёмки админ может убрать', () => {
  for (const line of [{ id: 'line', status: 'received' }, { id: 'line', status: 'cancelled' }]) assert.throws(() => pure.assertOperation(base({ requests: [line] }), rights, 'remove', 'line'));
  assert.doesNotThrow(() => pure.assertOperation(base({ requests: [{ id: 'line', status: 'ordered', paid: true }] }), rights, 'remove', 'line'));
});
test('формы используют новый helper: 100/3, qty, unit и reason не открывают второй drawer', async () => {
  const m = await modules(); const form = m.forms.buildLineForm(base({ status: 'paid' }), base().requests[0]);
  form.inputs.qty.value = '4'; form.inputs.qty.listeners.input(); assert.equal(form.inputs.lineAmount.value, '100');
  assert.equal(form.payload().lineAmount, 100);
  form.inputs.unitPrice.value = '40'; form.inputs.unitPrice.listeners.input(); assert.equal(form.payload().lineAmount, 160);
  assert.equal(m.calls.length, 0);
});
test('каждая transport-команда делает ровно один write без скрытого GET/перехода', async () => {
  const m = await modules(); const apiModule = await m.load('sections/invoice-workspace-api.js'); await apiModule.evaluate();
  for (const [op, inv, body] of [['line', base(), { qty: 3, lineAmount: 100, version: 8 }], ['meta', base(), { no: 'А' }], ['add', base(), { requestIds: ['a'] }], ['remove', base(), {}], ['issue', base({ status: 'draft', payerCompanyId: 'co' }), {}], ['pay', base({ payerCompanyId: 'co' }), {}], ['receive', base(), { requestIds: ['line'] }]]) {
    m.calls.length = 0; await apiModule.namespace.writeInvoice(inv, rights, op, body, 'line'); assert.equal(m.calls.length, 1); assert.notEqual(m.calls[0].method, 'GET');
  }
});
test('issue/pay без нашей компании запрещены', () => {
  assert.throws(() => pure.assertOperation(base({ status: 'draft' }), rights, 'issue'), /Нашу компанию/);
  assert.throws(() => pure.assertOperation(base(), rights, 'pay'), /Нашу компанию/);
  assert.doesNotThrow(() => pure.assertOperation(base({ status: 'draft', payerCompanyId: 'co' }), rights, 'issue'));
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
  await buttonNamed(form.el, 'Показать ещё').attrs.onclick(); await tick(); // ПГ-1c: порции подгружаются и накапливаются
  const second = form.el.querySelectorAll('input').filter((input) => input.attrs.type === 'checkbox')[1]; second.listeners.change({ target: { checked: true } });
  assert.deepEqual(clean(form.read().values.body), { requestIds: ['candidate-1', 'candidate-2'] }); assert.equal(form.dirty(), true);
  form.el.querySelector('[name="reason"]').value = 'Добавление';
  assert.deepEqual(clean(form.read().values.body), { requestIds: ['candidate-1', 'candidate-2'], reason: 'Добавление' });
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
  assert.doesNotMatch(source('ui/kit/card.js'), /from ['"]\.\/index\.js/);
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
  const m = await modules({ confirm: false }); const card = await m.load('ui/kit/card.js'); await card.evaluate(); let ctx, dirty = false, saved = 0, changed = 0;
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
  assert.deepEqual(Object.keys(locked).sort(), ['contractId', 'date', 'fileIds', 'no', 'payerCompanyId']);
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

test('фиксировать реальную оплату уже полученного issued-счёта можно; цены исправляет только администратор', () => {
  const p = pure.permissions(base({ requests: [{ id: 'line', status: 'received' }] }), rights);
  assert.equal(p.pay, true); assert.equal(p.editLine, true); assert.equal(p.add, false); assert.equal(p.removeLine, false);
});

test('добавление соблюдает DTO максимум200 уникальных заявок', () => {
  assert.throws(() => pure.addBody(base(), Array.from({ length: 201 }, (_, i) => 'r' + i)), /не более 200/);
  assert.equal(pure.addBody(base(), Array(201).fill('r')).requestIds.length, 1);
});


test('C158: аванс блокирует финансы, сохраняя приёмку и дальнейшие оплаты', () => {
  const invoice = base({ paymentAccountingVersion: 1, paidAmount: 25, paymentState: 'partial' });
  const p = pure.permissions(invoice, rights);
  for (const key of ['finance', 'payer', 'add', 'editLine', 'removeLine']) assert.equal(p[key], false, key);
  assert.equal(p.pay, true); assert.equal(p.unpay, true);
  assert.equal(pure.permissions({ ...invoice, receiptBoundaryAt: 'stamp' }, rights).unpay, false);
  assert.equal(pure.permissions({ ...invoice, receiptBoundaryAt: 'stamp' }, rights).pay, true);
});
test('C158: историческая дата и реальные рубли отделены от валюты обязательства', () => {
  const invoice = base({ currency: 'UE', currencyName: 'доллар США', sourceBalance: 360 });
  const draft = { date: '2026-09-17', amount: 30326, sourceAmount: 360, payerCompanyId: 'payer' };
  const body = pure.paymentBody(invoice, draft, 'stable');
  assert.equal(body.date, draft.date); assert.equal(body.amount, 30326); assert.equal(body.sourceAmount, 360); assert.equal(body.version, 8);
  for (const date of ['2026-02-30', '2999-01-01']) assert.throws(() => pure.paymentBody(invoice, { ...draft, date }, 'stable'));
  assert.throws(() => pure.paymentBody(invoice, { ...draft, sourceAmount: 361 }, 'stable'));
});
test('C158: неизвестный курс и отсутствие НДС не превращаются в ноль', () => {
  const body = pure.financialMetaBody({ currency: 'USD', vatMode: 'none', exchangeRate: '', vatRate: '' });
  assert.equal(body.exchangeRate, null); assert.equal(body.vatRate, null);
  assert.equal(pure.financialMetaBody({ currency: 'RUB', vatMode: 'included', vatRate: 0 }).vatRate, 0);
  assert.throws(() => pure.financialMetaBody({ currency: 'UE' }));
  assert.throws(() => pure.financialMetaBody({ currency: 'USD', confirmedAmountRub: 30326 }));
});
test('C158: переход к оплате одноразовый и сам ничего не записывает', () => {
  pure.requestInvoiceOperation('test-payment');
  assert.equal(pure.takeInvoiceOperation('test-payment'), 'payment');
  assert.equal(pure.takeInvoiceOperation('test-payment'), undefined);
});


test('C158: сетевой retry сохраняет тот же ключ и тело факта; новая форма получает новый ключ', async () => {
  const m = await modules();
  const services = { payers: async () => [{ value: 'payer', label: 'Компания' }], href: () => '#', overview: () => h('div') };
  const invoice = base({ payerCompanyId: 'payer', balanceDue: 100 });
  const form = await m.forms.buildWorkspaceForm(invoice, { operation: 'payment' }, services);
  form.el.querySelector('[name="date"]').value = '2026-09-17';
  form.el.querySelector('[name="amount"]').value = '55';
  const first = form.read().values;
  form.el.querySelector('[name="amount"]').value = '99';
  const retry = form.read().values;
  assert.deepEqual(clean(retry.body), clean(first.body));
  const next = await m.forms.buildWorkspaceForm(invoice, { operation: 'payment' }, services);
  next.el.querySelector('[name="date"]').value = '2026-09-17';
  next.el.querySelector('[name="amount"]').value = '45';
  assert.notEqual(next.read().values.body.clientUid, first.body.clientUid);
});


test('C158: фильтр статей берёт актуальное дерево, родителей и none без своих справочников', async () => {
  const m = await modules(); const expenses = await m.load('sections/expenses.js'); await expenses.evaluate();
  const options = expenses.namespace.articleFilterOptions([{ id: 'parent', name: 'Материалы', children: [{ id: 'child', name: 'Бетон' }] }]);
  assert.deepEqual(clean(options), [{ value: 'none', label: 'Без статьи' }, { value: 'parent', label: 'Материалы' }, { value: 'child', label: 'Материалы → Бетон' }]);
  assert.equal(expenses.namespace.articleFilterOptions([{ id: 'later', name: 'Позже добавленная' }])[1].value, 'later');
  const requests = source('sections/requests.js'), invoices = source('sections/invoices-tab.js');
  assert.match(requests, /key: 'articleId'.*allLabel: 'Все статьи'/);
  assert.match(invoices, /articleId: F.articleId/);
  assert.match(invoices, /Сумма целых отобранных счетов/);
});


test('C158 live-регрессия: UE draft не получает придуманные VATmode/rate при сохранении валюты', async () => {
  const invoice = base({ status: 'draft', payerCompanyId: 'payer' });
  const m = await modules({ invoice });
  const services = { payers: async () => [{ value: 'payer', label: 'Компания' }], contracts: async () => [], href: () => '#', overview: () => h('div') };
  const form = await m.forms.buildWorkspaceForm(invoice, { operation: 'meta' }, services);
  assert.equal(form.el.querySelector('[name="vatMode"]').value, '');
  form.el.querySelector('[name="currency"]').value = 'UE';
  form.el.querySelector('[name="currencyName"]').value = 'Единица по договору';
  const body = form.read().values.body;
  assert.equal(body.currency, 'UE'); assert.equal(body.currencyName, 'Единица по договору');
  assert.equal('vatMode' in body, false); assert.equal('vatRate' in body, false); assert.equal('declaredVatAmount' in body, false);
  assert.equal(m.calls.length, 0);
});
test('C158: включённый/сверху НДС без ставки останавливает форму с ошибкой поля; 0% и none различаются', async () => {
  const invoice = base({ status: 'draft', payerCompanyId: 'payer' }); const m = await modules({ invoice });
  const services = { payers: async () => [{ value: 'payer', label: 'Компания' }], contracts: async () => [], href: () => '#', overview: () => h('div') };
  const form = await m.forms.buildWorkspaceForm(invoice, { operation: 'meta' }, services);
  for (const mode of ['included', 'excluded']) {
    form.el.querySelector('[name="vatMode"]').value = mode;
    assert.match(form.read().errors.vatRate, /Укажите ставку НДС/);
  }
  form.el.querySelector('[name="vatMode"]').value = 'included'; form.el.querySelector('[name="vatRate"]').value = '0';
  const zero = form.read().values.body; assert.equal(zero.vatMode, 'included'); assert.equal(zero.vatRate, 0);
  form.el.querySelector('[name="vatMode"]').value = 'none';
  const none = form.read().values.body; assert.equal(none.vatMode, 'none'); assert.equal('vatRate' in none, false);
  assert.equal(m.calls.length, 0);
});
test('C158: неизменённые финансовые реквизиты не уходят повторно в PATCH', () => {
  const invoice = { currency: 'USD', exchangeRate: 90, exchangeRateDate: '2026-09-17T00:00:00.000Z', exchangeRateSource: 'Банк', confirmedAmountRub: null, vatMode: 'included', vatRate: 22 };
  assert.deepEqual(pure.financialMetaBody({ ...invoice, exchangeRateDate: '2026-09-17', currencyName: '', confirmedAmountRub: '', conversionNote: '', declaredVatAmount: '' }, invoice), {});
});
test('C158: неоценённый валютный долг виден без RUB0, известная оценка подписана и ведёт к счёту', async () => {
  const m = await modules(); let route; m.common.patch = changes => { route = changes; };
  const forecast = await m.load('sections/money-forecast.js'); await forecast.evaluate();
  assert.equal(forecast.namespace.conversionBlock({ count: 0, items: [] }), null);
  const block = forecast.namespace.conversionBlock({ count: 1, items: [{ invoiceId: 'fx', doc: 'Счёт840', currency: 'USD', sourceBalance: 840, balanceDue: null }] });
  assert.match(block.textContent, /Нужен пересчёт/); assert.match(block.textContent, /840,00 USD/); assert.doesNotMatch(block.textContent, /0 ₽/);
  const estimated = forecast.namespace.financeOpRow({ id: 'r', invoiceId: 'fx', title: 'Долг', type: 'expense', amount: 9000, balanceEstimated: true, sourceBalance: 100, currency: 'USD' });
  assert.match(estimated.textContent, /Оценка рублёвого остатка/); assert.match(estimated.textContent, /100,00 USD/);
  estimated.onclick(); assert.deepEqual(clean(route), { of: 'invoicecard', open: 'fx' });
});


test('C158: неоднозначная legacy оплата — сверка, неизвестные суммы не становятся нулём или paid', () => {
  const invoice = base({ status: 'paid', reconciliationRequired: true, reconciliationReason: 'Источники расходятся', paymentState: 'reconciliation', paidAmount: null, balanceDue: null, sourceBalance: null });
  assert.equal(pure.paymentStateLabel(invoice), 'Требует сверки');
  assert.equal(pure.permissions(invoice, rights).unpay, false);
  assert.equal(pure.permissions({ ...invoice, status: 'issued' }, rights).pay, false);
  assert.equal(pure.permissions(invoice, rights).reason, 'Источники расходятся');
  assert.equal(pure.paymentStateLabel({ status: 'paid', reconciliationRequired: true }), 'Требует сверки');
});
test('C159: адресная форма классификации сохраняет payload/UID на retry и пишет только разрешённую аналитику', async () => {
  const row = { id: 'invoice:payment:request', operationId: 'invoice:payment:request', type: 'expense', amount: 33000, date: '2026-11-16', companyName: 'СИЮ', articleId: 'old', classificationEditable: true, classificationVersion: 7 };
  const m = await modules({ call: (path, opts) => path === '/financial-articles' ? { items: [], revision: 2 } : row });
  m.common.orderChoices = async () => [{ value: '', label: 'Без объекта' }];
  const module = await m.load('sections/money-classification.js'); await module.evaluate();
  const panel = module.namespace.moneyClassification;
  assert.equal((await panel.get(row.operationId)).id, row.operationId);
  const form = await panel.form.build(row, { reload() {} });
  form.el.querySelector('[name="reason"]').value = 'Уточнение по первичке';
  form.el.querySelector('[name="articleId"]').value = 'new';
  const first = form.read().values;
  form.el.querySelector('[name="articleId"]').value = 'different-after-network-error';
  assert.deepEqual(clean(form.read().values), clean(first));
  await panel.form.update(row.operationId, first);
  const write = m.calls.find(call => call.method === 'PATCH');
  assert.equal(write.path, '/finance/operations/invoice%3Apayment%3Arequest/classification');
  assert.equal(write.body.articleId, 'new'); assert.equal(write.body.version, 7); assert.ok(write.body.clientUid);
  for (const key of ['amount', 'date', 'companyId', 'paymentId', 'currency']) assert.equal(key in write.body, false);
});


test('C159: подготовка истории — сначала readonly план, отмена не пишет; названия не содержат технических ID', async () => {
  const plan = { version: 1, planHash: 'hash-one', canApply: true, changesCount: 1, totals: { count: 1, amount: 100, currency: 'RUB' }, synthetic: true, items: [{ oldOperationId: 'must-not-be-shown', date: '2026-09-17', amount: 100 }] };
  const m = await modules({ confirm: false, call: () => plan });
  const module = await m.load('sections/money-income-preparation.js'); await module.evaluate();
  const row = { id: 'must-not-be-shown', classificationPreparation: { kind: 'income-payment-identities', sourceId: 'source-secret-id' } };
  const el = module.namespace.incomePreparation(row, { reload() {} });
  assert.equal(m.calls.length, 0);
  await buttonNamed(el, 'Подготовить историю оплат').onclick();
  assert.equal(m.calls.length, 1); assert.equal(m.calls[0].method, 'GET');
  assert.match(el.textContent, /Суммы и даты не изменятся/); assert.doesNotMatch(el.textContent, /must-not-be-shown|source-secret-id|hash-one/);
  await buttonNamed(el, 'Подтвердить подготовку').onclick();
  assert.equal(m.calls.some(call => call.method === 'POST'), false);
});
test('C159: потерянный ответ подготовки повторяет тот же UID/hash/version без повторного подтверждения', async () => {
  const plan = { version: 2, planHash: 'same-plan', canApply: true, changesCount: 1, totals: { count: 1, amount: 100 }, synthetic: false, items: [{ oldOperationId: 'old', date: '2026-09-17', amount: 100 }] };
  let writes = 0, confirmations = 0, route;
  const m = await modules({ call: (path, opts) => { if (opts.method !== 'POST') return plan; if (++writes === 1) throw new Error('offline'); return { identityMapping: { old: 'income:source:stable-payment' } }; } });
  m.common.confirmDlg = async () => { confirmations++; return true; }; m.common.patch = value => { route = value; };
  const module = await m.load('sections/money-income-preparation.js'); await module.evaluate();
  const el = module.namespace.incomePreparation({ operationId: 'old', classificationPreparation: { kind: 'income-payment-identities', sourceId: 'source' } }, { run: async fn => { await fn(); return true; } });
  await buttonNamed(el, 'Подготовить историю оплат').onclick(); await buttonNamed(el, 'Подтвердить подготовку').onclick();
  await buttonNamed(el, 'Повторить подготовку').onclick();
  const posts = m.calls.filter(call => call.method === 'POST'); assert.equal(posts.length, 2); assert.deepEqual(clean(posts[0].body), clean(posts[1].body));
  assert.deepEqual(Object.keys(posts[0].body).sort(), ['clientUid', 'confirm', 'planHash', 'version']); assert.equal(confirmations, 1);
  assert.equal(route.open, 'income:source:stable-payment'); assert.equal(route.of, 'moneyclassification');
});
test('C159:409 подготовки перечитывает план без replay; следующее действие требует нового review/confirm', async () => {
  let reads = 0, writes = 0, confirmations = 0;
  const m = await modules({ call: (path, opts) => { if (opts.method === 'POST') { if (++writes === 1) throw Object.assign(new Error('changed'), { status: 409 }); return { identityMapping: { old: 'stable' } }; } reads++; return { version: reads, planHash: 'hash' + reads, changesCount: 1, canApply: true, totals: { count: 1, amount: 50 }, items: [{ oldOperationId: 'old', date: '2026-09-18', amount: 50 }] }; } });
  m.common.confirmDlg = async () => { confirmations++; return true; }; m.common.patch = () => {};
  const module = await m.load('sections/money-income-preparation.js'); await module.evaluate();
  const el = module.namespace.incomePreparation({ id: 'old', classificationPreparation: { kind: 'income-payment-identities', sourceId: 'source' } }, {});
  await buttonNamed(el, 'Подготовить историю оплат').onclick(); await buttonNamed(el, 'Подтвердить подготовку').onclick();
  assert.equal(reads, 2); assert.equal(writes, 1); assert.match(el.textContent, /План перечитан/);
  await buttonNamed(el, 'Подтвердить подготовку').onclick();
  const posts = m.calls.filter(call => call.method === 'POST'); assert.equal(confirmations, 2); assert.equal(posts[1].body.version, 2); assert.equal(posts[1].body.planHash, 'hash2'); assert.notEqual(posts[0].body.clientUid, posts[1].body.clientUid);
});
test('C159: подготовленная/пустая история и неподдержанная роль не дают нового POST', async () => {
  const m = await modules({ call: () => ({ version: 1, planHash: 'done', changesCount: 0, canApply: false, totals: { count: 0, amount: 0 }, items: [], blockers: [] }) });
  const module = await m.load('sections/money-income-preparation.js'); await module.evaluate();
  const row = { classificationPreparation: { kind: 'income-payment-identities', sourceId: 'source' } };
  const el = module.namespace.incomePreparation(row, { reload() {} }); await buttonNamed(el, 'Подготовить историю оплат').onclick();
  assert.equal(buttonNamed(el, 'Подтвердить подготовку'), undefined); assert.equal(m.calls.some(call => call.method === 'POST'), false);
  m.session.canMoney = false; assert.equal(module.namespace.incomePreparation(row, {}), null); assert.equal(module.namespace.incomePreparation({}, {}), null);
});


test('C159: подтверждённая подготовка плюс ошибка перечитывания повторяет только GET, не materialize', async () => {
  const plan = { version: 1, planHash: 'plan', changesCount: 1, canApply: true, totals: { count: 1, amount: 50 }, items: [{ date: '2026-09-17', amount: 50 }] };
  const m = await modules({ call: (path, opts) => opts.method === 'POST' ? { identityMapping: { stable: 'stable' } } : plan });
  const module = await m.load('sections/money-income-preparation.js'); await module.evaluate();
  let refreshes = 0;
  const el = module.namespace.incomePreparation({ id: 'stable', classificationPreparation: { kind: 'income-payment-identities', sourceId: 'source' } }, { reload: async () => { if (++refreshes === 1) throw new Error('read failed'); } });
  await buttonNamed(el, 'Подготовить историю оплат').onclick(); await buttonNamed(el, 'Подтвердить подготовку').onclick();
  assert.equal(m.calls.filter(call => call.method === 'POST').length, 1);
  await el.querySelector('fail').attrs.retry(); assert.equal(refreshes, 2);
  assert.equal(m.calls.filter(call => call.method === 'POST').length, 1);
});


test('C159: usage только по явному запросу, кэш разделён по usage/type/archive, refresh перечитывает', async () => {
  const m = await modules({ call: () => ({ items: [], revision: 1 }) });
  const module = await m.load('sections/financial-articles.js'); await module.evaluate();
  const load = module.namespace.loadFinancialArticles;
  await load(); await load({ includeUsage: false });
  assert.equal(m.calls.length, 1); assert.equal('includeUsage' in m.calls[0].query, false);
  await load({ includeUsage: true }); assert.equal(m.calls.length, 2); assert.equal(m.calls[1].query.includeUsage, 1);
  await load({ includeUsage: true }); assert.equal(m.calls.length, 2);
  await load({ includeArchived: false }); assert.equal(m.calls.length, 3); assert.equal(m.calls[2].query.includeArchived, 0);
  await load({ type: 'income' }); assert.equal(m.calls.length, 4); assert.equal(m.calls[3].query.type, 'income');
  await load({ refresh: true }); assert.equal(m.calls.length, 5); assert.equal('includeUsage' in m.calls[4].query, false);
});


test('C159: смена group→article обновляет parent placeholder и не назначает первую подходящую группу', async () => {
  const tree = [{ id: 'g', name: 'Своя', nodeKind: 'group', type: 'expense', version: 1 }, { id: 'other', name: 'Другая', nodeKind: 'group', type: 'expense' }, { id: 'income', name: 'Доходная', nodeKind: 'group', type: 'income' }];
  const m = await modules({ call: () => ({ items: tree, revision: 3 }) }); m.context.Event = class {};
  const module = await m.load('sections/dicts-financial-articles.js'); await module.evaluate();
  const fields = await module.namespace.financialDictFields({ id: 'g', version: 1, nodeKind: 'group' }, 'financialArticles', { refs: {} });
  const values = { type: 'expense', nodeKind: 'group' }, subscriptions = new Map();
  const input = { value: '', options: [], replaceChildren(...options) { this.options = options; }, dispatchEvent() {} };
  const api = { input: () => input, get: key => values[key], on: (key, fn) => subscriptions.set(key, fn) };
  fields.find(field => field.key === 'parentId').mount(api);
  assert.equal(input.options[0].attrs.disabled, false); assert.equal(input.value, '');
  values.nodeKind = 'article'; subscriptions.get('nodeKind')();
  assert.equal(input.options[0].attrs.disabled, true); assert.match(input.options[0].textContent, /Выберите родительскую группу/); assert.equal(input.value, '');
  input.value = 'other'; values.type = 'income'; subscriptions.get('type')(); assert.equal(input.value, '');
  assert.equal(input.options.find(option => option.attrs.value === 'income').textContent, 'Доходная');
});


test('C159: категории редактируются только у расходной статьи; скрытие и disabled leaf сохраняют связи', async () => {
  const row = { id: 'leaf', name: 'Статья', type: 'expense', nodeKind: 'article', parentId: 'parent', version: 2, selectable: false, categoryIds: ['saved-cat'] };
  const m = await modules({ call: () => ({ items: [{ id: 'parent', name: 'Группа', nodeKind: 'group', children: [row] }], revision: 4 }) });
  const module = await m.load('sections/dicts-financial-articles.js'); await module.evaluate();
  const fields = await module.namespace.financialDictFields(row, 'financialArticles', { refs: {} });
  const values = { ...row }, field = { hidden: false }, subscriptions = new Map();
  const api = { get: key => values[key], field: () => field, on: (key, fn) => subscriptions.set(key, fn), set: () => { throw new Error('Скрытие поля не должно менять значения'); } };
  fields.find(item => item.key === 'categoryIds').mount(api);
  assert.equal(field.hidden, false); assert.equal(values.selectable, false);
  values.nodeKind = 'group'; subscriptions.get('nodeKind')(); assert.equal(field.hidden, true); assert.deepEqual(values.categoryIds, ['saved-cat']);
  const body = module.namespace.financialArticleBody({ ...values, selectable: 'no', _financialIdentity: { version: 2, expectedTreeRevision: 4 } }); assert.deepEqual(clean(body.categoryIds), ['saved-cat']);
  values.nodeKind = 'article'; values.type = 'income'; subscriptions.get('type')(); assert.equal(field.hidden, true); assert.deepEqual(values.categoryIds, ['saved-cat']);
  values.type = 'expense'; subscriptions.get('type')(); assert.equal(field.hidden, false); assert.deepEqual(values.categoryIds, ['saved-cat']);
});


test('C158: реальная шапка legacy reconciliation — warn вместо paid; одинаковая причина одна, отличающийся НДС сохранён', async () => {
  const invoice = base({ status: 'paid', reconciliationRequired: true, paymentState: 'reconciliation', reconciliationReason: 'Требуется сверка источников', warnings: ['  Требуется   сверка источников ', { message: 'НДС отличается от первички' }] });
  const m = await modules({ invoice }); const stats = m.workspace.invoiceCard.card.headStats(invoice);
  const badge = stats.querySelectorAll('span').find(node => node.textContent === 'Требует сверки');
  assert.ok(badge); assert.equal(badge.attrs.class, 'warn'); assert.doesNotMatch(stats.textContent, /paid|Оплачен/);
  const warnings = pure.invoiceWarnings(invoice, rights);
  assert.equal(warnings.length, 2); assert.equal(warnings[0].tone, 'warn'); assert.match(warnings[1].title, /НДС/);
});
test('C159: runtime отменяет одиночную часть через DELETE с ID/amount/version; multiple удаляет только последнюю', async () => {
  const m = await modules({ call: (path, opts) => ({ id: 'income', version: 4 }) }); m.session.seesDocs = () => false;
  const module = await m.load('sections/orders.js'); await module.evaluate();
  for (const parts of [[{ paymentId: 'p1', amount: 55 }], [{ paymentId: 'p1', amount: 55 }, { paymentId: 'p2', amount: 200 }]]) {
    const row = { id: 'income', version: 3, paidAmount: 255, payments: parts };
    const actions = module.namespace.orders.card.actions(row).filter(Boolean);
    const action = actions.find(action => action.label === (parts.length === 1 ? 'Отменить оплату' : 'Удалить последний платёж'));
    assert.ok(action); if (parts.length > 1) assert.equal(actions.some(action => action.label === 'Отменить оплату'), false);
    let shown; await action.run(row, { setRow: value => { shown = value; } }); assert.equal(shown.version, 4);
    const write = m.calls.at(-1); assert.equal(write.method, 'DELETE'); assert.equal(write.path, '/incomes/income/payments/' + (parts.length - 1));
    assert.deepEqual(clean(write.query), { amount: parts.at(-1).amount, expectedPaymentId: parts.at(-1).paymentId, version: 3 });
  }
  assert.equal(m.calls.some(call => call.method === 'PATCH'), false);
});
test('C159: classified409 и неподготовленная/synthetic история не показывают успешную отмену и не обходят защиту PATCH[]', async () => {
  const m = await modules({ call: () => { throw Object.assign(new Error('classified'), { status: 409 }); } }); m.session.seesDocs = () => false;
  let successes = 0; m.common.toast = () => { successes++; };
  const module = await m.load('sections/orders.js'); await module.evaluate();
  const row = { id: 'income', version: 3, paidAmount: 55, payments: [{ paymentId: 'p1', amount: 55 }] };
  const action = module.namespace.orders.card.actions(row).filter(Boolean).find(action => action.label === 'Отменить оплату');
  await assert.rejects(action.run(row, { setRow() { throw new Error('Не должен обновить показ'); } }), error => error.status === 409 && /Оплата не отменена/.test(error.message));
  assert.equal(successes, 0); assert.equal(m.calls.length, 1); assert.equal(m.calls[0].method, 'DELETE');
  for (const payments of [[], [{ amount: 55 }]]) await assert.rejects(module.namespace.removeIncomePayment({ id: 'legacy', version: 0, paidDate: '2026-09-17', payments }), /Сначала подготовьте историю оплат/);
  assert.equal(m.calls.length, 1);
});


test('C159: legacy empty object link читает все заказы, без ложной заглушки выбора', async () => {
  const m = await modules({ call: () => ({ head: { totals: { income: 0, expense: 0 } }, unassigned: null }) });
  m.common.segmented = () => ({ el: h('div') }); m.common.toolbar = () => h('div');
  const module = await m.load('sections/money-articles.js'); await module.evaluate();
  module.namespace.articlesView({ year: '2026', org: 'all', mode: 'object', filters: { from: '2026-11-01', to: '2026-11-19' } });
  await tick();
  const read = m.calls.find(call => call.path === '/finance/by-articles'); assert.ok(read); assert.equal(read.query.mode, 'company'); assert.equal(read.query.salesOrderId, undefined);
});


test('C159: known synthetic source отменяется только versioned paidDate clear; array1/несколько остаются DELETE, classified synthetic readonly', async () => {
  const m = await modules({ call: () => ({ id: 'income', version: 5, payments: [] }) }); m.session.seesDocs = () => false;
  const module = await m.load('sections/orders.js'); await module.evaluate();
  const cases = [
    { row: { id: 'income', version: 4, paidDate: '2026-11-01', paidAmount: 100, legacyPaymentMetadata: { paymentId: 'legacy-id' }, payments: [{ paymentId: 'legacy-id', amount: 100 }] }, method: 'PATCH' },
    { row: { id: 'income', version: 4, paidDate: '2026-11-01', paidAmount: 100, payments: [{ paymentId: 'real-part', amount: 100 }] }, method: 'DELETE' },
    { row: { id: 'income', version: 4, paidAmount: 100, payments: [{ paymentId: 'part1', amount: 25 }, { paymentId: 'part2', amount: 75 }] }, method: 'DELETE' },
  ];
  for (const { row, method } of cases) {
    const action = module.namespace.orders.card.actions(row).filter(Boolean).find(action => action.label === (row.payments.length === 1 ? 'Отменить оплату' : 'Удалить последний платёж'));
    let shown; await action.run(row, { setRow: value => { shown = value; } }); assert.equal(shown.version, 5);
    const write = m.calls.at(-1); assert.equal(write.method, method);
    if (method === 'PATCH') { assert.equal(write.path, '/incomes/income'); assert.deepEqual(clean(write.body), { paidDate: '', version: 4 }); }
    else { assert.equal(write.query.expectedPaymentId, row.payments.at(-1).paymentId); assert.equal(write.query.version, 4); }
  }
  const initialWrites = m.calls.length;
  for (const metadata of [{ classificationHistory: [{ reason: 'Уточнение' }] }, { classificationOverride: { articleId: 'other' } }]) {
    const row = { ...cases[0].row, legacyPaymentMetadata: { paymentId: 'legacy-id', ...metadata } };
    await assert.rejects(module.namespace.removeIncomePayment(row), error => error.status === 409 && /Оплата не отменена/.test(error.message));
  }
  assert.equal(m.calls.length, initialWrites); assert.equal(m.calls.some(write => write.body && 'payments' in write.body), false);
});
