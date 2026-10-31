#!/usr/bin/env node
// Пульт data-core: локальный сервер окна с кнопками. Без зависимостей. Запуск — pult/Pult.cmd.
//   node pult/server.mjs [--no-open]   --no-open: без окна и без автовыхода (проверка, отладка)
// Доступ только с этого ПК: адрес 127.0.0.1, проверка Host и Origin, ключ сессии в каждом запросе.
// Запускается только то, что есть в catalog.mjs. Подтверждение рабочего сайта проверяет сервер, не страница.
import { spawn, execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import * as defaultCatalog from './catalog.mjs';
import { advise, LEVELS, runKey, todoDone } from './advisor.mjs';
import { auditCatalog, auditProblems } from './audit.mjs';
import { ROOT, ROUTE_LABEL, adviceFor, buildRun, childEnv, cleanLine, detectMachine, listProdScripts, missingNeeds, validateParams } from './dispatch.mjs';

const UI_DIR = path.join(ROOT, 'pult', 'ui');
const STATIC = { '/app.js': 'text/javascript; charset=utf-8', '/style.css': 'text/css; charset=utf-8', '/icon.svg': 'image/svg+xml' };
const PROD_URL = 'https://kppdf-crm.ru/db';
const MAX_JOB_LINES = 20000;
const KEEP_LOGS = 200;
const NEEDS_CONFIRM = new Set(['prod-write', 'danger']);

const sh = (file, args, timeout = 8000) => new Promise((res) => {
  execFile(file, args, { cwd: ROOT, timeout, windowsHide: true, encoding: 'utf8' }, (err, stdout) => res({ ok: !err, out: stdout || '' }));
});

async function fetchJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return { ok: r.ok, code: r.status, json: await r.json().catch(() => null) };
  } catch { return { ok: false, code: 0, json: null }; }
}

/** Сколько коммитов кода после версии на сайте и после последней выкладки с пульта: меньшее из двух. */
async function countUndeployed(bases) {
  const list = bases.filter((b) => /^[0-9a-f]{6,40}$/.test(b || ''));
  const counts = await Promise.all(list.map((b) => sh('git', ['rev-list', '--count', `${b}..HEAD`, '--', 'backend', 'deploy', 'docker-compose.prod.yml'])));
  const ok = counts.filter((c) => c.ok).map((c) => Number(c.out.trim()));
  return ok.length ? Math.min(...ok) : 0;
}

/** Полоса состояния вверху окна. Только чтение. */
async function readStatus(machine, runs = {}) {
  const [branch, counts, gate, all, docker, admin, ready, version] = await Promise.all([
    sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    sh('git', ['rev-list', '--left-right', '--count', 'HEAD...@{u}']),
    sh('git', ['-c', 'core.quotepath=false', 'status', '--porcelain', '--', 'backend', 'deploy', 'docker-compose.prod.yml']),
    sh('git', ['status', '--porcelain']),
    machine.docker ? sh('docker', ['ps', '--format', '{{.Names}}'], 6000) : { ok: false, out: '' },
    sh('net', ['session']),
    fetchJson(`${PROD_URL}/api/health/ready`),
    fetchJson(`${PROD_URL}/app/version.json`),
  ]);
  const [ahead, behind] = counts.out.trim().split(/\s+/).map(Number);
  const lines = (s) => s.split(/\r?\n/).filter(Boolean);
  const undeployed = await countUndeployed([version.json?.v, runs['deploy-release']?.code === 0 ? runs['deploy-release'].commit : null]);
  return {
    branch: branch.out.trim() || '?',
    ahead: ahead || 0,
    behind: behind || 0,
    gateFiles: lines(gate.out).map((l) => l.slice(3)),
    dirty: lines(all.out).length,
    docker: !!docker.ok,
    nightStand: /^dcnight/m.test(docker.out),
    localSite: /^datacore-backend$/m.test(docker.out),
    admin: !!admin.ok,
    route: machine.route ? ROUTE_LABEL[machine.route] : null,
    undeployed,
    site: ready.ok,
    version: version.json?.v ? `${version.json.v}` : null,
  };
}

