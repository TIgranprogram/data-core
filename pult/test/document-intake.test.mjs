import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { test } from 'node:test';
import { createDocumentIntake } from '../document-intake.mjs';
import { createPult } from '../server.mjs';

const access = 'fixture-access-value';
const password = 'fixture-private-password';
const services = { apiBase: 'http://127.0.0.1:3001/api', modelBase: 'http://127.0.0.1:1235/v1', model: 'учебная-модель' };

test('C171: подготовка блокирует анализ, просмотр связан с владельцем и контуром, запись не вызывается', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pult-c171-'));
  const id = '00000000-0000-4000-8000-000000000001';
  const actor = '111111111111111111111111';
  const jwt = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: actor, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.signature`;
  let prepared = false, analyzed = 0, inbox = 0, draftOwner = actor, draftTarget = `${services.apiBase}/`;
  const intake = createDocumentIntake({ stateDir: path.join(root, 'settings'), pickFolder: async () => root,
    prepare: async ({ onStep }) => { onStep({ title: 'Проверяем модель' }); return { ready: prepared, steps: [{ status: prepared ? 'ready' : 'blocked', recovery: 'Запустите модель.' }] }; },
    fetchFn: async () => Response.json({ access: jwt, user: { id: actor, baseRole: 'manager', canMoney: true } }),
    engine: async () => ({
      configure: async () => ({ root }), status: async () => ({ counts: { inbox }, running: false }),
      reviewStatus: async () => ({ counts: { pending: 0, checked: 1, question: 0, uploaded: 0 }, items: [{ arrivalId: id, name: 'Счёт.pdf', state: 'checked', version: 1, issues: [] }] }),
      analyze: async ({ token, onProgress }) => { assert.equal(await token(), jwt); analyzed++; onProgress({ total: 1, processed: 1, state: 'processing', stage: 'checked' }); return {}; },
      getDraft: async () => ({ owner: draftOwner, target: draftTarget, name: 'Счёт.pdf', version: 1, pages: ['Счёт'], raw: { number: { value: '17' } }, issues: [], history: [{ private: true }] }),
    }),
  });
  t.after(async () => { await intake.stop(); await fs.rm(root, { recursive: true, force: true }); });
  const call = async (action, body = {}, method = 'POST') => {
    const status = await intake.route('GET', 'status');
    return intake.route(method, action, async () => ({ revision: status.body.revision, ...body }));
  };
  await call('settings', services); await call('folder');
  assert.equal((await call('draft', { arrivalId: id })).status, 401);
  await call('login', { username: 'manager', password });
  assert.equal((await call('analyze', { scope: 'incoming' })).status, 409);
  assert.equal((await call('analyze', { scope: 'review' })).status, 409);
  assert.equal(analyzed, 0);
  inbox = 1;
  assert.equal((await call('analyze', { scope: 'incoming' })).status, 202);
  for (let n = 0; n < 50 && intake.busy(); n++) await wait(5);
  assert.equal(analyzed, 0);
  assert.match((await call('status', {}, 'GET')).body.progress.message, /Запустите модель/);
  prepared = true;
  assert.equal((await call('analyze')).status, 202);
  for (let n = 0; n < 50 && intake.busy(); n++) await wait(5);
  assert.equal(analyzed, 1);
  const report = await call('reviewreport', {}, 'GET');
  assert.equal(report.body.items[0].state, 'checked');
  const draft = await call('draft', { arrivalId: id });
  assert.equal(draft.status, 200);
  assert.equal(draft.body.history, undefined);
  assert.equal(draft.body.owner, undefined);
  draftOwner = '222222222222222222222222';
  assert.equal((await call('draft', { arrivalId: id })).status, 403);
  draftOwner = actor; draftTarget = 'http://127.0.0.1:3102/api/';
  assert.equal((await call('draft', { arrivalId: id })).status, 403);
  assert.equal((await call('draft', { arrivalId: '../other' })).status, 400);
});

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
    async run({ signal, onProgress, token, ...params }) {
      calls.push({ mode: 'run', ...params, token: await token() });
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

async function refreshFixture(t) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pult-intake-refresh-'));
  const documents = path.join(stateDir, 'documents');
  const minute = 60_000;
  let time = Date.UTC(2026, 10, 20, 12, 0, 0);
  let step = async () => ({});
  let receivedSession;
  let answer = 'ok';
  let account = 'owner-a';
  const calls = [];
  const credentials = [];
  let stopRefresh;
  let previousRefresh;
  const engine = {
    async configure({ root }) { return { root }; },
    async status() { return { counts: {}, running: false }; },
    async report() { return { counts: {}, items: [{ name: 'Проба.pdf', message: credentials.join(' ') }] }; },
    async run({ token }) { receivedSession = token; return step(token); },
  };
  const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.fake-signature`;
  const fetchFn = async (url, request) => {
    const login = url.endsWith('/auth/login');
    calls.push({ url, method: request.method, auth: request.headers.Authorization, redirect: request.redirect, body: request.body });
    if (!login) {
      assert.equal(request.headers.Authorization, `Bearer ${previousRefresh}`);
      assert.ok(request.signal);
      if (answer === 'revoked') return new Response('test-revoked-secret', { status: 401 });
      if (answer === 'unknown') throw new Error('test-unknown-secret');
      if (answer === 'abort') {
        stopRefresh();
        await new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true }));
      }
    }
    const sub = !login && answer === 'wrong-account' ? 'owner-unexpected' : account;
    const second = Math.floor(time / 1000);
    const access = jwt({ sub, version: 5, exp: second + 15 * 60, role: 'manager', orgId: null });
    const cookie = jwt({ sub, version: 5, exp: second + 30 * 24 * 60 * 60, rem: false });
    previousRefresh = cookie;
    credentials.push(access, cookie);
    const user = login ? { id: sub, role: 'manager', canMoney: true } : undefined;
    const headers = new Headers({ 'Set-Cookie': 'irrelevant=unused; Path=/' });
    if (answer !== 'no-cookie') headers.append('Set-Cookie', `refreshToken=${cookie}; Path=/api/auth; HttpOnly; Secure; SameSite=Strict`);
    return Response.json({ access, refresh: 'json-refresh-is-not-the-cookie', user }, { headers });
  };
  const intake = createDocumentIntake({ stateDir, engine: async () => engine, now: () => time, pickFolder: async () => documents, fetchFn });
  t.after(async () => { await intake.stop(); await fs.rm(stateDir, { recursive: true, force: true }); });
  const view = async () => (await intake.route('GET', 'status')).body;
  const post = async (action, body = {}) => intake.route('POST', action, async () => ({ ...body, revision: (await view()).revision }));
  const login = async () => post('login', { username: account, password });
  const complete = async () => {
    for (let i = 0; i < 50; i++) {
      const state = await view();
      if (!state.running) return state;
      await wait(5);
    }
    assert.fail('Разбор не завершился');
  };
  await post('folder');
  await post('settings', services);
  return {
    view, post, login, complete, calls, credentials, documents, stateDir,
    report: () => intake.route('GET', 'report'),
    advance: (minutes) => { time += minutes * minute; },
    runWith: (fn) => { step = fn; },
    previousProvider: () => receivedSession,
    account: (value) => { account = value; },
    answer: (value) => { answer = value; },
    refreshStarted: () => new Promise((resolve) => { stopRefresh = resolve; }),
  };
}

