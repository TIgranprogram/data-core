import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const pure = await import('data:text/javascript;base64,' + Buffer.from(source('./sales-legal-state.js')).toString('base64'));
const clean = (v) => JSON.parse(JSON.stringify(v));
const bare = (file) => source(file).replace(/^import [\s\S]*? from '[^']+';\r?\n/gm, '').replace(/^export /gm, '');
const base = () => ({ id: 'contract1', legalVersion: 7, legal: { state: 'draft', currency: 'RUB', gross: 2061000, sourceDate: '2026-11-18', companySnapshot: { name: 'ССЮ', inn: '2312308098' }, objectAddress: null, signature: { state: 'unknown' }, paymentVerification: 'unknown', documents: [{ uid: 'original', fileId: 'a'.repeat(24), sourceSha256: 'b'.repeat(64), at: '2026-11-20T07:00:00.000Z' }], issues: [], paymentPlan: [] } });

function harness() {
  const writes = [], panels = [], events = [];
  let fail = null;
  let seed = 0;
  const sandbox = vm.createContext({
    ...pure, JSON, Error, Number, String, Date, crypto: { subtle: { digest: async () => new Uint8Array(32) } },
    session: { canEditOrders: true, canMoney: true }, newKey: () => 'uid' + (++seed),
    document: { querySelectorAll: () => [{}] },
    h: (tag, attrs, ...children) => ({ tag, attrs, children }),
    stack: (...children) => ({ children }), fileButton: (cfg) => cfg,
    date: (v) => v, dateTime: (v) => v, money: (v) => v,
    toast: (v) => events.push(v), toastError() {},
    api: async (path, body) => { writes.push({ path, ...body }); if (fail) throw fail; return {}; },
    uploadPhoto: async () => { throw new Error('unknown upload result'); },
    openCard: (panel, _opts, ctx) => { panels.push({ panel, ctx }); return panel; },
  });
  vm.runInContext(bare('./sales-legal.js') + '\nglobalThis.subject={editLegal,addDocument};', sandbox);
  return { sandbox, subject: sandbox.subject, writes, panels, events, fail: (error) => { fail = error; } };
}

test('unknown numbers stay absent; zero is explicit; invalid amounts are rejected', () => {
  for (const value of ['', null, undefined]) assert.equal(pure.optionalNumber(value), undefined);
  assert.equal(pure.optionalNumber('0'), 0);
  assert.equal(pure.optionalNumber('12,50'), 12.5);
  for (const value of ['abc', '-1', Infinity]) assert.throws(() => pure.optionalNumber(value));
});

test('excluded offer item remains in source amount, agreed sum counts included rows once', () => {
  const items = [{ quantity: 1, unitPrice: 2061000 }, { quantity: 1, unitPrice: 1070000, scopeState: 'excluded' }];
  assert.deepEqual(pure.offerTotals(items), { source: 3131000, agreed: 2061000 });
  assert.equal(items.length, 2);
});

test('review update preserves identity and the unrelated source/history', () => {
  const old = [{ uid: 'a', state: 'unknown' }, { uid: 'b', state: 'conflict' }];
  const next = pure.replaceByUid(old, { uid: 'a', state: 'resolved' });
  assert.equal(next.length, 2); assert.equal(next[1], old[1]); assert.equal(old[0].state, 'unknown');
});

test('legal edit sends empty unknown date/address, fixed source snapshot and original, stable UID/CAS', async () => {
  const h = harness(), record = base(), initial = clean(record);
  h.subject.editLegal('salesorders', record, {});
  const form = h.panels[0].panel.form;
  const values = { objectAddress: '', state: 'draft', signature: 'unknown', signedDate: '', deliveryTerms: '', deadlineTerms: '' };
  await form.create(values); await form.create(values);
  assert.equal(h.writes.length, 2);
  const [a, b] = h.writes.map((x) => x.body);
  assert.equal(a.clientUid, b.clientUid); assert.equal(a.version, 7);
  assert.equal(a.legal.objectAddress, null); assert.equal(a.legal.signature.signedDate, null);
  assert.equal(a.legal.sourceDate, initial.legal.sourceDate);
  assert.deepEqual(clean(a.legal.documents), initial.legal.documents);
  assert.deepEqual(clean(a.legal.companySnapshot), initial.legal.companySnapshot);
  assert.deepEqual(record, initial);
});

