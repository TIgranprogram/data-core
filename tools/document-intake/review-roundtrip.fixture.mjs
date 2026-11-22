// Вызывается только e2e C171 с выделенным сервером Nest, временной папкой и учебным логином.
import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDocumentIntake } from '../../pult/document-intake.mjs';
import * as engine from './index.mjs';
import { connectApi } from './api.mjs';
import { IntakeError } from './store.mjs';

const [apiBase, root] = process.argv.slice(2);
assert.match(apiBase, /^http:\/\/127\.0\.0\.1:\d+\/api$/);
assert.match(path.basename(root), /^c171-e2e-/);
const documents = path.join(root, 'batch');
const settings = { apiBase, model: 'fixture', modelBase: 'http://127.0.0.1:1235/v1' };
const user = { username: 'c171-fixture-manager', password: 'local-fixture-password' };
const field = (value, quote) => ({ value, quote, page: 1 });
const proof = (quote) => ({ quote, page: 1 });
const raw = {
  kind: 'supplier_invoice', kindEvidence: proof('Счёт № В-83'), number: field('В-83','Счёт № В-83'),
  date: field('2026-11-20','Дата 20.11.2026'), revision: null, doubts: [],
  seller: { name: 'Поставщик C171', inn: '0107020521', ...proof('Поставщик C171 ИНН 0107020521') },
  buyer: { name: 'Плательщик C171', inn: '2312308098', ...proof('Плательщик C171 ИНН 2312308098') },
  gross: field(100,'Итого 100,00'), currency: field('RUB','руб.'), vat: { mode: 'none', rate: null, amount: null, ...proof('Без НДС') },
  lines: [{ title: 'Образец', qty: 1, unit: 'шт', unitPrice: 100, amount: 100, ...proof('Образец 1 шт 100,00 100,00') }],
};
const pages = ['Счёт № В-83\nДата 20.11.2026\nПоставщик C171 ИНН 0107020521\nПлательщик C171 ИНН 2312308098\nОбразец 1 шт 100,00 100,00\nИтого 100,00 руб. Без НДС'];
let commits = 0;
const options = { stateDir: path.join(root, 'settings'), pickFolder: async () => documents,
  prepare: async () => ({ ready: true, steps: [] }), engine: async () => ({ ...engine,
    analyze: args => engine.analyze(args, { stableMs: 0, extract: async (_file, bytes) => {
      if (!bytes.toString().startsWith('%PDF-')) throw new IntakeError('DOCUMENT','Повреждённый оригинал');
      return pages;
    }, propose: async () => raw }),
    sendBatch: args => engine.sendBatch(args, { connect: options => {
      const api = connectApi(options);
      return { ...api, commitReviewed: async (...args) => {
        commits++; await api.commitReviewed(...args);
        throw new IntakeError('API_UNAVAILABLE','Тестовый обрыв сразу после commit');
      } };
    } }),
  }) };