export function createPult({ catalog = defaultCatalog, machine = detectMachine(), root = ROOT, logDir = path.join(root, 'pult', 'logs'), onIdle = null, statusFn = readStatus } = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const jobs = new Map();
  const clients = new Set();
  let port = 0;
  let idleTimer = null;
  const prodScripts = () => listProdScripts(root);
  const runsFile = path.join(logDir, 'runs.json');

  /** Поручения Claude пользователю. Файл в git: одинаков дома и на работе. */
  function readTodo() {
    try { return JSON.parse(fs.readFileSync(path.join(root, 'pult', 'todo.json'), 'utf8')); } catch { return []; }
  }

  /** Когда и чем кончился последний запуск каждой команды: основа экрана «Что делать сейчас». */
  function readRuns() {
    try { return JSON.parse(fs.readFileSync(runsFile, 'utf8')); } catch { return {}; }
  }

  function saveRun(job) {
    if (job.state === 'stopped') return;
    const runs = readRuns();
    const text = job.lines.filter((l) => l.trim());
    runs[job.cmdId] = {
      at: job.endedAt, code: job.state === 'found' ? 0 : job.code, commit: job.commit,
      last: (text[text.length - 1] || '').slice(0, 200),
      bad: text.filter((l) => l.startsWith('✗')).slice(0, 3).map((l) => l.slice(0, 200)),
    };
    // команда с полями (какой скрипт) — ещё и под ключом с ними: пункт дел со своим скриптом закрывается только своим запуском
    const pk = runKey(job.cmdId, job.params); if (pk !== job.cmdId) runs[pk] = runs[job.cmdId];
    fs.writeFileSync(runsFile, JSON.stringify(runs, null, 1));
  }

  const send = (event) => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of clients) c.write(data);
  };

  const running = () => [...jobs.values()].filter((j) => j.state === 'running');

  function checkIdle() {
    clearTimeout(idleTimer);
    if (!onIdle || clients.size || running().length) return;
    idleTimer = setTimeout(() => { if (!clients.size && !running().length) onIdle(); }, 15000);
  }

  function publicCatalog() {
    const scripts = prodScripts();
    return {
      groups: catalog.GROUPS,
      levels: LEVELS,
      switches: catalog.SWITCHES || [],
      sections: catalog.SECTIONS,
      risks: catalog.RISKS,
      problems: auditProblems(auditCatalog(catalog, root)),
      commands: catalog.COMMANDS.map(({ run, ...c }) => ({
        ...c,
        blocked: missingNeeds(c, machine),
        kind: run.open ? 'link' : run.folder ? 'folder' : 'job',
        params: (c.params || []).map((p) => (p.from === 'prodScripts'
          ? { ...p, options: scripts.map((s) => ({ value: s, label: s })) } : p)),
      })),
    };
  }

  function rotateLogs() {
    const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.log')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_LOGS))) fs.unlinkSync(path.join(logDir, f));
  }

  function startJob(cmd, spec) {
    fs.mkdirSync(logDir, { recursive: true });
    const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().replace(/\D/g, '').slice(0, 14);
    const id = crypto.randomBytes(6).toString('hex');
    const logFile = path.join(logDir, `${stamp}-${cmd.id}.log`);
    const log = fs.createWriteStream(logFile);
    const job = { id, cmdId: cmd.id, title: cmd.title, risk: cmd.risk, state: 'running', startedAt: Date.now(), lines: [], code: null, advice: [], logFile: path.relative(root, logFile) };
    jobs.set(id, job);
    sh('git', ['rev-parse', 'HEAD']).then((r) => { job.commit = r.out.trim(); });
    send({ type: 'start', job: summary(job) });

    const child = spawn(spec.file, spec.args, { cwd: spec.cwd, env: { ...childEnv(machine), ...spec.env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    job.pid = child.pid;
    let pending = '';
    const emit = (raw) => {
      const line = cleanLine(raw);
      if (job.lines.length < MAX_JOB_LINES) job.lines.push(line);
      log.write(`${line}\n`);
      send({ type: 'line', id, line });
    };
    // Вывод идёт целыми строками: иначе пароль, разорванный на два куска, прошёл бы мимо маски.
    const feed = (decoder) => (chunk) => {
      pending += decoder.write(chunk);
      const parts = pending.split(/\r\n|\n|\r/);
      pending = parts.pop();
      parts.forEach(emit);
    };
    child.stdout.on('data', feed(new StringDecoder('utf8')));
    child.stderr.on('data', feed(new StringDecoder('utf8')));
    let failedToStart = false;
    child.on('error', (e) => { failedToStart = true; emit(`Не удалось запустить: ${e.message}`); finish(127); });
    child.on('close', (code) => { if (!failedToStart) finish(code ?? 1); });

    let closed = false;
    function finish(code) {
      if (closed) return;
      closed = true;
      if (pending) { emit(pending); pending = ''; }
      job.code = code;
      job.state = job.stopped ? 'stopped' : code === 0 ? 'ok' : cmd.run.soft && code === 1 ? 'found' : 'fail';
      job.endedAt = Date.now();
      job.advice = adviceFor(job.lines.join('\n'), catalog.ADVICE);
      log.end();
      rotateLogs();
      saveRun(job);
      send({ type: 'end', job: summary(job) });
      checkIdle();
    }
    return job;
  }

  const summary = ({ lines, pid, ...j }) => j;

  function stopJob(job) {
    job.stopped = true;
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(job.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else process.kill(job.pid);
  }

  function openExternal(target) {
    spawn('explorer.exe', [target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }

  /** Одна кнопка: проверки → запуск. Ошибка — { status, error }. */
  function runCommand({ id, params, confirmed, word }) {
    const cmd = catalog.COMMANDS.find((c) => c.id === id);
    if (!cmd) return { status: 404, error: 'Такой команды нет в каталоге' };
    const blocked = missingNeeds(cmd, machine);
    if (blocked.length) return { status: 409, error: blocked[0] };
    let values;
    try { values = validateParams(cmd, params, prodScripts()); } catch (e) { return { status: 400, error: e.message }; }
    if ((NEEDS_CONFIRM.has(cmd.risk) || cmd.confirm) && confirmed !== true) return { status: 403, error: 'Нужно подтверждение' };
    if (cmd.word && word !== cmd.word) return { status: 403, error: `Для запуска введите слово ${cmd.word}` };
    const spec = buildRun(cmd, values, machine, root);
    if (spec.open || spec.folder) { openExternal(spec.open || spec.folder); return { opened: true }; }
    const live = running();
    if (live.some((j) => j.cmdId === id)) return { status: 409, error: 'Эта команда уже идёт' };
    const busy = live.find((j) => NEEDS_CONFIRM.has(j.risk));
    if (NEEDS_CONFIRM.has(cmd.risk) && busy) return { status: 409, error: `Сначала дождитесь: ${busy.title}` };
    const job = startJob(cmd, spec); job.params = values;
    return { job: summary(job) };
  }

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { s += c; if (s.length > 64 * 1024) reject(new Error('слишком большой запрос')); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });

  async function handle(req, res) {
    const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowed.includes(req.headers.host)) return json(res, 403, { error: 'Чужой адрес' });
    const origin = req.headers.origin;
    if (origin && !allowed.includes(origin.replace(/^http:\/\//, ''))) return json(res, 403, { error: 'Чужая страница' });
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/api/ping') return json(res, 200, { app: 'datacore-pult' });
    if (url.pathname === '/') {
      const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8').replace('__TOKEN__', token);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'" });
      return res.end(html);
    }
    if (STATIC[url.pathname]) {
      res.writeHead(200, { 'Content-Type': STATIC[url.pathname], 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(UI_DIR, url.pathname.slice(1))));
    }
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Нет такого адреса' });
    const given = req.headers['x-pult-token'] || url.searchParams.get('t');
    if (given !== token) return json(res, 401, { error: 'Нет ключа сессии' });

    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': ok\n\n');
      clients.add(res);
      clearTimeout(idleTimer);
      req.on('close', () => { clients.delete(res); checkIdle(); });
      return undefined;
    }
    if (req.method === 'GET' && url.pathname === '/api/catalog') return json(res, 200, publicCatalog());
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const runs = readRuns();
      const status = await statusFn(machine, runs);
      const brief = Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, { at: v.at, code: v.code }]));
      return json(res, 200, { ...status, runs: brief, advice: advise(status, runs, catalog.COMMANDS, Date.now(), readTodo()) });
    }
    if (req.method === 'GET' && url.pathname === '/api/jobs') return json(res, 200, { items: [...jobs.values()].map((j) => ({ ...summary(j), lines: j.lines })) });
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const out = runCommand(await readBody(req));
      return json(res, out.status || 200, out);
    }
    if (req.method === 'POST' && url.pathname === '/api/todo') {
      const { id, action } = await readBody(req);
      const t = readTodo().find((x) => x.id === id);
      if (!t) return json(res, 404, { error: 'Такого поручения нет' });
      if (action === 'open' && t.link) { openExternal(t.link); return json(res, 200, { ok: true }); }
      if (action === 'done') {
        const runs = readRuns();
        runs[`todo:${t.id}`] = { at: Date.now(), code: 0 };
        fs.mkdirSync(logDir, { recursive: true });
        fs.writeFileSync(runsFile, JSON.stringify(runs, null, 1));
        return json(res, 200, { ok: true, done: todoDone(t, runs) });
      }
      return json(res, 400, { error: 'Неизвестное действие' });
    }
    if (req.method === 'POST' && url.pathname === '/api/close') {
      const { ids } = await readBody(req);
      const closed = [...jobs.values()].filter((j) => j.state !== 'running' && (!ids || ids.includes(j.id))).map((j) => j.id);
      closed.forEach((id) => jobs.delete(id));
      send({ type: 'closed', ids: closed });
      return json(res, 200, { closed, running: running().length });
    }
    if (req.method === 'POST' && url.pathname === '/api/stop') {
      const job = jobs.get((await readBody(req)).id);
      if (!job || job.state !== 'running') return json(res, 404, { error: 'Команда уже завершена' });
      stopJob(job);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'Нет такого адреса' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => json(res, 500, { error: e.message }));
  });

  return {
    server,
    token,
    jobs,
    listen: (p) => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(p, '127.0.0.1', () => { port = server.address().port; resolve(port); });
    }),
    close: () => new Promise((resolve) => { for (const c of clients) c.end(); server.close(resolve); server.closeAllConnections(); }),
  };
}