test('409 stops this editor; changed input never overwrites a newer version', async () => {
  const h = harness(); h.fail(Object.assign(new Error('conflict'), { status: 409 }));
  h.subject.editLegal('offers', base(), {});
  const form = h.panels[0].panel.form;
  await assert.rejects(form.create({ objectAddress: 'Адрес', state: 'draft', signature: 'unknown' }));
  await assert.rejects(form.create({ objectAddress: 'Другой адрес', state: 'draft', signature: 'unknown' }), /обновите карточку/);
  assert.equal(h.writes.length, 1);
});

test('role without money cannot open legal mutation or original upload', () => {
  const h = harness(); h.sandbox.session.canMoney = false;
  h.subject.editLegal('salesorders', base(), {}); h.subject.addDocument('salesorders', base(), {});
  assert.equal(h.panels.length, 0); assert.equal(h.writes.length, 0);
});

test('unknown PDF upload result blocks retry, rather than uploading the same file again', async () => {
  const h = harness(); h.subject.addDocument('salesorders', base(), {});
  const form = h.panels[0].panel.form;
  const widget = form.fields().find((x) => x.key === '_file').widget();
  const picker = widget.el.children[0];
  picker.onFile({ name: 'Договор.pdf', arrayBuffer: async () => new ArrayBuffer(1) });
  await assert.rejects(form.create({ kind: 'contract', revision: '1' }), /Повтор отключён/);
  await assert.rejects(form.create({ kind: 'contract', revision: '1' }), /неизвестен/);
  assert.equal(h.writes.length, 0);
});

test('offer write projection preserves source scope/exclusion and drops computed read fields', () => {
  const sandbox = vm.createContext({ ...pure, session: {} });
  vm.runInContext(bare('./offer-source.js') + '\nglobalThis.project=offerWriteItems;', sandbox);
  const line = { productName: 'Комплекс', quantity: 1, unitPrice: 1070000, total: 1070000, sourceRowKey: '6', sourceLine: { title: 'Спортивный комплекс' }, scopeState: 'excluded', exclusionReason: 'Решение владельца', exclusionEventDate: null, matchStatus: 'unmatched', _id: 'read-only' };
  const result = clean(sandbox.project([line]))[0];
  assert.equal(result.scopeState, 'excluded'); assert.equal(result.exclusionEventDate, null);
  assert.equal(result.sourceLine.title, 'Спортивный комплекс'); assert.equal(result.sourceRowKey, '6');
  assert.equal('total' in result, false); assert.equal('_id' in result, false);
});

test('manual draft has unknown manager tasks but no invented date, amount, production group or payment', () => {
  const draft = pure.manualLegalDraft({ orderNo: '18/11/45' });
  assert.equal(draft.sourceNumber, '18/11/45');
  assert.equal('sourceDate' in draft, false); assert.equal('gross' in draft, false);
  assert.equal(draft.paymentVerification, 'unknown'); assert.equal(draft.signature.state, 'unknown');
  assert.equal(draft.documents.length, 0); assert.equal(draft.paymentPlan.length, 0);
  assert.equal(draft.issues.some((x) => x.field === 'objectAddress' && x.state === 'unknown'), true);
  assert.equal('productionNo' in draft, false); assert.equal('payments' in draft, false);
  assert.equal(pure.manualLegalDraft({ contractDate: '2026-11-18' }).sourceDate, '2026-11-18');
});


test('nested offer actions expose callable kit fields, preserve exclusion evidence and leave event date unknown', async () => {
  const panels = [], writes = [];
  const sandbox = vm.createContext({
    ...pure, session: { canEditOrders: true, canMoney: true },
    document: { querySelectorAll: () => [{}] }, isoDay: () => '2026-11-20', newKey: () => 'link-uid',
    openCard: (panel) => { panels.push(panel); return panel; },
    api: async (path, options) => { if (!options?.method) return { items: [{ id: 'contract1', companyId: 'company1' }] }; writes.push({ path, ...options }); return { id: 'offer1' }; },
  });
  vm.runInContext(bare('./offer-source.js') + '\nglobalThis.subject={scopeItem,linkOfferContract};', sandbox);
  const record = { id: 'offer1', companyId: 'company1', legalVersion: 7, legal: {}, items: [{ productName: 'Строка 6', quantity: 1, unitPrice: 1070000, sourceRowKey: '6' }] };
  sandbox.subject.scopeItem(record, 0, {});
  const scope = panels[0];
  assert.equal(scope.newTitle, 'Исключить из согласованного состава');
  assert.equal(typeof scope.form.fields, 'function');
  assert.deepEqual(clean(scope.form.fields().filter((x) => x.key).map((x) => x.key)), ['reason', 'confirmedAt', 'eventDate']);
  assert.equal(scope.form.initial().eventDate, '');
  await scope.form.create({ reason: 'Решение владельца', confirmedAt: '2026-11-20', eventDate: '' });
  const item = writes[0].body.items[0];
  assert.equal(item.exclusionReason, 'Решение владельца');
  assert.equal(item.exclusionConfirmedAt, '2026-11-20');
  assert.equal(item.exclusionEventDate, null);
  assert.equal(item.scopeState, 'excluded');
  assert.equal(writes[0].body.version, 7);
  assert.equal(record.items[0].scopeState, undefined);
  await sandbox.subject.linkOfferContract(record, {});
  assert.equal(typeof panels[1].form.fields, 'function');
  assert.equal(panels[1].form.fields()[1].key, 'orderId');
  const legal = harness(); legal.subject.editLegal('offers', base(), {});
  assert.equal(typeof legal.panels[0].panel.form.fields, 'function');
  assert.ok(legal.panels[0].panel.form.fields().some((x) => x.key === 'objectAddress'));
});


