import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { analyze, getDraft, getReviewOriginal, reviewDecision, reviseDraft, reviewStatus } from './analysis.mjs';
import { report as legacyReport, resume as legacyResume, retry as legacyRetry, run as legacyRun } from './index.mjs';
import { IntakeError, arrivalsOf, claim, openRoot, saveArrival, sha256, uid } from './store.mjs';

const supplier = { id: '111111111111111111111111', name: 'ООО Альфа', inn: '7707083893', isOurCompany: false, type: ['supplier'] };
const payer = { id: '222222222222222222222222', name: 'ООО Бета', inn: '7702070139', isOurCompany: true };
const pdf = suffix => Buffer.from(`%PDF-1.4\nОбезличенный оригинал для теста C171: ${suffix}.`);

test('входящие и повторная сверка запускаются отдельно', async t => {
  const box = await setup(t);
  const { raw } = invoice();
  raw.gross.value = 101;
  const fake = runtime({ propose: async () => raw });
  await box.drop('Сомнительный счёт.pdf');
  const initial = await analyze({ ...box.options, scope: 'incoming' }, fake.dependencies);
  assert.equal(initial.counts.question, 1);
  const arrivalId = initial.items[0].arrivalId;
  const empty = await analyze({ ...box.options, scope: 'incoming' }, fake.dependencies);
  assert.equal(empty.total, 0);
  assert.equal(empty.processed, 0);

  await box.drop('Новый счёт.pdf');
  const repeated = await analyze({ ...box.options, scope: 'review' }, fake.dependencies);
  assert.equal(repeated.total, 1);
  assert.equal(repeated.items.length, 1);
  assert.equal(repeated.items[0].arrivalId, arrivalId);

  const previous = (await arrivalsOf(box.store))[0];
  const incoming = await analyze({ ...box.options, scope: 'incoming' }, runtime().dependencies);
  assert.equal(incoming.total, 1);
  assert.equal(incoming.counts.checked, 1);
  assert.deepEqual((await arrivalsOf(box.store)).find(entry => entry.arrivalId === arrivalId), previous);
});

test('повторная сверка считает копии одного PDF одним документом', async t => {
  const box = await setup(t);
  const { raw } = invoice();
  raw.gross.value = 101;
  const fake = runtime({ propose: async () => raw });
  const bytes = pdf('Один оригинал');
  await box.drop('Счёт.pdf', bytes);
  await box.drop('Копия.pdf', bytes);
  const first = await analyze(box.options, fake.dependencies);
  assert.equal(first.counts.question, 2);
  const retry = await analyze({ ...box.options, scope: 'review' }, fake.dependencies);
  assert.equal(retry.total, 1);
  assert.equal(retry.processed, 1);
  const entries = await arrivalsOf(box.store);
  assert.equal(entries.filter(entry => entry.history?.length).length, 1);
  assert.equal(entries.filter(entry => entry.state === 'question').length, 2);
});

test('повреждённый черновик не скрывает остальные документы и не открывает произвольный путь', async t => {
  const box = await setup(t); const fake = runtime();
  await box.drop('Первый.pdf'); await box.drop('Второй.pdf');
  const result = await analyze(box.options, fake.dependencies);
  const [entry] = await arrivalsOf(box.store);
  await fs.writeFile(path.join(box.store.documents, `c171-${entry.hash}.json`), '{broken');
  const visible = await reviewStatus({ root: box.root, owner: 'synthetic-manager', target: box.options.apiBase });
  assert.equal(visible.items.length, 2);
  assert.equal(visible.counts.question, 1); assert.equal(visible.counts.checked, 1);
  entry.hash = '../../outside'; await saveArrival(box.store, entry);
  const changed = await reviewStatus({ root: box.root, owner: 'synthetic-manager', target: box.options.apiBase });
  assert.equal(changed.items.find(row => row.arrivalId === entry.arrivalId).issues[0].code, 'JOURNAL');
  assert.equal(result.counts.checked, 2);
});

function invoice() {
  const header = 'Счёт № Т-17/1';
  const date = 'Дата: 20.11.2026';
  const sellerQuote = `Поставщик ${supplier.name} ИНН ${supplier.inn}`;
  const buyerQuote = `Покупатель ${payer.name} ИНН ${payer.inn}`;
  const line = 'Урна 2 шт 50,00 100,00';
  const total = 'Всего 100,00 руб.';
  const vat = 'Без НДС';
  const quote = text => ({ page: 1, quote: text });
  const evidence = (value, text) => ({ value, ...quote(text) });
  return {
    pages: [[header, date, sellerQuote, buyerQuote, line, total, vat].join('\n')],
    raw: {
      kind: 'supplier_invoice', kindEvidence: quote(header), number: evidence('Т-17/1', header), date: evidence('2026-11-20', date),
      seller: { name: supplier.name, inn: supplier.inn, ...quote(sellerQuote) },
      buyer: { name: payer.name, inn: payer.inn, ...quote(buyerQuote) },
      currency: evidence('RUB', 'руб.'), gross: evidence(100, total), revision: null,
      vat: { mode: 'none', rate: null, amount: null, ...quote(vat) },
      lines: [{ title: 'Урна', qty: 2, unit: 'шт', unitPrice: 50, amount: 100, ...quote(line) }], doubts: [],
    },
  };
}

