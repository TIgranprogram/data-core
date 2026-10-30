// Ночной стенд и ночной прогон dc: `dc stand [up|down|status]`, `dc night [--quick]`.
// Стенд — отдельный compose-проект dcnight (tools/night/compose.yml), порты API 3102 и Mongo 27118,
// БД datacore-night из свежего D:\datacore-backups\datacore-*.tgz. Ничего не делает с datacore-*, :3001/:3002/:27018, .data, продом.
// Секреты стенда — tools/.night/stand.env (gitignored); в консоль и логи не попадают.
// Коды выхода: 0 норма · 1 есть красные шаги · 2 сбой инструмента или нарушена защита.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NIGHT_DIR = path.join(ROOT, 'tools', '.night');
const COMPOSE = path.join(ROOT, 'tools', 'night', 'compose.yml');
const WORKTREE = path.join(NIGHT_DIR, 'worktree');
const LOCK = path.join(NIGHT_DIR, 'lock.json');
const STAND_ENV = path.join(NIGHT_DIR, 'stand.env');
const BACKUPS = process.env.DC_BACKUPS || 'D:\\datacore-backups';

export const NIGHT_DB = 'datacore-night';
export const TEST_DB = 'datacore-test-night';
export const API_PORT = 3102;
export const MONGO_PORT = 27118;
export const FORBIDDEN_PORTS = [3000, 3001, 3002, 27017, 27018];
export const LOCK_STALE_MS = 3 * 60 * 60 * 1000;
export const TAIL_BYTES = 4096;

// ---------- чистые функции (проверяются без Docker) ----------

/** Имя БД стенда обязано оканчиваться на `-night`. */
export function isNightDb(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_.][A-Za-z0-9_.-]*-night$/.test(name);
}

/** Жёсткая проверка: любая нарушенная — исключение с code=2 (выход инструмента 2). */
export function assertStandSafe({ db = NIGHT_DB, testDb = TEST_DB, apiPort = API_PORT, mongoPort = MONGO_PORT } = {}) {
  const bad = (m) => Object.assign(new Error('Защита стенда: ' + m), { code: 2 });
  if (!isNightDb(db)) throw bad(`имя БД «${db}» не оканчивается на -night`);
  if (!isNightDb(testDb)) throw bad(`имя тестовой БД «${testDb}» не оканчивается на -night`);
  for (const p of [apiPort, mongoPort]) if (FORBIDDEN_PORTS.includes(Number(p))) throw bad(`порт ${p} занят основным контуром`);
  return true;
}

/** Состояние замка: free | busy | stale. isAlive(pid) нужен только для замка своего ПК. */
export function lockState(lock, { now = Date.now(), host = os.hostname(), isAlive = () => true, staleMs = LOCK_STALE_MS } = {}) {
  if (!lock || typeof lock !== 'object' || !lock.start) return 'free';
  if (now - Number(lock.start) > staleMs) return 'stale';
  if (lock.host === host && !isAlive(lock.pid)) return 'stale';
  return 'busy';
}

export function pidAlive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Берёт замок. Занят живым экземпляром — {ok:false, lock}. Протухший замок молча заменяется. */
export function acquireLock(file, opts = {}) {
  const host = opts.host || os.hostname();
  const now = opts.now ?? Date.now();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let cur = null;
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* нет или битый */ }
  const st = lockState(cur, { now, host, isAlive: opts.isAlive || pidAlive, staleMs: opts.staleMs });
  if (st === 'busy') return { ok: false, lock: cur };
  fs.writeFileSync(file, JSON.stringify({ host, pid: opts.pid ?? process.pid, start: now }));
  return { ok: true, replaced: st === 'stale' };
}

export function releaseLock(file, pid = process.pid) {
  try {
    const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cur.pid === pid) fs.rmSync(file, { force: true });
  } catch { /* уже нет */ }
}