// Исполняем тот же обработчик сохранения kit, включая toBody, ошибки и закрытие панели.
async function submitThroughKit(panel, values, panelCtx = {}) {
  const card = source('../ui/kit/card.js');
  const start = card.indexOf('save.onclick = async () => {');
  const end = card.indexOf('\n    // readonly:', start);
  const errors = [], changed = [], closed = [];
  const sandbox = vm.createContext({
    section: panel, form: { read: () => ({ values }) }, id: 'new.fixture', row: null, isNew: true,
    save: { disabled: false }, cancel: {}, err: {}, body: { querySelectorAll: () => [] },
    saving: false, busyBtn: () => () => {}, reportError: (e) => errors.push(e),
    isFailure: () => false, errText: (e) => e.message,
    ctx: { changed: () => { changed.push(true); panelCtx.changed?.(); }, close: () => { closed.push(true); panelCtx.close?.(); } },
    window: { dispatchEvent() {} }, CustomEvent: class {}, destroy() {},
  });
  vm.runInContext(card.slice(start, end) + '\nglobalThis.submit=save.onclick;', sandbox);
  await sandbox.submit();
  assert.deepEqual(errors.map((e) => e.message), [], 'настоящий kit submit не должен ловить ошибку до API');
  assert.equal(changed.length, 1); assert.equal(closed.length, 1);
}

test('kit save promise submits exclusion, existing-contract link and legal edit through toBody', async () => {
  const panels = [], contexts = [], writes = [];
  let reloaded = 0; const parentCtx = { reload: async () => { reloaded++; }, changed() {} };
  const sandbox = vm.createContext({
    ...pure, session: { canEditOrders: true, canMoney: true },
    document: { querySelectorAll: () => [{}] }, isoDay: () => '2026-11-20', newKey: () => 'link-uid',
    openCard: (panel, _opts, ctx) => { panels.push(panel); contexts.push(ctx); return panel; },
    api: async (path, options) => { if (!options?.method) return { items: [{ id: 'contract1', companyId: 'company1' }] }; writes.push({ path, ...options }); return { id: 'offer1' }; },
  });
  vm.runInContext(bare('./offer-source.js') + '\nglobalThis.subject={scopeItem,linkOfferContract};', sandbox);
  const record = { id: 'offer1', companyId: 'company1', legalVersion: 7, legal: {}, items: [{ productName: 'Строка 6', quantity: 1, unitPrice: 1070000, sourceRowKey: '6' }] };
  sandbox.subject.scopeItem(record, 0, parentCtx);
  await submitThroughKit(panels[0], { reason: 'Решение владельца', confirmedAt: '2026-11-20', eventDate: '' }, contexts[0]);
  assert.equal(writes[0].body.items[0].scopeState, 'excluded');
  assert.equal(writes[0].body.items[0].exclusionReason, 'Решение владельца');
  assert.equal(writes[0].body.items[0].exclusionConfirmedAt, '2026-11-20');
  assert.equal(writes[0].body.items[0].exclusionEventDate, null);
  await sandbox.subject.linkOfferContract(record, parentCtx);
  await submitThroughKit(panels[1], { orderId: 'contract1' }, contexts[1]);
  assert.equal(reloaded, 2);
  assert.equal(writes[1].body.orderId, 'contract1');
  const legal = harness(); legal.subject.editLegal('salesorders', base(), parentCtx);
  await submitThroughKit(legal.panels[0].panel, { objectAddress: 'Уточнённый адрес', state: 'draft', signature: 'unknown', signedDate: '' }, legal.panels[0].ctx);
  assert.equal(reloaded, 3);
  assert.equal(legal.writes[0].body.legal.objectAddress, 'Уточнённый адрес');
});