async function setup(t) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'datacore-c171-analysis-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('datacore-c171-analysis-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const store = await openRoot(root);
  return { root, store, options: { root, apiBase: 'http://127.0.0.1:3102/api', modelBase: 'http://127.0.0.1:1235/v1', model: 'synthetic-test-model', token: 'memory-only-test-token' },
    drop: (name, bytes = pdf(name)) => fs.writeFile(path.join(store.folders.inbox, name), bytes) };
}

function runtime(patch = {}) {
  const calls = [];
  const fixture = invoice();
  const api = {
    async get(endpoint, query) {
      calls.push({ method: 'GET', endpoint });
      if (endpoint === '/auth/me') return { id: 'synthetic-manager', role: 'manager', canMoney: true };
      if (endpoint === '/organizations') {
        const items = [supplier, payer].filter(item => item.inn === query.search);
        return { items, total: items.length, page: 1, limit: 100 };
      }
      throw Error(`Неожиданный запрос ${endpoint}`);
    },
    async post(endpoint) { calls.push({ method: 'POST', endpoint }); assert.fail('Анализ не должен писать в DataCore'); },
  };
  return { calls, fixture, dependencies: { stableMs: 0, connect: () => api, renderImages: async () => [], readTables: async () => [],
    extract: async () => structuredClone(fixture.pages), propose: async () => structuredClone(fixture.raw), ...patch } };
}

test('повторный счёт повторно использует доказанный способ чтения итога', async t => {
  const box = await setup(t);
  const { raw, pages } = invoice();
  const weak = structuredClone(raw);
  weak.gross.value = 101;
  let views = 0;
  const fake = runtime({
    propose: async () => weak,
    renderImages: async (_file, numbered) => {
      assert.deepEqual(numbered, [1]);
      return [{ page: 1, jpeg: 'fixture' }];
    },
    proposeVision: async () => { views++; return raw; },
  });
  await box.drop('Первый счёт.pdf');
  const first = await analyze(box.options, fake.dependencies);
  const draft = await getDraft({ root: box.root, arrivalId: first.items[0].arrivalId });
  assert.equal(draft.state, 'checked');
  assert.deepEqual(draft.vision.fields, ['gross']);
  assert.equal(draft.raw.gross.value, 101);
  await box.drop('Следующий счёт.pdf');
  const second = await analyze(box.options, {
    ...fake.dependencies,
    extract: async () => pages.map(page => page.replace('50,00 100,00', '60,00 120,00').replace('Всего 100,00', 'Всего 120,00')),
    propose: async () => ({
      ...weak, lines: [{ ...weak.lines[0], unitPrice: 60, amount: 120, quote: 'Урна 2 шт 60,00 120,00' }],
    }),
  });
  const reused = await getDraft({ root: box.root, arrivalId: second.items.find(item => item.name === 'Следующий счёт.pdf').arrivalId });
  assert.equal(reused.state, 'checked');
  assert.deepEqual(reused.layoutFields, ['gross']);
  assert.equal(reused.proposal.gross, 120);
  assert.equal(views, 1);
  assert.equal(fake.calls.some(call => call.method === 'POST'), false);
});

test('визуальный ответ не заменяет подтверждённый реквизит и не принимает число без источника', async t => {
  const box = await setup(t);
  const fixture = invoice();
  const weak = { ...fixture.raw, gross: { ...fixture.raw.gross, value: 101 } };
  const visual = {
    ...fixture.raw,
    number: { ...fixture.raw.number, value: 'Т-90' },
    gross: { ...fixture.raw.gross, value: 900 },
  };
  const fake = runtime({
    propose: async () => weak,
    renderImages: async () => [{ page: 1, jpeg: 'fixture' }],
    proposeVision: async () => visual,
  });
  await box.drop('Спорный счёт.pdf');
  const result = await analyze(box.options, fake.dependencies);
  const draft = await getDraft({ root: box.root, arrivalId: result.items[0].arrivalId });
  assert.equal(draft.state, 'question');
  assert.equal(draft.vision.state, 'review');
  assert.deepEqual(draft.vision.fields, []);
  assert.equal(draft.raw.number.value, fixture.raw.number.value);
  assert.equal(draft.proposal, null);
});

