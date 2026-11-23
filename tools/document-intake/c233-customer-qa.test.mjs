import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureSalesCustomer } from './api.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyze } from './analysis.mjs';
import { prepareBatch, sendBatch } from './delivery.mjs';
import { IntakeError, arrivalsOf, openRoot } from './store.mjs';

const party = { name: 'ООО Заказчик', inn: '7702070139' };
const row = { ...party, id: '222222222222222222222222', isOurCompany: false, type: ['customer'] };
const list = items => ({ items, total: items.length, page: 1, limit: 100 });

function transport({ after = [], result = row, failure } = {}) {
  const calls = [];
  let posted = false;
  return {
    calls,
    api: {
      async get(endpoint, query) {
        calls.push({ method: 'GET', endpoint, query });
        assert.equal(endpoint, '/organizations');
        assert.equal(query.search, party.inn);
        return list(posted ? after : []);
      },
      async post(endpoint, body) {
        calls.push({ method: 'POST', endpoint, body });
        assert.equal(endpoint, '/organizations');
        posted = true;
        if (failure) throw failure;
        return result;
      },
    },
  };
}

test('QA C233: ответ POST с ID не заменяет подтверждение созданного заказчика через GET', async () => {
  const fake = transport();
  await assert.rejects(ensureSalesCustomer(fake.api, party), { code: 'QUESTION' });
  assert.deepEqual(fake.calls.map(call => call.method), ['GET', 'POST', 'GET']);
});

test('QA C233: истёкшая сессия при создании не маскируется повторным поиском', async () => {
  const fake = transport({ after: [row], failure: new IntakeError('AUTH', 'Нужен повторный вход') });
  await assert.rejects(ensureSalesCustomer(fake.api, party), { code: 'AUTH' });
  assert.deepEqual(fake.calls.map(call => call.method), ['GET', 'POST']);
});

test('QA C233: после POST найденная наша компания или неверный ID не становятся заказчиком', async () => {
  for (const invalid of [{ ...row, isOurCompany: true }, { ...row, id: 'не-идентификатор' }]) {
    const fake = transport({ after: [invalid] });
    await assert.rejects(ensureSalesCustomer(fake.api, party), { code: 'QUESTION' });
    assert.equal(fake.calls.filter(call => call.method === 'POST').length, 1);
  }
});

test('QA C233: потерянный ответ без подтверждённой карточки оставляет сетевую ошибку, без второго POST', async () => {
  const fake = transport({ failure: new IntakeError('API_UNAVAILABLE', 'Ответ потерян') });
  await assert.rejects(ensureSalesCustomer(fake.api, party), { code: 'API_UNAVAILABLE' });
  assert.deepEqual(fake.calls.map(call => call.method), ['GET', 'POST', 'GET']);
});

async function preparedContract(t) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'datacore-c233-qa-'));
  t.after(async () => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('datacore-c233-qa-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const store = await openRoot(root);
  const seller = { id: '111111111111111111111111', name: 'ООО Альфа', inn: '7707083893', isOurCompany: true };
  const texts = {
    header: 'Договор № QA-1', date: 'Дата: 20.11.2026',
    seller: `Поставщик ${seller.name} ИНН ${seller.inn}`, buyer: `Покупатель ${party.name} ИНН ${party.inn}`,
    line: 'Урна 2 шт 50,00 100,00', total: 'Всего 100,00 руб.', vat: 'Без НДС',
  };
  const proof = quote => ({ page: 1, quote });
  const fact = (value, quote) => ({ value, ...proof(quote) });
  const raw = {
    kind: 'contract', kindEvidence: proof(texts.header), number: fact('QA-1', texts.header), date: fact('2026-11-20', texts.date),
    seller: { name: seller.name, inn: seller.inn, ...proof(texts.seller) }, buyer: { ...party, ...proof(texts.buyer) },
    currency: fact('RUB', 'руб.'), gross: fact(100, texts.total), revision: null,
    vat: { mode: 'none', rate: null, amount: null, ...proof(texts.vat) },
    lines: [{ title: 'Урна', qty: 2, unit: 'шт', unitPrice: 50, amount: 100, ...proof(texts.line) }], doubts: [],
  };
  const calls = [];
  let actor = 'qa-manager';
  const api = {
    async get(endpoint, query) {
      if (endpoint === '/auth/me') return { id: actor, role: 'manager', canMoney: true };
      if (endpoint === '/organizations') return list(query.search === seller.inn ? [seller] : []);
      if (endpoint === '/salesorders') return list([]);
      assert.fail(`Неожиданный GET ${endpoint}`);
    },
    async post(endpoint, body) { calls.push({ endpoint, body }); assert.fail('Изменённое подтверждение не должно выполнять POST'); },
  };
  const options = { root, apiBase: 'http://127.0.0.1:3102/api', model: 'qa-fixture', token: 'qa-fixture' };
  const dependencies = { connect: () => api, stableMs: 0, readTables: async () => [], renderImages: async () => [],
    extract: async () => [Object.values(texts).join('\n')], propose: async () => raw };
  await fs.writeFile(path.join(store.folders.inbox, 'QA.pdf'), Buffer.from('%PDF-1.4\nQA-1'));
  const report = await analyze(options, dependencies);
  assert.equal(report.counts.checked, 1);
  const confirmation = await prepareBatch(options, dependencies);
  assert.equal(confirmation.items.length, 1);
  assert.deepEqual(calls, []);
  const [entry] = await arrivalsOf(store);
  return { options: { ...options, confirmationId: confirmation.id }, dependencies, store, entry, calls,
    setActor: value => { actor = value; } };
}

test('QA C233: изменение подтверждённого нового заказчика требует новой подготовки до любого POST', async t => {
  const box = await preparedContract(t);
  const file = path.join(box.store.documents, `c171-${box.entry.hash}.json`);
  const draft = JSON.parse(await fs.readFile(file, 'utf8'));
  draft.parties.pendingCustomer.name = 'Другое название';
  draft.proposal.buyer.name = 'Другое название';
  await fs.writeFile(file, JSON.stringify(draft));
  const result = await sendBatch(box.options, box.dependencies);
  assert.equal(result.uploaded, 0);
  assert.equal(result.problems.length, 1);
  assert.deepEqual(box.calls, []);
});

test('QA C233: другой контур или пользователь не используют прежнее подтверждение', async t => {
  const box = await preparedContract(t);
  await assert.rejects(sendBatch({ ...box.options, apiBase: 'http://127.0.0.1:3103/api' }, box.dependencies), { code: 'VERSION' });
  box.setActor('other-manager');
  await assert.rejects(sendBatch(box.options, box.dependencies), { code: 'VERSION' });
  assert.deepEqual(box.calls, []);
});

test('QA C233: изменённый оригинал после подготовки блокирует даже создание заказчика', async t => {
  const box = await preparedContract(t);
  const file = path.join(box.store.folders[box.entry.state], box.entry.arrivalId, box.entry.name);
  await fs.writeFile(file, Buffer.from('%PDF-1.4\nИзменённый оригинал'));
  const result = await sendBatch(box.options, box.dependencies);
  assert.equal(result.uploaded, 0);
  assert.equal(result.problems.length, 1);
  assert.deepEqual(box.calls, []);
});