/** Последние n байт текста (UTF-8), без разорванного символа в начале. */
export function tailBytes(s, n = TAIL_BYTES) {
  const b = Buffer.from(String(s), 'utf8');
  if (b.length <= n) return String(s);
  return b.subarray(b.length - n).toString('utf8').replace(/^\uFFFD+/, '');
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Сигнатура провала: «шаг:хеш» по первым ключевым строкам, числа и пути выброшены — одинаковый провал даёт одну сигнатуру. */
export function failSignature(step, out) {
  const keys = String(out).replace(ANSI, '').split(/\r?\n/)
    .filter((l) => /error TS\d+|^\s*●|\bFAIL\b|✗|\berror\b|\bError:|not ok|вход не удался|шире экрана|таймаут/i.test(l))
    .slice(0, 3)
    .map((l) => l.trim().replace(/[A-Za-z]:[\\/][^\s:]*|(?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+/g, '<path>').replace(/\d+/g, '#').slice(0, 120));
  if (!keys.length) return `${step}:no-lines`;
  return `${step}:${crypto.createHash('sha1').update(keys.join('|')).digest('hex').slice(0, 8)}`;
}

/** Результат шага для summary.json. */
export function makeStep(name, { code, ms, out = '', timedOut = false }, commit) {
  const ok = code === 0;
  return {
    step: name, code, ms, commit, ok,
    ...(timedOut ? { timedOut: true } : {}),
    signature: ok ? null : failSignature(name, timedOut ? out + '\nтаймаут' : out),
    tail: tailBytes(out),
  };
}

export function summarize(steps) {
  const red = steps.filter((s) => !s.ok);
  return { total: steps.length, green: steps.length - red.length, red: red.length, failed: red.map((s) => s.step) };
}

export function stepLine(s) {
  return `${s.ok ? '✓' : '✗'} ${s.step.padEnd(12)} ${String(Math.round(s.ms / 1000)).padStart(5)} с${s.ok ? '' : `  код ${s.code}${s.timedOut ? ' (таймаут)' : ''}  ${s.signature}`}`;
}

/** Строки KEY=VAL → объект. */
export function parseEnvFile(text) {
  const o = {};
  for (const l of String(text).split(/\r?\n/)) { const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) o[m[1]] = m[2]; }
  return o;
}

/** Самый свежий datacore-*.tgz (не .part) по имени. */
export function pickBackup(names) {
  return names.filter((n) => /^datacore-[\d_-]+\.tgz$/.test(n)).sort().pop() || null;
}

// ---------- запуск ----------

function sh(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...o });
  return { code: r.status ?? (r.error ? -1 : 1), out: (r.stdout || '') + (r.stderr ? '\n' + r.stderr : ''), stdout: r.stdout || '' };
}

/** Шаг с таймаутом: по истечении убивает всё дерево процессов. Не бросает исключений. */
export function runAsync(cmd, args, { cwd = ROOT, env = process.env, timeoutMs = 600000, shell = false } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let out = '';
    let timedOut = false;
    const add = (d) => { out += d.toString(); if (out.length > 30e6) out = out.slice(-20e6); };
    let p;
    try { p = spawn(cmd, args, { cwd, env, shell, windowsHide: true }); } catch (e) { return resolve({ code: -1, out: String(e), ms: 0, timedOut: false }); }
    p.stdout.on('data', add); p.stderr.on('data', add);
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F']); else p.kill('SIGKILL');
    }, timeoutMs);
    p.on('error', (e) => { out += '\n' + e.message; });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code: timedOut ? 124 : (code ?? -1), out, ms: Date.now() - t0, timedOut }); });
  });
}

const docker = (args, o) => sh('docker', args, o);