test('строки восстанавливаются по физическим колонкам и сверяются со всеми итогами', async t => {
  const box = await setup(t);
  const { raw, pages } = invoice();
  raw.lines[0].title = 'Название модели';
  raw.doubts = ['The table rows and total were unclear.'];
  raw.gross = { page: 1, quote: 'Всего 120,00 руб.', value: 120 };
  pages[0] = pages[0].replace('Всего 100,00', 'Всего 120,00');
  const fake = runtime({
    extract: async () => pages,
    propose: async () => raw,
    readTables: async () => [{
      page: 1,
      rows: [
        ['№', 'Наименование', 'Цена', 'Количество', 'Ед.', 'Сумма НДС', 'Сумма'],
        ['1', 'Урна', '50 , 00', '2', 'шт', '0,00', '100,00'],
        ['2', 'Опора', '20,00', '1', 'шт', '0,00', '20,00'],
        ['', 'Итого', '', '', '', '', '120,00'],
      ],
    }],
  });
  await box.drop('Счёт с таблицей.pdf');
  const result = await analyze({ ...box.options, automatic: true }, fake.dependencies);
  const draft = await getDraft({ root: box.root, arrivalId: result.items[0].arrivalId });
  assert.equal(draft.state, 'checked');
  assert.equal(draft.autoDispatch, true);
  assert.equal(draft.raw.lines.length, 1);
  assert.deepEqual(draft.proposal.lines.map(row => row.title), ['Урна', 'Опора']);
  assert.equal(draft.proposal.gross, 120);
  assert.equal(fake.calls.some(call => call.method === 'POST'), false);
});

test('подтверждение названия и ИНН завершает локальную сверку и не включает автоотправку', async t => {
  const box = await setup(t);
  const { raw, pages } = invoice();
  pages[0] = pages[0].replace(raw.seller.quote, supplier.name + ' ИНН ' + supplier.inn);
  const fake = runtime({ propose: async () => raw, extract: async () => pages });
  await box.drop('Стороны для проверки.pdf');
  const result = await analyze({ ...box.options, automatic: true }, fake.dependencies);
  const { arrivalId, version } = result.items[0];
  assert.equal(result.items[0].issues[0].field, 'seller');
  const original = await getReviewOriginal({ root: box.root, arrivalId });
  assert.equal(original.owner, 'synthetic-manager');
  assert.equal(path.basename(original.original), 'Стороны для проверки.pdf');

  const request = { ...box.options, arrivalId, version, decision: 'confirm-party', field: 'seller', name: supplier.name, inn: supplier.inn };
  await assert.rejects(reviewDecision({ ...request, inn: '123' }, fake.dependencies), { code: 'QUESTION' });
  await assert.rejects(reviewDecision({ ...request, inn: payer.inn }, fake.dependencies), { code: 'QUESTION' });
  const checked = await reviewDecision(request, fake.dependencies);
  assert.equal(checked.state, 'checked');
  assert.equal(checked.manualParties.seller.inn, supplier.inn);
  assert.equal(checked.proposal.seller.inn, supplier.inn);
  assert.equal(checked.autoDispatch, undefined);
  assert.equal(fake.calls.every(call => call.method === 'GET'), true);
  await assert.rejects(reviewDecision(request, fake.dependencies), { code: 'VERSION' });
});

test('ручное исправление итога требует напечатанного значения и сохраняется при повторном разборе', async t => {
  const box = await setup(t);
  const { raw, pages } = invoice();
  raw.gross.value = 101;
  const fake = runtime({ propose: async () => raw, extract: async () => pages });
  const bytes = pdf('Исправление итога');
  await box.drop('Итог.pdf', bytes);
  const analyzed = await analyze(box.options, fake.dependencies);
  const { arrivalId, version } = analyzed.items[0];
  const request = { ...box.options, arrivalId, version, decision: 'confirm-fact', field: 'gross' };
  await assert.rejects(reviewDecision({ ...request, value: '101,00' }, fake.dependencies), { code: 'QUESTION' });
  const result = await reviewDecision({ ...request, value: '100,00' }, fake.dependencies);
  assert.equal(result.proposal.gross, 100);
  assert.equal(result.raw.gross.value, 101);
  await box.drop('Копия итога.pdf', bytes);
  const retry = await analyze({ ...box.options, automatic: true }, fake.dependencies);
  assert.equal(retry.counts.checked, 2);
  assert.equal(retry.counts.automatic, undefined);
});

