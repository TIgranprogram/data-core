// node --experimental-vm-modules --test backend/pwa/sections/request-step.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { invoiceMergeData } from '../fixtures/invoice-merge-data.mjs';

// Лёгкий DOM-адаптер: тестируем настоящий компонент и его onOk, не копируем бизнес-сценарий.
function h(tag, attrs = {}, ...children) {
  return { tag, attrs: attrs || {}, children: children.flat().filter((x) => x != null && x !== false), value: attrs?.value || '', dataset: attrs?.dataset || {}, listeners: {},
    addEventListener(k, fn) { this.listeners[k] = fn; }, closest() { return null; },
    replaceChildren(...kids) { this.children = kids.flat().filter((x) => x != null && x !== false); }, replaceWith(node) { this.replacement = node; } };
}
const text = (node) => node == null ? '' : typeof node !== 'object' ? String(node) : node.children.map(text).join(' ');
const find = (node, predicate) => { if (!node || typeof node !== 'object') return null; if (predicate(node)) return node; for (const x of node.children) { const got = find(x, predicate); if (got) return got; } return null; };
const tick = () => new Promise((r) => setImmediate(r));

async function component({ failPost = false, canMoney = true, paid = false, received = false, failLoad = false, normalSave = false } = {}) {
  const data = invoiceMergeData(), calls = [], dialogs = [], routes = [], failures = [];
  if (paid) { data.source.status = 'paid'; data.source.paymentSnapshot = { amount: 250, paidAt: '2026-10-30' }; data.source.paymentAdjustments = [{ at: '2026-11-01', reason: 'Уточнение цены', delta: 50 }]; }
  if (received) data.source.requests[0].status = 'received';
  const api = async (path, opts = {}) => {
    calls.push({ path, ...opts, method: opts.method || 'GET' });
    if (path === '/incomes/lookups') return { companies: [{ id: 'payer', name: 'Тестовая компания' }] };
    if (opts.method === 'PATCH') {
      if (opts.body.duplicateReason || normalSave || path.includes('/lines/') || (opts.body.issue && !opts.body.no)) return { ...data.source, ...opts.body };
      throw Object.assign(new Error('Такой счёт уже есть'), { status: 409, data: { existingInvoiceId: 'target', existingNo: '102', existingStatus: 'issued' } });
    }
    if (opts.method === 'POST') { if (failPost) throw Object.assign(new Error('Нет связи с сервером'), { status: 0 }); return { targetInvoiceId: 'target' }; }
    if (failLoad) throw Object.assign(new Error('Нет связи с сервером'), { status: 0 });
    if (path === '/supply/requests/a') return data.source.requests[0];
    if (path.endsWith('/merge-preview')) return data.preview;
    return path.endsWith('/source') ? data.source : data.target;
  };
  const lk = () => Promise.resolve({}); lk.reset = () => {};
  const kit = {
    attachCombo() {}, modal: (cfg) => new Promise((resolve) => dialogs.push({ cfg, resolve })), toast() {}, toastError(e) { failures.push(e); },
    button: ({ label, onClick }) => h('button', { onclick: onClick }, label), actions: (...kids) => h('actions', {}, ...kids),
    row: ({ title, meta, side }) => h('row', {}, title, meta, side), section: ({ title, count, body }) => h('section', {}, title, count, body),
    badge: (_map, key) => h('badge', {}, key), INVOICE_STATUS: {}, busyBlock: (what) => h('busy', {}, what), failBlock: (e, retry) => h('fail', { retry }, e.message),
  };
  const mocks = {
    '../core/api.js': { api, PREFIX: '', session: { canEdit: true, canMoney } }, '../core/dom.js': { h },
    '../core/format.js': { isoDay: () => '2026-11-01', money: (n) => String(n ?? 0), date: (v) => String(v || '') },
    '../ui/photos.js': { photoField: () => ({ el: h('files'), ids: () => [] }) }, '../core/router.js': { patch: (route) => routes.push(route) },
    '../ui/badges.js': { SUPPLY_STATUS: {}, supplyKey: (r) => r.status }, '../ui/kit/index.js': kit,
    './lookups.js': { lookups: lk, unitList: () => [] }, './contracts.js': { canContract: () => false, contractField() {}, contractView: () => h('contract'), showWarnings() {} },
  };
  const root = new SourceTextModule(readFileSync(new URL('./request-step.js', import.meta.url), 'utf8'));
  await root.link(async (specifier) => {
    if (specifier === '../core/invoice-merge.js') return new SourceTextModule(readFileSync(new URL('../core/invoice-merge.js', import.meta.url), 'utf8'));
    const exports = mocks[specifier]; assert.ok(exports, `Неизвестный импорт: ${specifier}`);
    return new SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); });
  });
  await root.evaluate();
  const nextDialog = async () => { for (let i = 0; i < 20; i++) { if (dialogs.length) return dialogs.shift(); await tick(); } assert.fail('Окно не показано'); };
  return { ...data, ui: root.namespace, calls, routes, failures, nextDialog, posts: () => calls.filter((x) => x.method === 'POST') };
}

