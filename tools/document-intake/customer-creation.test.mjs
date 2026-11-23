import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { analyze, getDraft } from './analysis.mjs';
import { ensureSalesCustomer, resolveSalesParties, decideInvoice } from './api.mjs';
import { prepareBatch, sendBatch } from './delivery.mjs';
import { IntakeError, openRoot, sha256 } from './store.mjs';

const seller = { id: '111111111111111111111111', name: 'ООО Альфа', inn: '7707083893', isOurCompany: true };
const buyer = { id: '222222222222222222222222', name: 'ООО Бета', inn: '7702070139', isOurCompany: false, type: ['customer'] };
const list = items => ({ items, total: items.length, page: 1, limit: 100 });
const id = n => n.toString(16).padStart(24, '0');

function fixture(number) {
  const header = `Договор № ${number}`;
  const date = 'Дата: 20.11.2026';
  const sellerQuote = `Поставщик ${seller.name} ИНН ${seller.inn}`;
  const buyerQuote = `Покупатель ${buyer.name} ИНН ${buyer.inn}`;
  const line = 'Урна 2 шт 50,00 100,00';
  const total = 'Всего 100,00 руб.';
  const vat = 'Без НДС';
  const quote = text => ({ page: 1, quote: text });
  const fact = (value, text) => ({ value, ...quote(text) });
  return { pages: [[header, date, sellerQuote, buyerQuote, line, total, vat].join('\n')], raw: {
    kind: 'contract', kindEvidence: quote(header), number: fact(number, header), date: fact('2026-11-20', date),
    seller: { name: seller.name, inn: seller.inn, ...quote(sellerQuote) }, buyer: { name: buyer.name, inn: buyer.inn, ...quote(buyerQuote) },
    currency: fact('RUB', 'руб.'), gross: fact(100, total), revision: null,
    vat: { mode: 'none', rate: null, amount: null, ...quote(vat) },
    lines: [{ title: 'Урна', qty: 2, unit: 'шт', unitPrice: 50, amount: 100, ...quote(line) }], doubts: [],
  } };
}

function fakeApi({ customer = null, loss = null } = {}) {
  const calls = [], entities = new Map(), files = new Map();
  let sequence = 10;
  const api = {
    async get(endpoint, query) {
      if (endpoint === '/auth/me') return { id: 'manager', role: 'manager', canMoney: true };
      if (endpoint === '/organizations') return list([seller, ...[].concat(customer || [])].filter(row => row.inn === query.search));
      if (endpoint === '/salesorders') return list(query?.deleted ? [] : [...entities.values()].filter(row => !query.search || row.orderNo === query.search));
      if (endpoint.startsWith('/salesorders/')) return structuredClone(entities.get(endpoint.split('/').at(-1)) || null);
      if (endpoint.startsWith('/photos/intake/')) return files.get(endpoint.split('/').at(-1))?.receipt || null;
      if (endpoint.startsWith('/photos/')) {
        const file = [...files.values()].find(file => file.receipt.fileId === endpoint.split('/').at(-1));
        return file ? { id: file.receipt.fileId, storageUrl: file.receipt.storageUrl, sizeBytes: file.bytes.length, mimeType: 'application/pdf' } : null;
      }
      throw Error(`Неожиданный GET ${endpoint}`);
    },
    async post(endpoint, body, query) {
      calls.push({ endpoint, body });
      if (endpoint === '/organizations') {
        assert.deepEqual(body, { name: buyer.name, inn: buyer.inn, type: ['customer'], isOurCompany: false });
        customer = structuredClone(buyer);
        if (['customer', 'conflict'].includes(loss)) { const code = loss === 'customer' ? 'API_UNAVAILABLE' : 'QUESTION'; loss = null; throw new IntakeError(code, 'Ответ потерян или параллельное создание.'); }
        return customer;
      }
      if (endpoint.startsWith('/photos/intake/')) {
        const uid = endpoint.split('/').at(-1), bytes = Buffer.from(await body.get('file').arrayBuffer());
        const receipt = { uid, sha256: query.sha256, fileId: id(sequence++), storageUrl: `/uploads/${uid}.pdf` };
        files.set(uid, { bytes, receipt });
        if (loss === 'file') { loss = null; throw new IntakeError('API_UNAVAILABLE', 'Ответ файла потерян.'); }
        return receipt;
      }
      if (endpoint === '/salesorders') {
        const entity = { ...body, id: id(sequence++), legal: body.initialLegal, lines: [] };
        entities.set(entity.id, entity);
        if (loss === 'header') { loss = null; throw new IntakeError('API_UNAVAILABLE', 'Ответ договора потерян.'); }
        return { id: entity.id };
      }
      if (endpoint === '/incomes') {
        const row = { ...body, id: id(sequence++), amount: body.amountManual };
        entities.get(body.orderId).lines.push(row); return row;
      }
      assert.fail(`Запрещённая запись ${endpoint}`);
    },
    async original(url) { return [...files.values()].find(file => file.receipt.storageUrl === url)?.bytes; },
  };
  return { api, calls, entities, files, setCustomer: value => { customer = value; } };
}