test('расхождение итога в PDF можно отметить для возврата менеджеру и вернуть на сверку', async t => {
  const box = await setup(t);
  const { raw, pages } = invoice();
  raw.gross = { page: 1, quote: 'Всего 120,00 руб.', value: 120 };
  pages[0] = pages[0].replace('Всего 100,00', 'Всего 120,00');
  const fake = runtime({
    extract: async () => pages,
    propose: async () => raw,
    readTables: async () => [{ page: 1, rows: [
      ['№', 'Наименование', 'Цена', 'Количество', 'Ед.', 'Сумма'],
      ['1', 'Урна', '50,00', '2', 'шт', '100,00'],
      ['', 'Итого', '', '', '', '120,00'],
    ] }],
  });
  await box.drop('Расходятся итоги.pdf');
  const result = await analyze({ ...box.options, automatic: true }, fake.dependencies);
  const { arrivalId, version, issues } = result.items[0];
  assert.equal(issues[0].code, 'SOURCE_FORMAT');
  const request = { ...box.options, arrivalId, version };
  const marked = await reviewDecision({ ...request, decision: 'mark-return' }, fake.dependencies);
  assert.ok(marked.returnToManager);
  assert.equal(marked.autoDispatch, undefined);
  const retry = await analyze({ ...box.options, scope: 'review' }, fake.dependencies);
  assert.equal(retry.items[0].returnToManager, true);
  assert.equal(retry.items[0].state, 'question');
  const restored = await reviewDecision({ ...request, version: marked.version, decision: 'undo-return' }, fake.dependencies);
  assert.equal(restored.returnToManager, undefined);
  assert.equal(restored.issues[0].code, 'SOURCE_FORMAT');
});

test('анализ сохраняет локальный черновик и доказательства, не выполняя POST и не обещая готовность', async t => {
  const box = await setup(t); const fake = runtime();
  const bytes = pdf('первый'); await box.drop('Счёт.pdf', bytes);
  const result = await analyze(box.options, fake.dependencies);
  assert.equal(result.stopped, undefined); assert.equal(result.processed, 1);
  assert.equal(result.counts.checked, 1); assert.equal(result.counts.uploaded, 0);
  const item = result.items[0]; assert.equal(item.state, 'checked');
  const draft = await getDraft({ root: box.root, arrivalId: item.arrivalId });
  assert.equal(draft.version, 1); assert.deepEqual(draft.raw, fake.fixture.raw); assert.deepEqual(draft.pages, fake.fixture.pages);
  assert.equal(draft.hash, sha256(bytes)); assert.equal(draft.parties.supplierId, supplier.id);
  assert.deepEqual(await fs.readFile(path.join(box.store.folders.ready, item.arrivalId, item.name)), bytes);
  assert.equal(fake.calls.some(call => call.method === 'POST'), false);
  assert.doesNotMatch(JSON.stringify(draft), /memory-only-test-token/);
  assert.deepEqual((await legacyReport({ root: box.root })).items, []);
  await box.drop('Ещё сохраняется.pdf');
  const deferred = await analyze(box.options, { ...fake.dependencies, stableMs: 60_000 });
  assert.equal(deferred.processed, 0); assert.equal(deferred.total, 1);
  assert.equal((await legacyReport({ root: box.root })).counts.inbox, 1, 'непрочитанный файл не считается проверенным');
});

test('цитата стороны восстанавливается только по однозначной строке оригинала', async t => {
  const box = await setup(t);
  const { raw } = invoice();
  raw.seller.quote = raw.seller.quote.replace('ИНН', 'ИН_Н');
  const fake = runtime({ propose: async () => raw });
  await box.drop('Счёт с искажённой цитатой.pdf');
  const result = await analyze(box.options, fake.dependencies);
  const draft = await getDraft({ root: box.root, arrivalId: result.items[0].arrivalId });
  assert.equal(draft.state, 'checked');
  assert.match(draft.raw.seller.quote, /ИН_Н/);
  assert.equal(draft.evidence.seller.quote, fake.fixture.raw.seller.quote);

  const second = await setup(t);
  await second.drop('Два совпадения.pdf');
  const pages = [fake.fixture.pages[0] + '\n' + fake.fixture.raw.seller.quote.replace(supplier.inn, payer.inn)];
  const ambiguous = await analyze(second.options, { ...fake.dependencies, extract: async () => pages });
  assert.equal(ambiguous.items[0].state, 'question');
});

test('разбор исправляет ИНН и страницу по повторяющимся однозначным реквизитам', async t => {
  const box = await setup(t);
  const { pages, raw } = invoice();
  const repeated = supplier.name + ' ИНН/КПП: ' + supplier.inn + ' / 770701001\nПоставщик';
  pages[0] = pages[0].replace(raw.seller.quote, 'Реквизиты на следующей странице.');
  pages.push(repeated + '\n\n' + repeated);
  raw.seller.inn = '7707083890';
  raw.seller.quote = 'Поставщик ' + supplier.name + ' ИНН ' + raw.seller.inn;
  const fake = runtime({ extract: async () => pages, propose: async () => raw });
  await box.drop('Счёт с повтором реквизитов.pdf');
  const result = await analyze(box.options, fake.dependencies);
  const draft = await getDraft({ root: box.root, arrivalId: result.items[0].arrivalId });
  assert.equal(draft.state, 'checked');
  assert.equal(draft.raw.seller.inn, '7707083890');
  assert.equal(draft.evidence.seller.inn, supplier.inn);
  assert.equal(draft.evidence.seller.page, 2);
});