test('409 сам не мутирует: выбор → GET → видимый preview → один явный POST', async () => {
  const c = await component(), run = c.ui.patchInvoiceWithDuplicate(c.source, { no: '102' });
  const choose = await c.nextDialog();
  assert.match(text(choose.cfg.body), /Тестовый поставщик/); assert.match(text(choose.cfg.body), /issued/);
  assert.equal(c.posts().length, 0); choose.resolve('merge');
  const preview = await c.nextDialog();
  assert.match(text(preview.cfg.body), /Источник/); assert.match(text(preview.cfg.body), /Цель/);
  assert.match(text(preview.cfg.body), /Гайка М8/); assert.match(text(preview.cfg.body), /800/);
  assert.equal(c.posts().length, 0); assert.ok(c.calls.some((x) => x.path.endsWith('/merge-preview')));
  const strategy = find(preview.cfg.body, (x) => x.tag === 'select'); strategy.value = 'replaceLines'; strategy.listeners.change();
  assert.match(text(preview.cfg.body), /Будут убраны из целевого счёта/); assert.match(text(preview.cfg.body), /Шайба М8/);
  const selected = preview.cfg.onOk(); preview.resolve(selected); preview.resolve(selected); // двойное подтверждение одного Promise
  assert.equal(await run, null); assert.equal(c.posts().length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(c.posts()[0].body)), { targetId: 'target', strategy: 'replaceLines' });
  assert.equal(c.posts()[0].noWait, true); assert.equal(c.routes[0].open, 'target');
});

for (const phase of ['choice', 'preview']) test(`отмена ${phase}: ни merge, ни duplicateReason`, async () => {
  const c = await component(), run = c.ui.patchInvoiceWithDuplicate(c.source, { no: '102' });
  const choose = await c.nextDialog();
  if (phase === 'choice') choose.resolve(null);
  else { choose.resolve('merge'); (await c.nextDialog()).resolve(null); }
  assert.equal(await run, null); assert.equal(c.posts().length, 0); assert.equal(c.routes.length, 0);
  assert.equal(c.calls.filter((x) => x.method === 'PATCH').length, 1); // только исходный отвергнутый PATCH
});

test('POST network error: retry перечитывает preview, не повторяет merge до нового подтверждения', async () => {
  const c = await component({ failPost: true }), run = c.ui.patchInvoiceWithDuplicate(c.source, { no: '102' });
  (await c.nextDialog()).resolve('merge'); (await c.nextDialog()).resolve('append');
  const error = await c.nextDialog(); assert.match(text(error.cfg.body), /результат неизвестен/); assert.equal(c.posts().length, 1);
  error.resolve(true); const again = await c.nextDialog(); assert.equal(c.posts().length, 1);
  again.resolve(null); await run; assert.equal(c.posts().length, 1); assert.equal(c.routes.length, 0);
});