let pult = createDocumentIntake(options);
const call = async (action, data = {}, method = 'POST') => {
  const status = await pult.route('GET','status');
  return pult.route(method, action, async () => ({ revision: status.body.revision, ...data }));
};
const success = async (...args) => {
  const result = await call(...args); assert.ok(result.status < 300, JSON.stringify(result)); return result.body;
};
await success('settings', settings); await success('folder'); await success('login', user);
const inboxPath = async () => (await pult.route('GET','status')).body.inboxPath;
const inbox = await inboxPath();
for (const [name, bytes] of [['1.pdf','%PDF-1.4 fixture A C171'],['2.pdf','порченый'],['3.pdf','%PDF-1.4 fixture A C171']]) await writeFile(path.join(inbox,name),bytes);
await success('analyze');
for (let i=0; i<200 && pult.busy(); i++) await delay(30);
const report = await success('reviewreport', {}, 'GET');
assert.deepEqual(await readdir(inbox), []);
assert.equal((await readdir(path.join(documents, 'Проверенные'))).length, 2);
assert.equal((await readdir(path.join(documents, 'Сомнительные'))).length, 1);
assert.equal(report.counts.checked, 1, JSON.stringify(report)); assert.equal(report.counts.question, 1);
const preview = await success('prepare'); assert.equal(preview.items.length, 1, JSON.stringify(preview));
const auth = await fetch(apiBase + '/auth/login', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(user) }).then(r=>r.json());
const entry = report.items.find(item => item.state === 'checked');
await engine.reviseDraft({ root: documents, apiBase, token: auth.access, raw, version: entry.version, arrivalId: entry.arrivalId });
const stale = await success('send', { confirmationId: preview.id });
assert.equal(stale.uploaded, 0); assert.equal(commits, 0);
const fresh = await success('prepare'); assert.equal(fresh.items[0].version, 2);
assert.equal((await call('send', { confirmationId: fresh.id })).status, 409);
assert.equal(commits, 1); await pult.stop();
pult = createDocumentIntake(options);
await success('login', user);
const resumed = await success('prepare'); assert.equal(resumed.items.length, 0, JSON.stringify(resumed));
const final = await success('reviewreport', {}, 'GET');
assert.equal(final.counts.uploaded, 1, JSON.stringify(final)); assert.equal(final.counts.question, 1);
assert.equal(commits, 1); await pult.stop();
const other = path.join(root, 'independent-batch');
pult = createDocumentIntake({ ...options, stateDir: path.join(root, 'other-settings'), pickFolder: async () => other });
await success('settings', settings); await success('folder'); await success('login', user);
await writeFile(path.join(await inboxPath(), 'повтор.pdf'), '%PDF-1.4 fixture A C171');
await success('analyze');
for (let i=0; i<200 && pult.busy(); i++) await delay(30);
const recovered = await success('prepare');
assert.equal(recovered.items.length, 0, JSON.stringify(recovered));
assert.equal((await success('reviewreport', {}, 'GET')).counts.uploaded, 1, JSON.stringify(recovered));
assert.equal(commits, 1); await pult.stop();
console.log('PASS: две копии, один оригинал, сбой после записи, перезапуск и сверка байтов через штатные маршруты Пульта.');

function salesFixture(kind, number) {
  const header = (kind === 'contract' ? 'Договор' : 'Заказ') + ' № ' + number;
  const sellerText = 'Исполнитель Компания C171 ИНН 2312308098';
  const buyerText = 'Заказчик Организация C171 ИНН 0107020521';
  const date = 'Дата 20.11.2026';
  const reference = kind === 'order' ? 'К договору № Д-171 от 20.11.2026' : '';
  return { pages: [[header, date, sellerText, buyerText, 'Образец 1 шт 100,00 100,00', 'Итого 100,00 руб. Без НДС', reference].join('\n')], raw: {
    ...raw, kind, kindEvidence: proof(header), number: field(number, header),
    seller: { name: 'Компания C171', inn: '2312308098', ...proof(sellerText) },
    buyer: { name: 'Организация C171', inn: '0107020521', ...proof(buyerText) },
  } };
}
const sales = path.join(root, 'sales');
const samples = [salesFixture('contract', 'Д-171'), salesFixture('order', 'З-171')];
const contractsEngine = { ...engine, analyze: args => engine.analyze(args, { stableMs: 0,
  extract: async (_file, bytes) => samples[bytes.toString().includes('order') ? 1 : 0].pages,
  propose: async ({ pages }) => samples[pages[0].startsWith('Заказ') ? 1 : 0].raw }),
};
const salesOptions = { ...options, engine: async () => contractsEngine, stateDir: path.join(root, 'sales-settings'), pickFolder: async () => sales };
let salesWrites = 0;
let lostHeader = true;
let lostAttachment = true;
contractsEngine.sendBatch = args => engine.sendBatch(args, { connect: input => {
  const api = connectApi(input);
  return { ...api,
    async post(endpoint, ...rest) {
      const result = await api.post(endpoint, ...rest);
      if (endpoint === '/salesorders') {
        salesWrites++;
        if (lostHeader) { lostHeader = false; throw new IntakeError('API_UNAVAILABLE', 'Тестовый обрыв после записи договора'); }
      }
      return result;
    },
    async patch(endpoint, ...rest) {
      const result = await api.patch(endpoint, ...rest);
      salesWrites++;
      if (lostAttachment) { lostAttachment = false; throw new IntakeError('API_UNAVAILABLE', 'Тестовый обрыв после привязки заказа'); }
      return result;
    },
  };
}});
pult = createDocumentIntake(salesOptions);
await success('settings', settings); await success('folder'); await success('login', user);
const analyze = async () => {
  await success('analyze');
  for (let i=0; i<200 && pult.busy(); i++) await delay(30);
  return success('reviewreport', {}, 'GET');
};
const transfer = async (kind, lose) => {
  const prepared = await success('prepare');
  assert.equal(prepared.items.length, 1, JSON.stringify(prepared));
  assert.equal(prepared.items[0].kind, kind);
  const sent = await call('send', { confirmationId: prepared.id });
  if (lose) assert.equal(sent.status, 409, JSON.stringify(sent));
  else assert.equal(sent.body.uploaded, 1, JSON.stringify(sent));
};
await writeFile(path.join(await inboxPath(), 'Договор.pdf'), '%PDF-1.4 fixture contract C223');
await writeFile(path.join(await inboxPath(), 'Заказ.pdf'), '%PDF-1.4 fixture order C223');
const waiting = await analyze();
assert.equal(waiting.counts.checked, 1, JSON.stringify(waiting));
assert.equal(waiting.items.find(row => row.kind === 'order')?.state, 'question', JSON.stringify(waiting));
await transfer('contract', true);
await transfer('contract', false);
const withContract = await analyze();
assert.equal(withContract.items.find(row => row.kind === 'order')?.state, 'checked', JSON.stringify(withContract));
await transfer('order', true);
await transfer('order', false);
assert.equal(salesWrites, 2);
assert.equal((await success('reviewreport', {}, 'GET')).counts.uploaded, 2);
await pult.stop();
console.log('PASS: договор и заказ покупателя привязаны без дублей при двух потерянных ответах.');