test('подтверждённый ИНН ищется отдельно от ошибки чтения второй стороны', async t => {
  const box = await setup(t);
  const { raw } = invoice();
  raw.buyer = null;
  const searched = [];
  const fake = runtime({ propose: async () => raw, connect: () => ({
    async get(endpoint, query) {
      if (endpoint === '/auth/me') return { id: 'synthetic-manager', role: 'manager', canMoney: true };
      assert.equal(endpoint, '/organizations');
      searched.push(query.search);
      return { items: [], total: 0, page: 1, limit: 100 };
    },
    async post() { assert.fail('Анализ не должен писать в DataCore'); },
  }) });
  await box.drop('Счёт для уточнения.pdf');
  const result = await analyze(box.options, fake.dependencies);
  assert.equal(result.counts.question, 1);
  assert.deepEqual(searched, [supplier.inn]);
  assert.match(result.items[0].issues[0].message, /отсутствует в справочнике по подтверждённому ИНН/);
  assert.match(result.items[0].issues[1].message, /ИНН не прочитан/);
});

test('сторона на соседних строках и явный НДС сверяются по дословным строкам PDF', async t => {
  const box = await setup(t);
  const { pages, raw } = invoice();
  const sellerLines = 'Поставщик ' + raw.seller.name + '\nИНН/КПП: ' + raw.seller.inn + ' / 770701001';
  const tax = 'В том числе НДС 20% — 16,67 руб.';
  pages[0] = pages[0].replace(raw.seller.quote, sellerLines).replace(raw.vat.quote, tax);
  raw.seller.quote = 'Поставщик ' + raw.seller.name + ', ИНН ' + raw.seller.inn;
  raw.vat = { page: 1, quote: 'НДС включён 20% 16,67 руб.', mode: 'included', rate: 20, amount: 16.67 };
  const fake = runtime({ extract: async () => pages, propose: async () => raw });
  await box.drop('Счёт с раздельными реквизитами.pdf');
  const result = await analyze(box.options, fake.dependencies);
  const draft = await getDraft({ root: box.root, arrivalId: result.items[0].arrivalId });
  assert.equal(draft.state, 'checked');
  assert.equal(draft.evidence.seller.quote, sellerLines);
  assert.equal(draft.evidence.vat.quote, tax);
  assert.notEqual(draft.raw.vat.quote, tax);

  const strict = await setup(t);
  await strict.drop('Счёт с неправильной суммой НДС.pdf');
  const wrong = { ...raw, vat: { ...raw.vat, amount: 17.16 } };
  const rejected = await analyze(strict.options, { ...fake.dependencies, propose: async () => wrong });
  assert.equal(rejected.counts.question, 1);
  assert.match(rejected.items[0].issues[0].message, /НДС/);
});

test('две колонки договора исправляют ИНН, страницу и названия, сохраняя ответ модели', async t => {
  const box = await setup(t);
  const { pages, raw } = invoice();
  raw.kind = 'contract';
  const header = raw.kindEvidence.quote.replace('Счёт', 'Договор');
  pages[0] = pages[0].replace(raw.kindEvidence.quote, header).replace(raw.seller.quote + '\n' + raw.buyer.quote, '');
  raw.kindEvidence.quote = header;
  raw.number.quote = header;
  raw.seller.name = 'Неточное название продавца';
  raw.buyer.name = 'Неточное название покупателя';
  raw.buyer.inn = '7702070130';
  const sellerTax = 'ИНН/КПП: ' + supplier.inn + ' / 770701001';
  const buyerTax = 'ИНН/КПП: ' + payer.inn + ' / 770701001';
  pages.push(['Покупатель: Поставщик:', payer.name + ' ' + supplier.name, 'Два адреса', sellerTax, buyerTax].join('\n'));
  const columns = [
    { page: 2, quote: ['Покупатель:', payer.name, 'Адрес покупателя', buyerTax].join('\n') },
    { page: 2, quote: ['Поставщик:', supplier.name, 'Адрес поставщика', sellerTax].join('\n') },
  ];
  const fake = runtime({ extract: async () => pages, extractColumns: async () => columns, propose: async () => raw, connect: () => ({
    async get(endpoint, query) {
      if (endpoint === '/auth/me') return { id: 'synthetic-manager', role: 'manager', canMoney: true };
      assert.equal(endpoint, '/organizations');
      const items = [{ ...supplier, isOurCompany: true }, { ...payer, isOurCompany: false }].filter(row => row.inn === query.search);
      return { items, total: items.length, page: 1, limit: 100 };
    },
    async post() { assert.fail('Анализ не должен писать в DataCore'); },
  }) });
  await box.drop('Договор с колонками.pdf');
  const result = await analyze(box.options, fake.dependencies);
  const draft = await getDraft({ root: box.root, arrivalId: result.items[0].arrivalId });
  assert.equal(draft.state, 'checked');
  assert.deepEqual(draft.raw, raw);
  assert.deepEqual(draft.evidence.buyer, { ...columns[0], name: payer.name, inn: payer.inn });
  assert.deepEqual(draft.evidence.seller, { ...columns[1], name: supplier.name, inn: supplier.inn });
});