test('duplicateReason остаётся доступным и сохраняется точным PATCH без merge', async () => {
  const c = await component(), run = c.ui.patchInvoiceWithDuplicate(c.source, { no: '102', date: '2026-11-01' });
  (await c.nextDialog()).resolve('new'); const why = await c.nextDialog();
  assert.throws(() => why.cfg.onOk(), /Укажите причину/);
  find(why.cfg.body, (x) => x.tag === 'input').value = '  Отдельная поставка  ';
  why.resolve(why.cfg.onOk()); assert.equal((await run).duplicateReason, 'Отдельная поставка');
  assert.equal(c.posts().length, 0); assert.equal(c.calls.filter((x) => x.method === 'PATCH')[1].body.duplicateReason, 'Отдельная поставка');
});

test('выбор «открыть» остаётся read-only', async () => {
  const c = await component(), run = c.ui.patchInvoiceWithDuplicate(c.source, { no: '102' });
  const choose = await c.nextDialog(); choose.resolve(choose.cfg.onOk({ dataset: {} })); await run;
  assert.equal(c.posts().length, 0); assert.equal(c.routes[0].open, 'target');
});

test('обычное сохранение с причиной — один PATCH, без merge-сценария', async () => {
  const c = await component();
  assert.equal((await c.ui.patchInvoiceWithDuplicate(c.source, { no: '102', duplicateReason: 'Одобренный отдельный счёт' })).no, '102');
  assert.equal(c.calls.length, 1); assert.equal(c.posts().length, 0);
});

test('шаг оплаты: отмена дубликата не меняет сумму строки и не оплачивает', async () => {
  const c = await component(), run = c.ui.reqStep.form.update('a', { _inv: 'source', _line: 400, no: '102', date: '2026-11-01', payerCompanyId: 'payer' });
  const rejection = assert.rejects(run, /Перевод и оплата не выполнены/);
  (await c.nextDialog()).resolve('merge'); (await c.nextDialog()).resolve(null);
  await rejection; assert.equal(c.calls.filter((x) => x.path.includes('/lines/')).length, 0); assert.equal(c.posts().length, 0);
});

test('шаг оплаты без дубликата: реквизиты → итог строки → выставление → оплата', async () => {
  const c = await component({ normalSave: true });
  const saved = await c.ui.reqStep.form.update('a', { _inv: 'source', _line: 400, no: '102', date: '2026-11-01', payerCompanyId: 'payer' });
  assert.equal(saved.id, 'a');
  assert.deepEqual(c.calls.map((x) => x.path), ['/supply/invoices/source', '/supply/invoices/source/lines/a', '/supply/invoices/source', '/supply/invoices/source/pay', '/supply/requests/a']);
  assert.equal(c.calls[1].body.lineAmount, 400); assert.deepEqual(JSON.parse(JSON.stringify(c.calls[2].body)), { issue: true });
});

test('paid snapshot отличается от текущей суммы; paid редактируется до первой приёмки, без повторной оплаты', async () => {
  const c = await component({ paid: true }), box = c.ui.invoiceBlock({ invoiceId: 'source' }, {}); await tick();
  assert.match(text(box), /Фактически оплачено: 250/); assert.match(text(box), /Текущая сумма строк: 300/);
  assert.match(text(box), /Уточнение цены/); assert.match(text(box), /до первой приёмки/);
  assert.equal(find(box, (x) => x.tag === 'button' && text(x) === 'Счёт оплачен'), null);
  assert.equal(c.posts().length, 0);
});

test('финансовая блокировка после приёмки и скрытие snapshot без money остаются', async () => {
  const c = await component({ paid: true, received: true, canMoney: false }), box = c.ui.invoiceBlock({ invoiceId: 'source' }, {}); await tick();
  assert.match(text(box), /финансовые поля зафиксированы/); assert.doesNotMatch(text(box), /Фактически оплачено/);
});

test('ошибка загрузки invoiceBlock даёт общий failBlock с read-only retry', async () => {
  const c = await component({ failLoad: true }), box = c.ui.invoiceBlock({ invoiceId: 'source' }, {}); await tick();
  const failure = find(box, (x) => x.tag === 'fail'); assert.ok(failure); assert.equal(typeof failure.attrs.retry, 'function');
  failure.attrs.retry(); await tick(); assert.equal(c.posts().length, 0);
});