const automaticRoot = path.join(root, 'automatic');
const automaticCases = {
  'manual-fixture': 'В-84',
  'automatic-fixture': 'В-85',
  'near-fixture': 'В85',
};
const docs = new Map(Object.entries(automaticCases).map(([name, number]) => [
  '%PDF-1.4 ' + name, {
    pages: pages.map(page => page.replace('В-83', number)),
    raw: { ...raw, number: field(number, 'Счёт № ' + number), kindEvidence: proof('Счёт № ' + number) },
  },
]));
pult = createDocumentIntake({
  ...options, secureSession: null, stateDir: path.join(root, 'automatic-settings'), pickFolder: async () => automaticRoot,
  engine: async () => ({ ...engine, analyze: args => engine.analyze(args, {
    stableMs: 0, extract: async (_file, source) => docs.get(source.toString()).pages,
    propose: async ({ pages }) => [...docs.values()].find(doc => doc.pages[0] === pages[0]).raw,
  }) }),
});
await success('settings', settings); await success('folder'); await success('login', user);
await writeFile(path.join(await inboxPath(), 'Ранее проверен.pdf'), '%PDF-1.4 manual-fixture');
await success('analyze', { scope: 'incoming' });
for (let i = 0; i < 200 && pult.busy(); i++) await delay(30);
await writeFile(path.join(await inboxPath(), 'На автоматическую отправку.pdf'), '%PDF-1.4 automatic-fixture');
await writeFile(path.join(await inboxPath(), 'Сомнительный.pdf'), 'учебный неподдерживаемый файл');
await success('analyze', { scope: 'incoming', automatic: true });
for (let i = 0; i < 200 && pult.busy(); i++) await delay(30);
let autoReport = await success('reviewreport', {}, 'GET');
assert.equal(autoReport.counts.uploaded, 1, JSON.stringify(autoReport));
assert.equal(autoReport.counts.checked, 1);
assert.equal(autoReport.counts.question, 1);
await writeFile(path.join(await inboxPath(), 'Похожий номер.pdf'), '%PDF-1.4 near-fixture');
await success('analyze', { scope: 'incoming', automatic: true });
for (let i = 0; i < 200 && pult.busy(); i++) await delay(30);
autoReport = await success('reviewreport', {}, 'GET');
assert.equal(autoReport.items.find(item => item.name === 'Похожий номер.pdf').state, 'question');
assert.match(autoReport.items.find(item => item.name === 'Похожий номер.pdf').issues[0].message, /похожий номер/);
assert.equal(autoReport.counts.uploaded, 1);
await pult.stop();
console.log('PASS: автоматическая отправка учла один проверенный файл текущего разбора; прежний, похожий и сомнительный пропущены.');