test('ошибочный кандидат остаётся вместе с исходными страницами и причиной', async t => {
  const box = await setup(t); const bad = invoice().raw; bad.gross.value = 101;
  const fake = runtime({ propose: async () => bad }); await box.drop('Спорный.pdf');
  const result = await analyze(box.options, fake.dependencies);
  assert.equal(result.stopped, undefined); assert.equal(result.counts.question, 1);
  const draft = await getDraft({ root: box.root, arrivalId: result.items[0].arrivalId });
  assert.deepEqual(draft.raw, bad); assert.deepEqual(draft.pages, fake.fixture.pages);
  assert.equal(draft.proposal, null); assert.ok(draft.issues[0].message); assert.ok(draft.issues[0].action);
});

test('ошибка журнала не скрывает причину сверки, повтор считает поступление один раз', async t => {
  const box = await setup(t);
  const { raw } = invoice();
  raw.lines[0].qty = 3;
  const fake = runtime({ propose: async () => raw });
  await box.drop('Счёт со спорной строкой.pdf');
  await analyze(box.options, fake.dependencies);
  const [entry] = await arrivalsOf(box.store);
  entry.reviewIssue = { code: 'DOCUMENT', message: 'Старая ошибка.', action: 'Повторите.' };
  await saveArrival(box.store, entry);
  const report = await reviewStatus({ root: box.root });
  assert.equal(report.items[0].issues[0].code, 'DOCUMENT');
  assert.match(report.items[0].issues[1].message, /строка 1/);

  const result = await analyze(box.options, fake.dependencies);
  assert.equal(result.processed, 1);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].issues.length, 1);
  assert.match(result.items[0].issues[0].message, /строка 1/);
  assert.equal((await arrivalsOf(box.store))[0].reviewIssue, undefined);
});

test('испорченный файл в середине пачки направляется на проверку, следующий счёт анализируется', async t => {
  const box = await setup(t); const fixture = invoice();
  const fake = runtime({ extract: async filename => { if (filename.endsWith('02-битый.pdf')) throw Error('Ошибка PDF'); return fixture.pages; } });
  for (const name of ['01-хороший.pdf', '02-битый.pdf', '03-хороший.pdf']) await box.drop(name);
  const result = await analyze(box.options, fake.dependencies);
  assert.equal(result.stopped, undefined); assert.equal(result.processed, 3);
  assert.equal(result.counts.checked, 2); assert.equal(result.counts.question, 1);
  assert.equal(result.items.find(item => item.name === '03-хороший.pdf').state, 'checked');
});

test('недоступность модели приостанавливает очередь, повторный запуск продолжает с сохранённых страниц', async t => {
  const box = await setup(t); let unavailable = true; let extracts = 0; let proposals = 0;
  const fixture = invoice();
  const fake = runtime({ extract: async () => { extracts++; return fixture.pages; }, propose: async () => {
    proposals++; if (unavailable) throw new IntakeError('MODEL_UNAVAILABLE', 'Модель выключена.', 'Запустите модель.'); return fixture.raw;
  } });
  await box.drop('01-счёт.pdf'); await box.drop('02-счёт.pdf');
  const paused = await analyze(box.options, fake.dependencies);
  assert.equal(paused.stopped.code, 'MODEL_UNAVAILABLE'); assert.equal(paused.processed, 0);
  assert.equal((await fs.readdir(box.store.folders.inbox)).length, 1);
  const saved = await getDraft({ root: box.root, arrivalId: paused.items[0].arrivalId }); assert.deepEqual(saved.pages, fixture.pages);
  unavailable = false;
  const resumed = await analyze(box.options, fake.dependencies);
  assert.equal(resumed.stopped, undefined); assert.equal(resumed.counts.checked, 2);
  assert.equal(extracts, 2); assert.equal(proposals, 3);
});

