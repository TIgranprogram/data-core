// node --test backend/pwa/core/invoice-merge.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadInvoiceMerge, mergeInvoiceWithPreview, sameInvoiceLine } from './invoice-merge.js';
import { invoiceMergeData } from '../fixtures/invoice-merge-data.mjs';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function harness({ postError, getError } = {}) {
  const data = invoiceMergeData(), calls = [];
  const request = async (path, opts = {}) => {
    calls.push({ path, ...opts, method: opts.method || 'GET' });
    if (opts.method === 'POST') { if (postError) throw postError; return { targetInvoiceId: 'target', moved: 2 }; }
    if (getError) throw getError;
    if (path.endsWith('/merge-preview')) return data.preview;
    return path.endsWith('/source') ? data.source : data.target;
  };
  return { data, calls, request, posts: () => calls.filter((x) => x.method === 'POST') };
}

test('GET до подтверждения; ровно один POST с выбранными targetId/strategy/noWait', async () => {
  const h = harness(), choice = deferred(), seen = deferred();
  const run = mergeInvoiceWithPreview(h.request, 'source', 'target', { confirm: (p) => { seen.resolve(p); return choice.promise; }, retry: () => false });
  const p = await seen.promise;
  assert.deepEqual(h.calls.map((x) => x.method), ['GET', 'GET', 'GET']);
  assert.equal(h.calls[0].path, '/supply/invoices/source/merge-preview');
  assert.deepEqual(h.calls[0].query, { targetId: 'target' });
  assert.deepEqual(p.plans.mergeSameRequest.moved.map((x) => x.id), ['b']);
  assert.deepEqual(p.plans.mergeSameRequest.skipped.map((x) => x.id), ['a']);
  assert.deepEqual(p.plans.replaceLines.replaced.map((x) => x.id), ['c', 'd']);
  assert.equal(h.posts().length, 0);
  choice.resolve('mergeSameRequest');
  assert.equal((await run).targetInvoiceId, 'target');
  assert.deepEqual(h.posts(), [{ path: '/supply/invoices/source/merge', method: 'POST', noWait: true, body: { targetId: 'target', strategy: 'mergeSameRequest' } }]);
});

for (const strategy of ['append', 'replaceLines']) test(`явное подтверждение стратегии ${strategy}`, async () => {
  const h = harness();
  await mergeInvoiceWithPreview(h.request, 'source', 'target', { confirm: () => strategy, retry: () => false });
  assert.equal(h.posts().length, 1); assert.equal(h.posts()[0].body.strategy, strategy);
});

test('отмена preview — только GET, без мутаций', async () => {
  const h = harness();
  assert.equal(await mergeInvoiceWithPreview(h.request, 'source', 'target', { confirm: () => null, retry: () => false }), null);
  assert.equal(h.posts().length, 0);
});

test('ошибка GET и отмена — без подтверждения и POST', async () => {
  const err = new Error('Нет связи'), h = harness({ getError: err });
  assert.equal(await mergeInvoiceWithPreview(h.request, 'source', 'target', { confirm: () => assert.fail('preview недоступен'), retry: (e, sent) => { assert.equal(e, err); assert.equal(sent, false); return false; } }), null);
  assert.equal(h.posts().length, 0);
});

test('ошибка POST → новый GET и новое подтверждение; отмена не повторяет POST', async () => {
  const err = Object.assign(new Error('Нет связи'), { status: 0 }), h = harness({ postError: err });
  const again = deferred(), shown = deferred(); let confirms = 0;
  const run = mergeInvoiceWithPreview(h.request, 'source', 'target', {
    confirm: () => { if (++confirms === 1) return 'append'; shown.resolve(); return again.promise; },
    retry: (e, sent) => { assert.equal(e, err); assert.equal(sent, true); return true; },
  });
  await shown.promise;
  assert.deepEqual(h.calls.map((x) => x.method), ['GET', 'GET', 'GET', 'POST', 'GET', 'GET', 'GET']);
  assert.equal(h.posts().length, 1);
  again.resolve(null); assert.equal(await run, null); assert.equal(h.posts().length, 1);
});

test('отказ API при paid/received показан, не повторён без действия пользователя', async () => {
  const err = Object.assign(new Error('Оплаченные счета нельзя объединять'), { status: 400 }), h = harness({ postError: err });
  assert.equal(await mergeInvoiceWithPreview(h.request, 'source', 'target', { confirm: () => 'append', retry: (e, sent) => { assert.equal(e, err); assert.equal(sent, true); return false; } }), null);
  assert.equal(h.posts().length, 1);
});

test('разошедшиеся или частично видимые строки — fail closed', async () => {
  const h = harness(); h.data.source.requests[0].qty = 11;
  await assert.rejects(loadInvoiceMerge(h.request, 'source', 'target'), /Обновите предпросмотр/);
  const partial = harness(); partial.data.target.partial = true;
  await assert.rejects(loadInvoiceMerge(partial.request, 'source', 'target'), /Обновите предпросмотр/);
});

test('правило дублей — materialId, количество и итог строки; без материала — точное название', () => {
  assert.equal(sameInvoiceLine({ materialId: 'x', title: 'а', qty: 3, priceHint: 100 }, { materialId: 'x', title: 'б', qty: 3, priceHint: 100 }), true);
  assert.equal(sameInvoiceLine({ materialId: 'x', qty: 3, priceHint: 100 }, { materialId: 'x', qty: 3, priceHint: 99.99 }), false);
  assert.equal(sameInvoiceLine({ title: 'а', qty: 3, priceHint: 100 }, { materialName: 'а', qty: 3, priceHint: 100 }), true);
});

test('настоящий api noWait не делает сетевой автоповтор merge', async () => {
  const originalFetch = globalThis.fetch, originalLocation = globalThis.location;
  globalThis.location = { pathname: '/app/' }; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('Failed to fetch'); };
  try {
    const { api } = await import('./api.js');
    await assert.rejects(api('/supply/invoices/source/merge', { method: 'POST', noWait: true, body: { targetId: 'target', strategy: 'append' } }), /Нет связи/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation; }
});