function standEnv() {
  fs.mkdirSync(NIGHT_DIR, { recursive: true });
  let e = {};
  try { e = parseEnvFile(fs.readFileSync(STAND_ENV, 'utf8')); } catch { /* первый запуск */ }
  const hex = (n) => crypto.randomBytes(n).toString('hex');
  let changed = false;
  for (const [k, n] of [['NIGHT_ROOT_PW', 12], ['NIGHT_APP_PW', 12], ['NIGHT_JWT', 24], ['NIGHT_JWT_REFRESH', 24], ['NIGHT_ADMIN_PW', 12], ['NIGHT_KEYFILE', 48], ['NIGHT_QA_PW', 12]]) {
    if (!e[k]) { e[k] = hex(n); changed = true; }
  }
  if (changed) fs.writeFileSync(STAND_ENV, Object.entries(e).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  return e;
}

function composeEnv(src) {
  const { MONGO_URI, MONGO_DB, MONGO_DB_TEST, ...rest } = process.env;
  return { ...rest, ...standEnv(), NIGHT_SRC: src.replace(/\\/g, '/'), NIGHT_DB, NIGHT_API_PORT: String(API_PORT), NIGHT_MONGO_PORT: String(MONGO_PORT) };
}

const compose = (args, src, o = {}) => sh('docker', ['compose', '-p', 'dcnight', '-f', COMPOSE, ...args], { env: composeEnv(src), ...o });

/** Скрипт на legacy-шелл mongo внутри dcnight-mongo от root (пароль берётся из окружения контейнера; скрипт идёт через stdin). */
const mongoEval = (script) => sh('docker', ['exec', '-i', 'dcnight-mongo', 'sh', '-c', 'mongo --quiet -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin'], { input: script });

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function waitFor(label, fn, tries, everyMs, ctx) {
  for (let i = 0; i < tries; i++) { if (fn()) return true; sleepSync(everyMs); }
  ctx.say(`Стенд: не дождался — ${label}`);
  return false;
}

async function health() {
  try { const r = await fetch(`http://127.0.0.1:${API_PORT}/api/health/ready`, { signal: AbortSignal.timeout(5000) }); return r.status === 200; } catch { return false; }
}

// ---------- dc stand ----------

export async function standUp(ctx, src = ROOT) {
  assertStandSafe();
  if (await health()) { ctx.say(`Стенд уже поднят: http://localhost:${API_PORT}/app/`); return 0; }
  const bk = pickBackup(fs.existsSync(BACKUPS) ? fs.readdirSync(BACKUPS) : []);
  if (!bk) { ctx.say(`Стенд: нет бэкапа datacore-*.tgz в ${BACKUPS}`); return 2; }
  const age = (Date.now() - fs.statSync(path.join(BACKUPS, bk)).mtimeMs) / 3600e3;
  ctx.say(`Стенд: бэкап ${bk} (${Math.round(age)} ч назад)${age > 72 ? ' — СТАРЫЙ' : ''}`);
  const t0 = Date.now();
  let r = compose(['up', '-d', '--wait', 'mongo'], src);
  ctx.log(r.out);
  if (r.code) { ctx.say('Стенд: Mongo не поднялся — ' + r.out.trim().split('\n').pop().slice(0, 120)); return 2; }
  // entrypoint mongo сперва поднимает временный сервер для создания root; ждём его конца
  waitFor('конец инициализации mongo', () => /init process complete/.test(docker(['logs', 'dcnight-mongo']).out), 60, 2000, ctx);
  waitFor('replica set rs0', () => {
    mongoEval(`try{rs.status()}catch(e){}\nif(!rs.status().ok){rs.initiate({_id:'rs0',members:[{_id:0,host:'mongo:27017'}]})}`);
    return /true/.test(mongoEval('print(db.isMaster().ismaster)').out);
  }, 40, 2000, ctx);

  // восстановление копии
  const ex = path.join(NIGHT_DIR, 'restore');
  fs.rmSync(ex, { recursive: true, force: true });
  fs.mkdirSync(ex, { recursive: true });
  r = sh('tar', ['-xz'], { cwd: ex, input: fs.readFileSync(path.join(BACKUPS, bk)) }); // из stdin: «D:» в пути tar принимает за удалённый хост
  if (r.code) { ctx.say('Стенд: не распаковался бэкап — ' + r.out.trim().slice(0, 100)); return 2; }
  const top = fs.readdirSync(ex).find((n) => fs.existsSync(path.join(ex, n, 'datacore')));
  if (!top) { ctx.say('Стенд: в бэкапе нет папки datacore'); return 2; }
  docker(['cp', path.join(ex, top, 'datacore'), 'dcnight-mongo:/tmp/prod-dump']);
  r = docker(['exec', 'dcnight-mongo', 'sh', '-c', `mongorestore --quiet -u root -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db ${NIGHT_DB} /tmp/prod-dump`]);
  ctx.log(r.out);
  fs.rmSync(ex, { recursive: true, force: true });
  if (r.code) { ctx.say('Стенд: восстановление не удалось — ' + r.out.trim().split('\n').pop().slice(0, 120)); return 2; }
  const e = standEnv();
  ctx.log(mongoEval(`var d=db.getSiblingDB('admin');if(!d.getUser('dcnight')){d.createUser({user:'dcnight',pwd:'${e.NIGHT_APP_PW}',roles:[{role:'readWrite',db:'${NIGHT_DB}'}]})}`).out); // пользователь в admin: authSource=admin в URI

  r = compose(['up', '-d', '--build', 'backend'], src);
  ctx.log(r.out);
  if (r.code) { ctx.say('Стенд: сервер не собрался/не запустился — ' + r.out.trim().split('\n').pop().slice(0, 120)); return 2; }
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) { ok = await health(); if (!ok) sleepSync(2000); }
  if (!ok) { ctx.say('Стенд: сервер не ответил health за 2 минуты'); ctx.log(docker(['logs', '--tail', '40', 'dcnight-backend']).out); return 2; }

  // тестовый пользователь qa (вход для qa-smoke); пароль — в файл, не в вывод
  const h = docker(['exec', '-e', `PW=${e.NIGHT_QA_PW}`, 'dcnight-backend', 'node', '-e', "console.log(require('bcryptjs').hashSync(process.env.PW,10))"]);
  const hash = h.stdout.trim();
  if (h.code || !/^\$2[aby]\$/.test(hash)) { ctx.say('Стенд: не получил хеш пароля qa'); return 2; }
  mongoEval(`var d=db.getSiblingDB('${NIGHT_DB}');d.users.updateOne({username:'qa'},{$set:{displayName:'QA night',passwordHash:'${hash}',role:'admin',permissions:[],isActive:true,isOwner:false,refreshTokenVersion:0,updatedAt:new Date()},$setOnInsert:{createdAt:new Date()}},{upsert:true})`);
  fs.writeFileSync(path.join(NIGHT_DIR, 'qa-login.txt'), e.NIGHT_QA_PW, { mode: 0o600 });
  ctx.say(`Стенд поднят за ${Math.round((Date.now() - t0) / 1000)} с: http://localhost:${API_PORT}/app/ · БД ${NIGHT_DB} · Mongo :${MONGO_PORT}`);
  return 0;
}