test('длинный пакет обновляет access дважды заранее, один refresh для параллельных запросов', async (t) => {
  const f = await refreshFixture(t);
  const first = await f.login();
  assert.deepEqual(first, { status: 200, body: { signedIn: true } });
  const tokens = [];
  f.runWith(async (token) => {
    tokens.push(await token());
    f.advance(14.5);
    tokens.push(...await Promise.all([token(), token()]));
    f.advance(15.5);
    tokens.push(await token());
    return {};
  });
  assert.equal((await f.post('run')).status, 202);
  const result = await f.complete();
  assert.equal(result.progress.state, 'finished');
  assert.equal(result.signedIn, true);
  assert.deepEqual(tokens, [f.credentials[0], f.credentials[2], f.credentials[2], f.credentials[4]]);
  const refreshes = f.calls.filter(({ url }) => url.endsWith('/auth/refresh'));
  assert.deepEqual(refreshes, [1, 3].map((index) => ({
    url: `${services.apiBase}/auth/refresh`, method: 'POST', auth: `Bearer ${f.credentials[index]}`, redirect: 'error', body: '{}',
  })));
  const report = await f.report();
  const config = await fs.readFile(path.join(f.stateDir, 'document-intake.json'), 'utf8');
  const exposed = JSON.stringify([first, result, report, config, await fs.readdir(f.stateDir)]);
  assert.ok(f.credentials.every((secret) => !exposed.includes(secret)));
  assert.doesNotMatch(exposed, /json-refresh-is-not-the-cookie|fixture-private-password/);

  const old = f.previousProvider();
  await f.post('logout');
  assert.equal((await f.view()).signedIn, false);
  f.account('owner-b');
  assert.equal((await f.login()).body.signedIn, true);
  await assert.rejects(old(), { code: 'AUTH' });
  await f.post('settings', { ...services, apiBase: 'http://127.0.0.1:3102/api' });
  assert.equal((await f.view()).signedIn, false);
  await f.login();
  await assert.rejects(old(), { code: 'AUTH' });
  assert.equal(f.calls.at(-1).url, 'http://127.0.0.1:3102/api/auth/login');
});

for (const scenario of ['revoked', 'unknown', 'wrong-account', 'no-cookie']) {
  test(`разбор приостанавливается при сбое обновления сессии (${scenario})`, async (t) => {
    const f = await refreshFixture(t);
    if (scenario === 'no-cookie') f.answer(scenario);
    assert.equal((await f.login()).body.signedIn, true);
    f.answer(scenario);
    f.runWith(async (token) => {
      await token();
      f.advance(16);
      await token();
      assert.fail('Токен не должен дойти до операции DataCore');
    });
    assert.equal((await f.post('run')).status, 202);
    const result = await f.complete();
    assert.equal(result.signedIn, false);
    assert.equal(result.progress.state, 'stopped');
    assert.match(result.progress.message, /Войдите/);
    assert.doesNotMatch(JSON.stringify(result), /test-(revoked|unknown)-secret/);
    assert.equal(f.calls.length, scenario === 'no-cookie' ? 1 : 2);
  });
}

test('остановка отменяет запрос refresh и сохраняет сессию для нового запуска', async (t) => {
  const f = await refreshFixture(t);
  await f.login();
  f.answer('abort');
  const started = f.refreshStarted();
  f.runWith(async (token) => { f.advance(15); await token(); });
  assert.equal((await f.post('run')).status, 202);
  await started;
  assert.equal((await f.post('stop')).status, 202);
  const stopped = await f.complete();
  assert.equal(stopped.signedIn, true);
  assert.match(stopped.progress.message, /разбор остановлен/i);
  f.answer('ok');
  f.runWith(async (token) => { await token(); return {}; });
  assert.equal((await f.post('run')).status, 202);
  assert.equal((await f.complete()).progress.state, 'finished');
  assert.equal(f.calls.filter(({ url }) => url.endsWith('/auth/refresh')).length, 2);
});