// ---------- запуск окна ----------

function findEdge() {
  const list = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean).map((b) => path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  return list.find((f) => fs.existsSync(f)) || null;
}

function openWindow(url) {
  const edge = process.env.EDGE && fs.existsSync(process.env.EDGE) ? process.env.EDGE : findEdge();
  const data = path.join(process.env.LOCALAPPDATA || ROOT, 'DataCorePult', 'edge');
  const child = edge
    ? spawn(edge, [`--app=${url}`, `--user-data-dir=${data}`, '--window-size=1360,900', '--no-first-run'], { detached: true, stdio: 'ignore' })
    : spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' });
  child.unref();
}

async function main() {
  const noOpen = process.argv.includes('--no-open');
  const port = Number(process.env.PULT_PORT) || 47811;
  const url = `http://127.0.0.1:${port}/`;
  const pult = createPult({ onIdle: noOpen ? null : () => process.exit(0) });
  try {
    await pult.listen(port);
  } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    const r = await fetchJson(`${url}api/ping`);
    if (r.json?.app === 'datacore-pult') { if (!noOpen) openWindow(url); return; }
    throw new Error(`Порт ${port} занят другой программой. Задайте PULT_PORT.`);
  }
  console.log(`Пульт: ${url}`);
  if (!noOpen) openWindow(url);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(2); });
}
