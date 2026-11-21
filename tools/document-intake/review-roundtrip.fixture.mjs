// Вызывается только e2e C171 с выделенным сервером Nest, временной папкой и учебным логином.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
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
const inbox = path.join(documents,'Inbox');
for (const [name, bytes] of [['1.pdf','%PDF-1.4 fixture A C171'],['2.pdf','порченый'],['3.pdf','%PDF-1.4 fixture A C171']]) await writeFile(path.join(inbox,name),bytes);
await success('analyze');
for (let i=0; i<200 && pult.busy(); i++) await delay(30);
const report = await success('reviewreport', {}, 'GET');
assert.equal(report.counts.checked, 2, JSON.stringify(report)); assert.equal(report.counts.question, 1);
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
assert.equal(final.counts.uploaded, 2, JSON.stringify(final)); assert.equal(final.counts.question, 1);
assert.equal(commits, 1); await pult.stop();
const other = path.join(root, 'independent-batch');
pult = createDocumentIntake({ ...options, stateDir: path.join(root, 'other-settings'), pickFolder: async () => other });
await success('settings', settings); await success('folder'); await success('login', user);
await writeFile(path.join(other, 'Inbox', 'повтор.pdf'), '%PDF-1.4 fixture A C171');
await success('analyze');
for (let i=0; i<200 && pult.busy(); i++) await delay(30);
const recovered = await success('prepare');
assert.equal(recovered.items.length, 0, JSON.stringify(recovered));
assert.equal((await success('reviewreport', {}, 'GET')).counts.uploaded, 1, JSON.stringify(recovered));
assert.equal(commits, 1); await pult.stop();
console.log('PASS: две копии, один оригинал, сбой после записи, перезапуск и сверка байтов через штатные маршруты Пульта.');
