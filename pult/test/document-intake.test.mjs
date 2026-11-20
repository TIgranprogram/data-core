import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { test } from 'node:test';
import { createPult } from '../server.mjs';

const access = 'fixture-access-value';
const password = 'fixture-private-password';
const services = { apiBase: 'http://127.0.0.1:3001/api', modelBase: 'http://127.0.0.1:1235/v1', model: 'учебная-модель' };

test('разбор документов: границы запросов, сессия, один процесс, остановка, отчёт и восстановление', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pult-intake-api-'));
  const stateDir = path.join(root, 'settings');
  const documents = path.join(root, 'Документы и отчёты');
  const calls = [];
  const opens = [];
  const counts = { inbox: 2, processing: 0, ready: 1, question: 1 };
  const questionId = '00000000-0000-4000-8000-000000000001';
  const items = [{ arrivalId: questionId, name: 'Счёт.pdf', state: 'question', outcome: 'question', message: 'Нужна сверка строк.', action: 'Откройте Снабжение.', internal: 'сырой ответ сервера' }];
  let selected = '';
  let loginRole = 'manager';
  let idleCalls = 0;
  const fakeEngine = {
    async configure(params) { assert.equal(params.root, documents); return { root: documents, folders: {} }; },
    async status(params) { assert.equal(params.root, documents); return { counts, running: false }; },
    async report(params) { assert.equal(params.root, documents); return { counts, items, token: access }; },
    async run({ signal, onProgress, ...params }) {
      calls.push({ mode: 'run', ...params });
      onProgress({ processed: 1, total: 2, state: 'processing', current: 'Договор.pdf', token: access });
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      counts.processing = 1;
      return { counts, items, stopped: { code: 'ABORTED', message: 'fixture' } };
    },
    async retry(params) { calls.push({ mode: 'retry', arrivalIds: params.arrivalIds }); return { counts, items }; },
    async resume(params) {
      calls.push({ mode: 'resume', root: params.root });
      counts.processing = 0;
      return { counts, items, stopped: { code: 'AUTH', message: `error header Bearer ${access}` } };
    },
  };
  const options = {
    root, stateDir, machine: {}, statusFn: async () => ({ gateFiles: [] }), onIdle: () => { idleCalls++; }, idleDelayMs: 40,
    documentIntake: {
      engine: async () => fakeEngine,
      fetchFn: async (url, init) => {
        calls.push({ url, init });
        return Response.json({ access, refresh: 'fixture-refresh-value', user: { baseRole: loginRole } });
      },
      pickFolder: async () => selected,
      openFolder: async (value) => opens.push(value),
    },
  };
  let pult = createPult(options);
  let port = await pult.listen(0);
  t.after(async () => { await pult.close(); await fs.rm(root, { recursive: true, force: true }); });

  function raw(action, { body, headers = {}, query = '' } = {}) {
    const requestHeaders = {
      'X-Pult-Token': pult.token,
      Origin: `http://127.0.0.1:${port}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    };
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: `/api/document-intake/${action}${query}`, method: body ? 'POST' : 'GET', headers: requestHeaders }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(text), text }));
      });
      req.on('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  const post = async (action, body = {}) => {
    const { json } = await raw('status');
    return raw(action, { body: { revision: json.revision, ...body } });
  };
  async function until(predicate) {
    for (let i = 0; i < 50; i++) {
      const { json } = await raw('status');
      if (predicate(json)) return json;
      await wait(20);
    }
    assert.fail('Состояние разбора не обновилось');
  }

  assert.equal((await raw('status', { headers: { 'X-Pult-Token': '' }, query: `?t=${pult.token}` })).status, 401);
  assert.equal((await raw('status', { headers: { Host: 'outside.example' } })).status, 403);
  assert.equal((await raw('login', { body: {}, headers: { Origin: `http://localhost:${port}` } })).status, 403);
  assert.equal((await post('login', { username: 'manager', password })).status, 409);
  for (const apiBase of ['https://outside.example/api', 'http://127.0.0.1@outside.example:3001/api', 'http://127.0.0.1:3001/api?x=1', 'http://2130706433:3001/api', 'https://kppdf-crm.ru:444/db/api']) {
    assert.equal((await post('settings', { ...services, apiBase })).status, 400, apiBase);
  }
  for (const modelBase of ['https://outside.example/v1', 'http://localhost:1235/path/v1', 'http://127.0.0.1:1235/v1#key']) {
    assert.equal((await post('settings', { ...services, modelBase })).status, 400, modelBase);
  }
  assert.deepEqual(calls, [], 'недоверенный адрес не вызвал сетевые запросы');
  assert.equal((await post('settings', { ...services, token: access, password, root: 'Чужая папка' })).status, 200);
  assert.equal((await raw('status')).json.settings.root, '');
  assert.equal((await post('folder', { root: 'Чужая папка' })).json.cancelled, true);
  selected = documents;
  assert.equal((await post('folder', { root: 'Чужая папка' })).json.selected, true);
  assert.equal((await post('inbox', { path: 'Чужая папка' })).status, 200);
  assert.equal((await post('question', { path: 'Чужая папка' })).status, 200);
  assert.deepEqual(opens, [path.join(documents, 'Inbox'), path.join(documents, 'Question')]);

  assert.equal((await post('run')).status, 401);
  loginRole = 'user';
  assert.equal((await post('login', { username: 'manager', password })).status, 403);
  loginRole = 'admin';
  assert.equal((await post('login', { username: 'fixture-owner', password })).json.signedIn, true);
  loginRole = 'manager';
  const signed = await post('login', { username: 'manager', password });
  assert.deepEqual(signed.json, { signedIn: true });
  assert.equal(calls[0].url, `${services.apiBase}/auth/login`);
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].init.body), { username: 'manager', password, remember: false });
  assert.equal((await post('run')).status, 202);
  const live = await until((result) => result.running && result.progress.processed === 1);
  assert.deepEqual(calls.at(-1), { mode: 'run', ...services, root: documents, token: access });
  assert.equal(live.progress.current, 'Договор.pdf');
  assert.doesNotMatch(JSON.stringify(live), /fixture-access/);
  assert.equal((await post('resume')).status, 409);
  assert.equal((await post('settings', { ...services, apiBase: 'http://localhost:3003/api' })).status, 409);
  const idleBefore = idleCalls;
  await wait(80);
  assert.equal(idleCalls, idleBefore, 'закрытие окна не завершает процесс во время разбора');
  assert.equal((await post('stop')).status, 202);
  assert.match((await until((value) => !value.running)).progress.message, /разбор остановлен/i);
  const report = await raw('report');
  assert.equal(report.json.items[0].action, 'Откройте Снабжение.');
  assert.doesNotMatch(report.text, /fixture-access|сырой ответ/);
  assert.equal(report.json.items[0].arrivalId, questionId);
  for (const arrivalIds of [[], ['../Ready'], [questionId, questionId], Array(101).fill(questionId)]) assert.equal((await post('retry', { arrivalIds })).status, 400);
  assert.equal((await post('retry', { arrivalIds: [questionId] })).status, 202);
  await until(value => !value.running);
  assert.deepEqual(calls.at(-1), { mode: 'retry', arrivalIds: [questionId] });
  assert.equal((await post('resume')).status, 202);
  const expired = await until((value) => !value.running);
  assert.equal(expired.signedIn, false);
  assert.match(expired.progress.message, /войдите/i);
  assert.doesNotMatch(JSON.stringify(expired), /fixture-access/);

  await post('login', { username: 'manager', password });
  const oldRevision = (await raw('status')).json.revision;
  await post('settings', { ...services, apiBase: 'http://localhost:3003/api' });
  assert.equal((await raw('status')).json.signedIn, false, 'выход при смене сайта');
  const beforeStaleClick = calls.length;
  assert.equal((await post('login', { revision: oldRevision, username: 'manager', password })).status, 409);
  assert.equal((await post('run', { revision: oldRevision })).status, 409);
  assert.equal(calls.length, beforeStaleClick, 'устаревшая вкладка не отправляет пароль и не запускает запись в новый контур');
  const config = await fs.readFile(path.join(stateDir, 'document-intake.json'), 'utf8');
  assert.deepEqual(JSON.parse(config), { ...services, apiBase: 'http://127.0.0.1:3003/api', root: documents });
  assert.doesNotMatch(config, /fixture-private|fixture-access|fixture-refresh/);

  await pult.close();
  pult = createPult(options);
  port = await pult.listen(0);
  const reopened = await raw('status');
  assert.deepEqual(reopened.json.settings, JSON.parse(config));
  assert.equal(reopened.json.signedIn, false);
  assert.equal((await raw('report')).json.items[0].name, 'Счёт.pdf');
  assert.ok(calls.filter((call) => call.url).every((call) => call.url.startsWith('http://127.0.0.1:')));
});