export function standDown(ctx) {
  const r = compose(['down', '-v', '--remove-orphans'], ROOT);
  ctx.log(r.out);
  fs.rmSync(path.join(NIGHT_DIR, 'restore'), { recursive: true, force: true });
  ctx.say(r.code ? 'Стенд: не погас — ' + r.out.trim().split('\n').pop().slice(0, 120) : 'Стенд погашен (контейнеры и тома dcnight удалены)');
  return r.code ? 2 : 0;
}

export async function standStatus(ctx) {
  assertStandSafe();
  const ps = docker(['ps', '--filter', 'label=com.docker.compose.project=dcnight', '--format', '{{.Names}} {{.Status}}']);
  const rows = ps.stdout.trim().split('\n').filter(Boolean);
  ctx.log(ps.out);
  if (!rows.length) { ctx.say('Стенд dcnight: не запущен'); return 1; }
  for (const l of rows) ctx.say('  ' + l);
  const up = await health();
  ctx.say(`API :${API_PORT}: ${up ? 'ответ ok' : 'не отвечает'} · БД ${NIGHT_DB} · Mongo :${MONGO_PORT}`);
  return up ? 0 : 1;
}

export async function cmdStand(sub, ctx) {
  try {
    if (!sub || sub === 'status') return await standStatus(ctx);
    if (sub === 'up') return await standUp(ctx);
    if (sub === 'down') return standDown(ctx);
    ctx.say('dc stand [up|down|status]');
    return 2;
  } catch (e) {
    ctx.say(e.message);
    return e.code === 2 ? 2 : 2;
  }
}

// ---------- dc night ----------

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function prepareWorktree(ctx) {
  const f = sh('git', ['fetch', '--quiet', 'origin', 'main'], { timeout: 90000 });
  if (f.code) ctx.say('git fetch не удался — беру последний известный origin/main');
  if (fs.existsSync(path.join(WORKTREE, '.git'))) {
    const r = sh('git', ['checkout', '--force', '--detach', 'origin/main'], { cwd: WORKTREE });
    if (r.code) return { error: 'worktree: checkout — ' + r.out.trim().slice(0, 150) };
    sh('git', ['clean', '-fdq', '-e', 'backend/node_modules'], { cwd: WORKTREE });
  } else {
    sh('git', ['worktree', 'prune']);
    fs.mkdirSync(NIGHT_DIR, { recursive: true });
    const r = sh('git', ['worktree', 'add', '--detach', WORKTREE, 'origin/main']);
    if (r.code) return { error: 'worktree add — ' + r.out.trim().slice(0, 150) };
  }
  // зависимости не ставим заново: junction на node_modules основной папки (на Windows права админа не нужны)
  const nm = path.join(WORKTREE, 'backend', 'node_modules');
  const srcNm = path.join(ROOT, 'backend', 'node_modules');
  if (!fs.existsSync(nm)) {
    if (!fs.existsSync(srcNm)) return { error: 'нет backend/node_modules в основной папке — выполни pnpm install' };
    fs.symlinkSync(srcNm, nm, 'junction');
  }
  const commit = sh('git', ['rev-parse', '--short', 'HEAD'], { cwd: WORKTREE }).stdout.trim();
  const same = sh('git', ['diff', '--quiet', 'HEAD', '--', 'backend/pnpm-lock.yaml'], { cwd: ROOT }).code === 0;
  return { commit, lockSame: same };
}