test('heartbeat обновляет признак активности во время долгого ответа модели', async t => {
  const box = await setup(t); const events = []; const fixture = invoice(); let beat;
  const heartbeats = new Promise(resolve => { beat = resolve; });
  const fake = runtime({ heartbeatMs: 10, propose: async () => { await heartbeats; return fixture.raw; } });
  await box.drop('Счёт.pdf');
  const result = await analyze({ ...box.options, onProgress: event => {
    events.push(event);
    const proposing = events.filter(item => item.stage === 'proposing');
    if (proposing.length >= 3) beat();
  } }, fake.dependencies);
  assert.equal(result.counts.checked, 1);
  const proposing = events.filter(item => item.stage === 'proposing'); assert.ok(proposing.length >= 3);
  assert.ok(proposing.some(event => event.heartbeatAt !== event.lastEventAt));
  assert.equal(new Set(proposing.map(event => event.lastEventAt)).size, 1);
});

test('правка создаёт следующую локальную версию, старый CAS отвергается, проверки запускаются повторно', async t => {
  const box = await setup(t); const fake = runtime(); await box.drop('Счёт.pdf');
  const result = await analyze(box.options, fake.dependencies); const arrivalId = result.items[0].arrivalId;
  const bad = invoice().raw; bad.lines[0].qty = 20;
  const second = await reviseDraft({ ...box.options, arrivalId, version: 1, raw: bad }, fake.dependencies);
  assert.equal(second.version, 2); assert.equal(second.state, 'question'); assert.equal(second.history[0].version, 1);
  assert.deepEqual(second.history[0].raw, fake.fixture.raw);
  await assert.rejects(reviseDraft({ ...box.options, arrivalId, version: 1, raw: fake.fixture.raw }, fake.dependencies), { code: 'VERSION' });
  const third = await reviseDraft({ ...box.options, arrivalId, version: 2, raw: fake.fixture.raw }, fake.dependencies);
  assert.equal(third.version, 3); assert.equal(third.state, 'checked'); assert.equal(third.history.length, 2);
  assert.equal(fake.calls.some(call => call.method === 'POST'), false);
});

test('подмена оригинала блокирует чтение и правку черновика', async t => {
  const box = await setup(t); const fake = runtime(); await box.drop('Счёт.pdf');
  const result = await analyze(box.options, fake.dependencies); const item = result.items[0];
  await fs.writeFile(path.join(box.store.folders.ready, item.arrivalId, item.name), pdf('подмена'));
  await assert.rejects(getDraft({ root: box.root, arrivalId: item.arrivalId }), { code: 'ORIGINAL' });
  await assert.rejects(reviseDraft({ ...box.options, arrivalId: item.arrivalId, version: 1, raw: fake.fixture.raw }, fake.dependencies), { code: 'ORIGINAL' });
  await box.drop('Следующий.pdf');
  const again = await analyze(box.options, fake.dependencies);
  assert.equal(again.stopped, undefined); assert.equal(again.processed, 1);
  await assert.rejects(getDraft({ root: box.root, arrivalId: item.arrivalId }), { code: 'ORIGINAL' });
});

test('повторные поступления одинакового хеша используют один черновик без повторного вызова модели', async t => {
  const box = await setup(t); let proposals = 0; const fixture = invoice();
  const fake = runtime({ propose: async () => { proposals++; return fixture.raw; } });
  const bytes = pdf('повтор'); await box.drop('01-первый.pdf', bytes); await box.drop('02-копия.pdf', bytes);
  const result = await analyze(box.options, fake.dependencies);
  assert.equal(result.counts.checked, 2); assert.equal(new Set(result.items.map(item => item.hash)).size, 1);
  assert.equal(proposals, 1);
  const drafts = (await fs.readdir(box.store.documents)).filter(name => name.startsWith('c171-'));
  assert.equal(drafts.length, 1); assert.equal(fake.calls.some(call => call.method === 'POST'), false);
});

test('незавершённые поступления C169 не обрабатываются и не попадают в сводку C171', async t => {
  const box = await setup(t); const fake = runtime();
  await box.drop('C169.pdf'); const legacy = await claim(box.store, 'C169.pdf', 0);
  await box.drop('C171.pdf');
  const result = await analyze(box.options, fake.dependencies);
  assert.equal(result.stopped.code, 'LEGACY_PENDING'); assert.equal(result.total, 0); assert.equal(result.items.length, 0);
  assert.deepEqual(await fs.readFile(path.join(box.store.folders.inbox, 'C171.pdf')), pdf('C171.pdf'));
  assert.equal(fake.calls.length, 0);
  const persisted = (await arrivalsOf(box.store)).find(item => item.arrivalId === legacy.arrivalId);
  assert.equal(persisted.workflow, undefined); assert.equal(persisted.state, 'processing');
  assert.deepEqual(await fs.readFile(path.join(box.store.folders.processing, legacy.arrivalId, legacy.name)), pdf('C169.pdf'));
  assert.equal((await reviewStatus({ root: box.root })).items.length, 0);
});

