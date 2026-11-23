import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createDocumentIntake } from '../document-intake.mjs';
import { createPult } from '../server.mjs';
import { createDocumentImages } from '../ui/document-intake-images.js';

const services = { apiBase: 'http://127.0.0.1:3102/api', modelBase: 'http://127.0.0.1:1235/v1', model: 'test' };
const arrivalId = '00000000-0000-4000-8000-000000000001';
const confirmationId = '00000000-0000-4000-8000-000000000002';
const actor = '111111111111111111111111';
const jwt = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: actor, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.signature`;

test('рисунки Пульта требуют входа, revision, выбора PDF и подтверждения; active блокирует второй action', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'c239-pult-'));
  let calls = 0, release;
  const api = createDocumentIntake({ stateDir: path.join(root, 'state'), secureSession: null, pickFolder: async () => root,
    fetchFn: async () => Response.json({ access: jwt, user: { id: actor, baseRole: 'manager', canMoney: true } }),
    engine: async () => ({ configure: async () => ({ root }), status: async () => ({ counts: {}, running: false }),
      reviewStatus: async () => ({ counts: {}, items: [] }),
      prepareDocumentImages: async ({ token, arrivalId: selected }) => { assert.equal(await token(), jwt); assert.equal(selected, arrivalId); calls++; await new Promise(resolve => { release = resolve; }); return { confirmationId }; },
      sendDocumentImages: async ({ token, confirmationId: selected }) => { assert.equal(await token(), jwt); assert.equal(selected, confirmationId); calls++; return { attached: 9 }; },
    }) });
  t.after(async () => { release?.(); await api.stop(); await fs.rm(root, { recursive: true, force: true }); });
  const status = () => api.route('GET', 'status');
  const call = async (action, body = {}) => api.route('POST', action, async () => ({ revision: (await status()).body.revision, ...body }));
  await call('settings', services); await call('folder');
  assert.equal((await call('imagesprepare', { arrivalId })).status, 401);
  await call('login', { username: 'manager', password: 'fixture' });
  assert.equal((await call('imagesprepare', { arrivalId, revision: -1 })).status, 409);
  assert.equal((await call('imagesprepare', { arrivalId: '../source' })).status, 400);
  assert.equal((await call('imagessend', { arrivalId, confirmationId: 'bad' })).status, 400);
  assert.equal(calls, 0);
  const preparing = call('imagesprepare', { arrivalId });
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal((await call('imagessend', { arrivalId, confirmationId })).status, 409);
  release();
  assert.equal((await preparing).status, 200);
  assert.equal((await call('imagessend', { arrivalId, confirmationId })).body.attached, 9);
  assert.equal(calls, 2);
});

test('HTTP actions рисунков не обходят gate опасной команды; UI-модуль доступен как static', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'c239-gate-'));
  let called = false;
  const pult = createPult({ root, stateDir: path.join(root, 'state'), machine: {}, statusFn: async () => ({}),
    documentIntake: { secureSession: null, engine: async () => { called = true; return {}; } } });
  const port = await pult.listen(0);
  t.after(async () => { pult.jobs.clear(); await pult.close(); await fs.rm(root, { recursive: true, force: true }); });
  pult.jobs.set('fixture', { state: 'running', risk: 'prod-write' });
  const base = `http://127.0.0.1:${port}`;
  for (const action of ['imagesprepare', 'imagessend', 'imagescontracts']) {
    const response = await fetch(`${base}/api/document-intake/${action}`, { method: 'POST',
      headers: { 'x-pult-token': pult.token, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ arrivalId, confirmationId }) });
    assert.equal(response.status, 409);
  }
  assert.equal(called, false);
  assert.equal((await fetch(base + '/document-intake-images.js')).status, 200);
});

function element(tag, cls, text) {
  return { tag, className: cls || '', textContent: text || '', children: [], attributes: {},
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this.attributes[key] = value; }, focus() {} };
}
const descendants = root => [root, ...root.children.flatMap(descendants)];

test('preview показывает рисунок/строку и отправляет только после явного подтверждения', async () => {
  const calls = [];
  const button = (text, run) => ({ ...element('button', '', text), run });
  const preview = { confirmationId, contractNo: '17', target: services.apiBase, uniqueImages: 1, alreadyAttached: 0, warnings: [],
    items: [{ sku: 'AA-001', title: 'AA-001 Скамья', page: 1, width: 1, height: 1, preview: 'data:image/png;base64,aQ==', alreadyAttached: false }] };
  const widget = createDocumentImages({ el: element, button, actionRow: (...children) => { const el = element('div'); el.append(...children); return el; },
    getView: () => ({ revision: 7 }), canRun: () => true, setBusy() {}, refresh: async () => {},
    call: async (action, body) => { calls.push({ action, body }); return action === 'imagesprepare' ? preview : { attached: 1, added: 1 }; } });
  await widget.open({ arrivalId });
  assert.equal(calls.length, 1); assert.equal(calls[0].action, 'imagesprepare');
  const image = descendants(widget.element).find(node => node.tag === 'img');
  assert.equal(image.src, preview.items[0].preview);
  const accept = descendants(widget.element).find(node => node.textContent === 'Загрузить рисунки');
  assert.equal(accept.disabled, false);
  await accept.run();
  assert.equal(calls[1].action, 'imagessend');
  assert.deepEqual(calls[1].body, { revision: 7, arrivalId, confirmationId });
  preview.alreadyAttached = 1; preview.items[0].alreadyAttached = true;
  await widget.open({ arrivalId });
  assert.equal(descendants(widget.element).find(node => node.textContent === 'Загрузить рисунки').disabled, true);
  assert.ok(descendants(widget.element).some(node => node.textContent === 'Уже прикреплён'));
});


test('явный поиск договора по номеру передаёт выбранный ID только в prepare', async () => {
  const calls = [];
  const selectedId = '222222222222222222222222';
  const button = (text, run) => ({ ...element('button', '', text), run });
  const widget = createDocumentImages({ el: element, button,
    actionRow: (...children) => { const row = element('div'); row.append(...children); return row; },
    getView: () => ({ revision: 7 }), canRun: () => true, setBusy() {}, refresh: async () => {},
    call: async (action, body) => {
      calls.push({ action, body });
      if (action === 'imagescontracts') return { items: [{ id: selectedId, label: 'Договор № 18/11/44 · БакСтрой' }] };
      if (!body.contractId) return { selectionRequired: true };
      return { confirmationId, items: [], alreadyAttached: 0, warnings: [], uniqueImages: 0, contractNo: '18/11/44' };
    } });
  await widget.open({ arrivalId });
  const input = descendants(widget.element).find(node => node.tag === 'input'); input.value = '18/11/44';
  await descendants(widget.element).find(node => node.textContent === 'Найти договор').run();
  await descendants(widget.element).find(node => node.textContent.includes('БакСтрой')).run();
  assert.deepEqual(calls.map(item => item.action), ['imagesprepare', 'imagescontracts', 'imagesprepare']);
  assert.equal(calls[1].body.search, '18/11/44'); assert.equal(calls[2].body.contractId, selectedId);
  assert.ok(!calls.some(item => item.action === 'imagessend'));
});
