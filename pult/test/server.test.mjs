// Сервер пульта на учебном каталоге: команды безвредные, прод и скрипты проекта не запускаются.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createPult } from '../server.mjs';

const say = (js) => ({ node: ['-e', js] });
const fake = {
  SECTIONS: [{ id: 's', title: 'Учебный', icon: '•', hint: 'x' }],
  RISKS: { read: { label: 'r', hint: 'r' }, 'prod-write': { label: 'w', hint: 'w' }, danger: { label: 'd', hint: 'd' } },
  ADVICE: [{ match: 'СТОП', say: 'совет' }],
  NOT_ON_BUTTONS: {},
  COMMANDS: [
    { id: 'hello', section: 's', title: 'Привет', hint: 'h', time: '1', risk: 'read', run: say("console.log('привет'); console.log('A_PASSWORD=qwe')") },
    { id: 'fail', section: 's', title: 'Сбой', hint: 'h', time: '1', risk: 'read', run: say("console.log('СТОП'); process.exit(3)") },
    { id: 'long', section: 's', title: 'Долго', hint: 'h', time: '1', risk: 'read', run: say('setTimeout(()=>{}, 60000)') },
    { id: 'write', section: 's', title: 'Запись', hint: 'h', time: '1', risk: 'prod-write', confirm: 'да?', run: say('setTimeout(()=>{}, 60000)') },
    { id: 'write2', section: 's', title: 'Запись 2', hint: 'h', time: '1', risk: 'prod-write', confirm: 'да?', run: say("console.log('w2')") },
    { id: 'boom', section: 's', title: 'Опасно', hint: 'h', time: '1', risk: 'danger', confirm: 'да?', word: 'СЛОВО', run: say("console.log('boom')") },
    { id: 'pick', section: 's', title: 'Выбор', hint: 'h', time: '1', risk: 'read', params: [{ name: 'n', label: 'Н', options: [{ value: '1', label: '1' }] }], run: say("console.log('p')") },
  ],
};

const machine = { bash: null, gitRoot: null, docker: null, route: null, home: os.homedir() };
let pult, port, logDir;

before(async () => {
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pult-'));
  pult = createPult({ catalog: fake, machine, logDir, statusFn: async () => ({ fake: true }) });
  port = await pult.listen(0);
});
after(async () => {
  for (const j of pult.jobs.values()) if (j.state === 'running') process.kill(j.pid);
  await pult.close();
});

function raw(pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, (res) => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { s += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: s, json: () => JSON.parse(s) }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
const api = (p, body) => raw(p, { method: body ? 'POST' : 'GET', headers: { 'X-Pult-Token': pult.token, 'Content-Type': 'application/json' }, body });

async function finished(id) {
  for (let i = 0; i < 200; i++) {
    const j = pult.jobs.get(id);
    if (j.state !== 'running') return j;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('команда не завершилась');
}

test('без ключа сессии — отказ, на странице ключ есть', async () => {
  assert.equal((await raw('/api/catalog')).status, 401);
  assert.equal((await raw('/api/run', { method: 'POST', body: { id: 'hello' } })).status, 401);
  assert.ok((await raw('/')).text.includes(pult.token));
});

test('чужой Host и чужой Origin — отказ', async () => {
  const h = { 'X-Pult-Token': pult.token };
  assert.equal((await raw('/api/catalog', { headers: { ...h, Host: 'evil.example' } })).status, 403);
  assert.equal((await raw('/', { headers: { Host: 'evil.example' } })).status, 403);
  assert.equal((await raw('/api/catalog', { headers: { ...h, Origin: 'https://evil.example' } })).status, 403);
});

test('запуск только из каталога', async () => {
  assert.equal((await api('/api/run', { id: 'нет такой' })).status, 404);
  assert.equal((await api('/api/run', { id: 'pick', params: { n: '2' } })).status, 400);
  assert.equal((await api('/api/run', { id: 'pick', params: { n: '1', x: 'y' } })).status, 400);
});

test('вывод, маска пароля, журнал на диске', async () => {
  const { job } = (await api('/api/run', { id: 'hello' })).json();
  const j = await finished(job.id);
  assert.equal(j.state, 'ok');
  assert.deepEqual(j.lines, ['привет', 'A_PASSWORD=***']);
  const file = fs.readdirSync(logDir).find((f) => f.endsWith('-hello.log'));
  await new Promise((r) => setTimeout(r, 50));
  const text = fs.readFileSync(path.join(logDir, file), 'utf8');
  assert.ok(text.includes('привет') && !text.includes('qwe'));
});

test('код ошибки и подсказка', async () => {
  const { job } = (await api('/api/run', { id: 'fail' })).json();
  const j = await finished(job.id);
  assert.equal(j.state, 'fail');
  assert.equal(j.code, 3);
  assert.deepEqual(j.advice, ['совет']);
});

test('запись без подтверждения не стартует — проверяет сервер', async () => {
  assert.equal((await api('/api/run', { id: 'write2' })).status, 403);
  assert.equal((await api('/api/run', { id: 'boom', confirmed: true })).status, 403);
  assert.equal((await api('/api/run', { id: 'boom', confirmed: true, word: 'ДРУГОЕ' })).status, 403);
  const ok = await api('/api/run', { id: 'boom', confirmed: true, word: 'СЛОВО' });
  assert.equal(ok.status, 200);
  await finished(ok.json().job.id);
});

test('две записи на сайт разом и повтор команды — отказ, Остановить работает', async () => {
  const { job } = (await api('/api/run', { id: 'write', confirmed: true })).json();
  assert.equal((await api('/api/run', { id: 'write2', confirmed: true })).status, 409);
  assert.equal((await api('/api/run', { id: 'write', confirmed: true })).status, 409);
  const read = (await api('/api/run', { id: 'hello' })).json();
  await finished(read.job.id);
  assert.equal((await api('/api/stop', { id: job.id })).status, 200);
  assert.equal((await finished(job.id)).state, 'stopped');
  assert.equal((await api('/api/run', { id: 'write2', confirmed: true })).status, 200);
});

test('вкладка закрывается, идущая команда остаётся', async () => {
  const done = (await api('/api/run', { id: 'hello' })).json().job;
  await finished(done.id);
  const live = (await api('/api/run', { id: 'long' })).json().job;
  const one = (await api('/api/close', { ids: [done.id, live.id] })).json();
  assert.deepEqual(one.closed, [done.id]);
  assert.ok(!pult.jobs.has(done.id));
  const other = (await api('/api/run', { id: 'hello' })).json().job;
  await finished(other.id);
  const all = (await api('/api/close', {})).json();
  assert.ok(all.closed.includes(other.id));
  assert.ok(pult.jobs.has(live.id) && all.running === 1);
  await api('/api/stop', { id: live.id });
  await finished(live.id);
});

test('в каталоге для страницы нет способа запуска', async () => {
  const text = (await api('/api/catalog')).text;
  assert.ok(!text.includes('"run"'));
});
