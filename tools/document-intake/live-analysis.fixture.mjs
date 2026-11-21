// Проверенный координатором C171: только GET DataCore, синтетический PDF, JWT только stdin/память.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createDocumentIntake } from '../../pult/document-intake.mjs';
import * as intake from '../document-intake/index.mjs';
import { analyze } from '../document-intake/analysis.mjs';
import { connectApi } from '../document-intake/api.mjs';
import { validInn } from '../document-intake/proposal.mjs';
import { sessionFromStdin } from '../ai-tester/stand-session.mjs';

const session = await sessionFromStdin(process.stdin)('http://localhost:3102');
const apiBase = 'http://127.0.0.1:3102/api';
const modelBase = 'http://127.0.0.1:1235/v1';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const root = await fs.mkdtemp(path.join(repo, 'tools/logs/c171-live-'));
const models = await fetch(`${modelBase}/models`, { signal: AbortSignal.timeout(5000) }).then(r => r.json());
const model = models.data.find(row => /gemma.*12b/i.test(row.id))?.id;
assert.ok(model, 'Нужна локальная Gemma 12B');
const api = connectApi({ apiBase, token: session.access });
const parties = [];
for (let page = 1; page <= 100; page++) {
  const result = await api.get('/organizations', { page, limit: 100 });
  parties.push(...result.items);
  if (parties.length >= result.total) break;
}
const unique = party => validInn(party.inn) && parties.filter(row => row.inn === party.inn).length === 1;
const seller = parties.find(row => !row.deletedAt && !row.isOurCompany && [].concat(row.type || []).includes('supplier') && unique(row));
const buyer = parties.find(row => !row.deletedAt && row.isOurCompany && unique(row));
assert.ok(seller && buyer, 'Нужны однозначные контрагенты на копии');
await intake.configure({ root });
const text = [
  'Счёт № C171-TEST-20261121', 'Дата: 21.11.2026',
  `Поставщик ${seller.name} ИНН ${seller.inn}`, `Покупатель ${buyer.name} ИНН ${buyer.inn}`,
  'Валюта: RUB руб.', 'Учебная позиция 2 шт 50,00 100,00', 'Всего к оплате 100,00 руб.', 'Без НДС',
].join('\n');
await promisify(execFile)('python', ['-c',
  "import fitz,sys; d=fitz.open(); p=d.new_page(); p.insert_font(fontname='local',fontfile='C:/Windows/Fonts/arial.ttf'); p.insert_textbox(fitz.Rect(40,40,550,780),sys.argv[2],fontname='local',fontsize=11); d.save(sys.argv[1]); d.close()",
  path.join(root, 'Inbox', 'Учебный счёт.pdf'), text], { windowsHide: true, timeout: 20_000 });
let mutations = 0;
const broker = createDocumentIntake({ stateDir: path.join(root, 'settings'), pickFolder: async () => root,
  fetchFn: async (url, options) => {
    assert.equal(url, `${apiBase}/auth/login`); assert.equal(options.method, 'POST');
    return Response.json(session);
  },
  engine: async () => ({ ...intake,
    analyze: options => analyze(options, { stableMs: 0, connect: params => {
      const actual = connectApi(params);
      return { ...actual, post() { mutations++; throw new Error('Запись запрещена'); } };
    } }),
  }),
});
const call = async (action, body = {}, method = 'POST') => {
  const snapshot = await broker.route('GET', 'status');
  return broker.route(method, action, async () => ({ ...body, revision: snapshot.body.revision }));
};
try {
  assert.equal((await call('settings', { apiBase, modelBase, model })).status, 200);
  await call('folder');
  assert.equal((await call('login', { username: 'stdin-session', password: 'not-a-real-password' })).status, 200);
  assert.equal((await call('analyze')).status, 202);
  const deadline = Date.now() + 7 * 60_000;
  while (broker.busy() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500));
  assert.ok(!broker.busy(), 'Проверка должна закончиться');
  const status = (await call('status', {}, 'GET')).body;
  console.log(JSON.stringify({ preparation: status.preparation?.steps?.map(row => ({ id: row.id, status: row.status })) }));
  assert.equal(status.preparation.ready, true, 'Реальные preflight PDF/model/API');
  assert.equal(status.progress.state, 'finished', 'Анализ не должен зависнуть');
  const report = (await call('reviewreport', {}, 'GET')).body;
  assert.equal(report.items.length, 1, 'Канонический target не должен скрыть черновик');
  const draft = await call('draft', { arrivalId: report.items[0].arrivalId });
  assert.equal(draft.status, 200);
  assert.ok(draft.body.pages[0].replaceAll('\u00ad', '-').includes('C171-TEST'));
  assert.ok(draft.body.raw && draft.body.version === 1);
  assert.equal(mutations, 0);
  assert.equal((await call('report', {}, 'GET')).body.items.length, 0, 'C169 не раскрывает C171');
  await call('logout');
  assert.equal((await call('reviewreport', {}, 'GET')).status, 401);
  assert.equal((await call('draft', { arrivalId: report.items[0].arrivalId })).status, 401);
  console.log(JSON.stringify({ result: 'PASS', model, state: report.items[0].state,
    preflight: status.preparation.steps.map(row => ({ id: row.id, status: row.status })),
    mutations, output: path.relative(repo, root) }));
} catch (error) {
  console.error(JSON.stringify({ result: 'FAIL', message: error instanceof assert.AssertionError ? error.message : 'Сбой связки без вывода сетевых данных' }));
  process.exitCode = 1;
} finally { await broker.stop(); }