async function box(t, numbers = ['Д-1']) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'datacore-c233-customer-'));
  t.after(async () => { assert.equal(path.dirname(root), parent); assert.ok(path.basename(root).startsWith('datacore-c233-customer-')); await fs.rm(root, { recursive: true, force: true }); });
  const store = await openRoot(root);
  const fixtures = new Map();
  for (const number of numbers) {
    const f = fixture(number), name = number + '.pdf'; fixtures.set(name, f);
    await fs.writeFile(path.join(store.folders.inbox, name), Buffer.from('%PDF-1.4\n' + number));
  }
  const options = { root, apiBase: 'http://127.0.0.1:3102/api', model: 'fixture', token: 'fixture' };
  const fake = fakeApi();
  const dependencies = { connect: () => fake.api, stableMs: 0, readTables: async () => [], renderImages: async () => [],
    extract: async filename => fixtures.get(path.basename(filename)).pages,
    propose: async ({ pages }) => [...fixtures.values()].find(f => f.pages[0] === pages[0]).raw };
  return { options, dependencies, fake };
}

test('анализ и подготовка договора не создают заказчика; отправка создаёт одного и сохраняет оригиналы двух договоров', async t => {
  const b = await box(t, ['Д-1', 'Д-2']);
  const report = await analyze(b.options, b.dependencies);
  assert.equal(report.counts.checked, 2);
  const draft = await getDraft({ root: b.options.root, arrivalId: report.items[0].arrivalId });
  assert.deepEqual(draft.parties.pendingCustomer, { name: buyer.name, inn: buyer.inn });
  const prepared = await prepareBatch(b.options, b.dependencies);
  assert.equal(prepared.items.length, 2); assert.deepEqual(b.fake.calls, []);
  const sent = await sendBatch({ ...b.options, confirmationId: prepared.id }, b.dependencies);
  assert.equal(sent.uploaded, 2); assert.deepEqual(sent.problems, []);
  assert.equal(b.fake.calls.filter(call => call.endpoint === '/organizations').length, 1);
  for (const entity of b.fake.entities.values()) {
    assert.equal(entity.productionAssignment, 'unassigned'); assert.equal(entity.productionNo, undefined);
    assert.equal(entity.counterpartyId, buyer.id); assert.equal(entity.lines[0].matchingMode, 'manual'); assert.equal(entity.lines[0].productId, undefined);
    const reference = entity.legal.documents[0];
    const file = [...b.fake.files.values()].find(file => file.receipt.fileId === reference.fileId);
    assert.equal(sha256(file.bytes), reference.sourceSha256);
  }
  assert.ok(b.fake.calls.every(call => !call.endpoint.includes('production-orders')));
  const repeated = await sendBatch({ ...b.options, confirmationId: prepared.id }, b.dependencies);
  assert.equal(repeated.uploaded, 2); assert.equal(b.fake.entities.size, 2);
});

for (const loss of ['customer', 'conflict', 'file', 'header']) test(`повтор после сбоя ${loss} не дублирует заказчика, договор или оригинал`, async t => {
  const b = await box(t); const fake = fakeApi({ loss }); b.dependencies.connect = () => fake.api;
  await analyze(b.options, b.dependencies);
  const prepared = await prepareBatch(b.options, b.dependencies);
  if (['file', 'header'].includes(loss)) await assert.rejects(sendBatch({ ...b.options, confirmationId: prepared.id }, b.dependencies), { code: 'API_UNAVAILABLE' });
  const sent = await sendBatch({ ...b.options, confirmationId: prepared.id }, b.dependencies);
  assert.equal(sent.uploaded, 1); assert.deepEqual(sent.problems, []);
  assert.equal(fake.calls.filter(call => call.endpoint === '/organizations').length, 1);
  assert.equal(fake.calls.filter(call => call.endpoint === '/salesorders').length, 1);
  assert.equal(fake.files.size, 1);
});

test('покупатель, появившийся после подготовки, используется без повторного создания', async t => {
  const b = await box(t); await analyze(b.options, b.dependencies);
  const prepared = await prepareBatch(b.options, b.dependencies); b.fake.setCustomer(buyer);
  assert.equal((await sendBatch({ ...b.options, confirmationId: prepared.id }, b.dependencies)).uploaded, 1);
  assert.equal(b.fake.calls.filter(call => call.endpoint === '/organizations').length, 0);
});

test('удалённый, неоднозначный или наш заказчик не создаётся и не используется', async () => {
  for (const customer of [{ ...buyer, deletedAt: '2026-01-01' }, [buyer, { ...buyer, id: id(100) }], { ...buyer, isOurCompany: true }]) {
    const fake = fakeApi({ customer });
    await assert.rejects(ensureSalesCustomer(fake.api, buyer), { code: 'QUESTION' });
    assert.deepEqual(fake.calls, []);
  }
  const fake = fakeApi(); fake.api.post = async () => { fake.calls.push({ endpoint: '/organizations' }); throw new IntakeError('QUESTION', 'ИНН занят удалённой карточкой'); };
  await assert.rejects(ensureSalesCustomer(fake.api, buyer), { code: 'QUESTION' });
  assert.equal(fake.calls.length, 1);
});

test('неподтверждённые реквизиты и отсутствующая наша компания блокируют создание', async () => {
  const fake = fakeApi();
  await assert.rejects(ensureSalesCustomer(fake.api, { ...buyer, inn: '7702070130' }), { code: 'QUESTION' });
  await assert.rejects(resolveSalesParties(fake.api, { kind: 'contract', seller: buyer, buyer: seller }, { allowMissingCustomer: true }), { code: 'QUESTION' });
  assert.deepEqual(fake.calls, []);
});

test('исходящий счёт определяется до создания отсутствующего покупателя', async () => {
  const fake = fakeApi();
  assert.deepEqual(await decideInvoice(fake.api, { seller, buyer }), { kind: 'customer_invoice' });
  assert.deepEqual(fake.calls, []);
});