test('маркер C171 блокирует legacy run/resume/retry, включая аварийное поступление без workflow', async t => {
  const box = await setup(t); const fake = runtime(); await box.drop('Проверенный.pdf');
  await analyze(box.options, fake.dependencies);
  // Даже повреждение содержимого маркера не должно снова включить старую запись.
  await fs.writeFile(path.join(box.root, '.intake', 'c171-review.json'), 'null');
  await box.drop('Аварийный.pdf');
  // Имитируем закрытие процесса между захватом файла и записью workflow.
  const unmarked = await claim(box.store, 'Аварийный.pdf', 0);
  const calls = fake.calls.length;
  for (const execute of [legacyRun, legacyResume, legacyRetry]) {
    const result = await execute({ ...box.options, arrivalIds: [unmarked.arrivalId] }, fake.dependencies);
    assert.equal(result.stopped.code, 'REVIEW_REQUIRED');
  }
  assert.equal(fake.calls.length, calls);
  const persisted = (await arrivalsOf(box.store)).find(item => item.arrivalId === unmarked.arrivalId);
  assert.equal(persisted.workflow, undefined); assert.equal(persisted.state, 'processing');
  assert.deepEqual(await fs.readFile(path.join(box.store.folders.processing, unmarked.arrivalId, unmarked.name)), pdf('Аварийный.pdf'));
});

test('сбой после начального журнала claiming до захвата возвращается к файлу из Inbox', async t => {
  const box = await setup(t); const fake = runtime(); await box.drop('Счёт.pdf');
  const crashed = { arrivalId: uid(), name: 'Счёт.pdf', state: 'processing', phase: 'claiming', workflow: 'c171', batchId: uid(),
    reviewOwner: 'synthetic-manager', reviewTarget: box.options.apiBase, createdAt: new Date().toISOString() };
  await saveArrival(box.store, crashed);
  const result = await analyze(box.options, fake.dependencies);
  assert.equal(result.stopped, undefined); assert.equal(result.counts.checked, 1); assert.equal(result.items.length, 1);
  assert.notEqual(result.items[0].arrivalId, crashed.arrivalId);
  const entries = await arrivalsOf(box.store); assert.equal(entries.length, 1); assert.equal(entries[0].workflow, 'c171');
});

test('сбой claiming после захвата оригинала восстанавливает то же поступление с metadata', async t => {
  const box = await setup(t); const fake = runtime(); await box.drop('Счёт.pdf');
  const metadata = { workflow: 'c171', batchId: uid(), owner: 'synthetic-manager', target: box.options.apiBase };
  const captured = await claim(box.store, 'Счёт.pdf', 0, metadata);
  assert.equal(captured.workflow, 'c171'); assert.equal(captured.batchId, metadata.batchId);
  assert.equal(captured.reviewOwner, metadata.owner); assert.equal(captured.reviewTarget, metadata.target);
  captured.phase = 'claiming'; await saveArrival(box.store, captured);
  const result = await analyze(box.options, fake.dependencies);
  assert.equal(result.stopped, undefined); assert.equal(result.counts.checked, 1); assert.equal(result.items[0].arrivalId, captured.arrivalId);
  assert.equal((await arrivalsOf(box.store)).find(row => row.arrivalId === captured.arrivalId).state, 'ready');
});

test('сводка фильтрует черновики по владельцу и контуру, включая pending без готового черновика', async t => {
  const box = await setup(t); const fake = runtime(); await box.drop('Счёт.pdf'); await analyze(box.options, fake.dependencies);
  const target = box.options.apiBase; const owner = 'synthetic-manager';
  assert.equal((await reviewStatus({ root: box.root, owner, target })).items.length, 1);
  assert.equal((await reviewStatus({ root: box.root, owner: 'другой', target })).items.length, 0);
  assert.equal((await reviewStatus({ root: box.root, owner, target: 'http://127.0.0.1:3999/api/' })).items.length, 0);
  await box.drop('Ожидающий.pdf'); const pending = await claim(box.store, 'Ожидающий.pdf', 0, { workflow: 'c171', batchId: uid(), owner, target });
  const visible = await reviewStatus({ root: box.root, owner, target });
  assert.equal(visible.items.length, 2); assert.equal(visible.items.find(row => row.arrivalId === pending.arrivalId).state, 'pending');
  assert.equal((await reviewStatus({ root: box.root, owner: 'другой', target })).items.length, 0);
});