export async function cmdNight({ quick = false } = {}, ctx) {
  const t0 = Date.now();
  assertStandSafe();
  const lk = acquireLock(LOCK);
  if (!lk.ok) { ctx.say(`Ночной прогон уже идёт (${lk.lock.host}, pid ${lk.lock.pid}, с ${new Date(lk.lock.start).toLocaleString('ru-RU')}) — отказываюсь`); return 2; }
  const runDir = path.join(NIGHT_DIR, 'runs', stamp());
  fs.mkdirSync(runDir, { recursive: true });
  const runLog = [];
  const slog = (s) => { runLog.push(String(s)); ctx.log(s); };
  const sctx = { log: slog, say: ctx.say };
  const steps = [];
  let commit = '?';
  try {
    const wt = prepareWorktree(ctx);
    if (wt.error) { ctx.say('Сбой: ' + wt.error); return 2; }
    commit = wt.commit;
    ctx.say(`Ночной прогон${quick ? ' (быстрый)' : ''}: origin/main ${commit}, worktree tools/.night/worktree`);
    if (!wt.lockSame) ctx.say('! pnpm-lock основной папки отличается от origin/main — зависимости могут не совпасть');
    const be = path.join(WORKTREE, 'backend');
    const win = process.platform === 'win32';
    const baseEnv = (() => { const { MONGO_URI, MONGO_DB, MONGO_DB_TEST, MONGO_PORT: _p, MONGO_ROOT_PASSWORD, ...rest } = process.env; return rest; })();
    const doStep = async (name, cmd, args, o) => {
      const r = await runAsync(cmd, args, { env: baseEnv, ...o });
      const s = makeStep(name, r, commit);
      steps.push(s);
      slog(`\n=== ${name}: ${cmd} ${args.join(' ')} → код ${r.code}, ${(r.ms / 1000).toFixed(1)} с${r.timedOut ? ' (ТАЙМАУТ)' : ''} ===\n${r.out}`);
      return s;
    };
    const MIN = 60000;
    await doStep('tsc', 'npx', ['tsc', '--noEmit'], { cwd: be, shell: win, timeoutMs: 10 * MIN });
    await doStep('unit', 'npx', ['jest', '--silent'], { cwd: be, shell: win, timeoutMs: 25 * MIN });
    await doStep('imports', process.execPath, ['backend/scripts/pwa-import-check.mjs'], { cwd: WORKTREE, timeoutMs: 3 * MIN });
    await doStep('eslint', 'npx', ['eslint', 'src/**/*.ts'], { cwd: be, shell: win, timeoutMs: 10 * MIN });
    await doStep('design-lint', process.execPath, ['backend/scripts/design-lint.mjs'], { cwd: WORKTREE, timeoutMs: 3 * MIN });

    if (!quick) {
      assertStandSafe();
      standDown(sctx);
      const up = await standUp(sctx, WORKTREE);
      const e = standEnv();
      if (up !== 0) {
        for (const n of ['e2e', 'smoke']) steps.push(makeStep(n, { code: 2, ms: 0, out: 'стенд не поднялся' }, commit));
      } else {
        const eenv = { ...baseEnv, MONGO_ROOT_PASSWORD: e.NIGHT_ROOT_PW, MONGO_PORT: String(MONGO_PORT), MONGO_DB_TEST: TEST_DB };
        assertStandSafe({ testDb: eenv.MONGO_DB_TEST });
        await doStep('e2e', 'npx', ['jest', '--config', './test/jest-e2e.json', '--runInBand', '--forceExit'], { cwd: be, shell: win, env: eenv, timeoutMs: 30 * MIN });
        await doStep('smoke', process.execPath, ['backend/scripts/qa-smoke.mjs'], { cwd: WORKTREE, env: { ...baseEnv, QA_BASE: `http://localhost:${API_PORT}`, QA_DIR: NIGHT_DIR }, timeoutMs: 15 * MIN });
      }
    }
  } catch (e) {
    ctx.say('Сбой инструмента: ' + e.message);
    slog(e.stack || '');
    steps.push(makeStep('tool', { code: 2, ms: 0, out: e.message }, commit));
  } finally {
    if (!quick) { try { standDown(sctx); } catch (e) { ctx.say('Стенд не погашен: ' + e.message); } }
    releaseLock(LOCK);
  }
  const sum = summarize(steps);
  const summary = { date: new Date(t0).toISOString(), commit, quick, durationMs: Date.now() - t0, ...sum, steps };
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(runDir, 'night.log'), runLog.join('\n') + '\n');
  for (const s of steps) ctx.say(stepLine(s));
  ctx.say(`Итог: зелёных ${sum.green}, красных ${sum.red} за ${Math.round(summary.durationMs / 1000)} с · ${path.relative(ROOT, runDir).replace(/\\/g, '/')}/summary.json`);
  return sum.red ? 1 : 0;
}
