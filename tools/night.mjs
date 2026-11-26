// Ночной стенд и ночной прогон dc: `dc stand [up|down|status]`, `dc night [--quick]`.
// T23: каждый стенд — уникальный project/DB на -night. Legacy dcnight не управляется.
// Остановка сохраняет volumes и данные. Паспорт и секреты — tools/.night/stands/<run-id>/.
// Коды выхода: 0 норма · 1 есть красные шаги · 2 сбой инструмента или нарушена защита.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { createNightStand } from './night-stand.mjs';
import { DEVELOPMENT_PORTS, newStandRun } from './night-owner.mjs';
import { persistHandoff, runHandoff } from './codex-handoff.mjs';
import { terminateProcess } from '../pult/process.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const NIGHT_DIR = path.join(ROOT, 'tools', '.night');
const COMPOSE = path.join(ROOT, 'tools', 'night', 'compose.yml');
const WORKTREE = path.join(NIGHT_DIR, 'worktree');
const LOCK = path.join(NIGHT_DIR, 'lock.json');
const MANUAL_LOCK = path.join(NIGHT_DIR, 'manual-lock');
export const STAND_BACKUP_DIR = process.env.DC_BACKUPS || process.env.DATACORE_BACKUPS || (process.platform === 'win32' ? 'D:\\datacore-backups' : path.join(os.homedir(), 'datacore-backups'));

export const NIGHT_DB = 'datacore-night';
export const TEST_DB = 'datacore-test-night';
export const API_PORT = DEVELOPMENT_PORTS.apiPort;
export const MONGO_PORT = DEVELOPMENT_PORTS.mongoPort;
export const HEALTH_URL = `http://127.0.0.1:${API_PORT}/api/health/ready`;
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
    .filter((l) => /error TS\d+|^\s*●|^\s*! [A-E]:|\bFAIL\b|✗|\berror\b|\bError:|not ok|вход не удался|шире экрана|таймаут/i.test(l))
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

/** Файл с адресом сайта и машинным ключом для отправки итога прогона (gitignored): CONTROL_URL=https://kppdf-crm.ru/db, CONTROL_KEY=kppd_… */
export const CONTROL_KEY_FILE = path.join(ROOT, 'tools', 'logs', 'control-key.local.env');

/** Отправляет summary.json на POST /api/control/runs. Не бросает: возвращает одну строку для журнала. */
export async function pushRunToControl(summary, { file = CONTROL_KEY_FILE, fetchFn = globalThis.fetch, node = os.hostname() } = {}) {
  try {
    if (!fs.existsSync(file)) return 'итог не отправлен на сайт: нет tools/logs/control-key.local.env (пульт → «Нужно от вас»)';
    const { CONTROL_URL, CONTROL_KEY } = parseEnvFile(fs.readFileSync(file, 'utf8'));
    if (!CONTROL_URL || !CONTROL_KEY) return 'итог не отправлен на сайт: в control-key.local.env нет CONTROL_URL или CONTROL_KEY';
    const url = CONTROL_URL.replace(/\/+$/, '').replace(/\/api$/, '') + '/api/control/runs';
    const body = JSON.stringify({ ...summary, node: String(node).slice(0, 60) });
    const r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + CONTROL_KEY }, body, signal: AbortSignal.timeout(20000) });
    return r.ok ? 'итог отправлен на сайт (Состояние)' : 'итог не отправлен на сайт: ответ ' + r.status;
  } catch (e) {
    return 'итог не отправлен на сайт: ' + e.message;
  }
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
  const r = spawnSync(cmd, args, { windowsHide: true, cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...o });
  return { code: r.status ?? (r.error ? -1 : 1), out: (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '') + (r.error ? '\n' + r.error.message : ''), stdout: r.stdout || '', error: r.error };
}

/** Локальный Git-статус без обновления индекса и tracking refs. */
export function checkoutState(cwd = ROOT) {
  const result = sh('git', ['--no-optional-locks', 'status', '--porcelain=v2', '--branch'], { cwd, timeout: 10000 });
  if (result.code) return null;
  const lines = result.stdout.trimEnd().split(/\r?\n/);
  const header = (prefix) => lines.find((line) => line.startsWith(prefix))?.slice(prefix.length) || null;
  const head = header('# branch.oid ');
  const branch = header('# branch.head ');
  const counts = /^\+(\d+) -(\d+)$/.exec(header('# branch.ab ') || '');
  return { branch, head: head === '(initial)' ? null : head, dirty: lines.some((line) => line && !line.startsWith('# ')), upstream: header('# branch.upstream '), ahead: counts ? Number(counts[1]) : null, behind: counts ? Number(counts[2]) : null };
}

function manualLockError() {
  return Object.assign(new Error('Дождитесь завершения другой операции с копией разработки.'), { code: 2 });
}

/** Общий замок для пульта и прямых вызовов ручного стенда из этого checkout. */
export async function withManualStandLock(action, lock = MANUAL_LOCK) {
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const candidate = fs.mkdtempSync(`${lock}.pending-`);
  const marker = `${process.pid}-${crypto.randomBytes(12).toString('hex')}`;
  let acquired = false;
  try {
    fs.writeFileSync(path.join(candidate, marker), '', { flag: 'wx' });
    // Переименование публикует замок вместе с меткой PID, даже если процесс аварийно завершится.
    try {
      fs.renameSync(candidate, lock);
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
      try {
        const markers = fs.readdirSync(lock);
        if (markers.length) {
          const previous = markers.length === 1 && /^(\d+)-[a-f0-9]{24}$/.exec(markers[0]);
          if (!previous || pidAlive(previous[1])) throw manualLockError();
          fs.unlinkSync(path.join(lock, previous[0]));
        }
        fs.rmdirSync(lock);
        fs.renameSync(candidate, lock);
      } catch (error) {
        if (['EEXIST', 'ENOENT', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw manualLockError();
        throw error;
      }
    }
    acquired = true;
    return await action();
  } finally {
    const directory = acquired ? lock : candidate;
    fs.rmSync(path.join(directory, marker), { force: true });
    try { fs.rmdirSync(directory); } catch (error) {
      // После снятия метки другой процесс может уже занять замок.
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    }
  }
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
      terminateProcess(p.pid).then((r) => { if (!r.ok) add('\nОстановка по таймауту не выполнена: ' + r.error); });
    }, timeoutMs);
    p.on('error', (e) => { out += '\n' + e.message; });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code: timedOut ? 124 : (code ?? -1), out, ms: Date.now() - t0, timedOut }); });
  });
}

const docker = (args, o) => sh('docker', args, o);
const stand = createNightStand({ docker, sh, root: ROOT, composeFile: COMPOSE, nightDir: NIGHT_DIR, backupDir: STAND_BACKUP_DIR, buildCode: (src) => checkoutState(src) || {} });
export const standUp = (ctx, src = ROOT, run = null, ports = {}) => run ? stand.up(ctx, src, run, ports) : withManualStandLock(() => stand.up(ctx, src, run, ports));
export const standOwned = () => stand.owned();
export const standRefresh = (ctx, src = ROOT) => withManualStandLock(() => stand.refresh(ctx, src));
export const standRenew = (ctx) => withManualStandLock(() => stand.renew(ctx)); // новый стенд из свежей копии, старый — отложен без удаления
export const standInfo = () => stand.info();
export const standDown = (ctx, run) => run ? stand.down(ctx, run) : withManualStandLock(() => stand.down(ctx));
export const standStatus = (ctx) => stand.status(ctx);
export const standDevelopmentOwned = () => stand.developmentOwned().data;
export const latestStandBackup = () => stand.latestBackup();
export const prepareDevelopment = (ctx, ready) => withManualStandLock(async () => {
  const code = await stand.prepareDevelopment(ctx);
  if (code !== 0) return code;
  return ready(stand.developmentOwned({ requireMetadata: true }));
});

/** Полный прогон не занимает порты ручного/legacy стенда. */
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
}

export async function cmdStand(sub, ctx) {
  try {
    if (!sub || sub === 'status') return await standStatus(ctx);
    if (sub === 'up') return await standUp(ctx);
    if (sub === 'down') return await standDown(ctx);
    if (sub === 'refresh') return await standRefresh(ctx); // код с диска → в стенд, база не трогается
    if (sub === 'renew') return await standRenew(ctx); // база посвежее: новый стенд из последней копии на ПК
    ctx.say('dc stand [up|down|status|refresh]');
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
  const target = sh('git', ['rev-parse', '--verify', 'origin/main^{commit}']);
  if (target.code) return { error: 'не удалось определить проверяемый origin/main' };
  const commit = target.stdout.trim();
  // node_modules берём из основной папки. Сравнение с её HEAD пропускало расхождение с nightly SHA.
  const manifests = ['backend/package.json', 'backend/pnpm-lock.yaml'];
  if (sh('git', ['diff', '--quiet', commit, '--', ...manifests]).code !== 0) {
    return { error: 'package.json или pnpm-lock.yaml основной папки отличаются от проверяемого коммита; обновите checkout и его зависимости' };
  }
  if (fs.existsSync(path.join(WORKTREE, '.git'))) {
    const state = checkoutState(WORKTREE);
    if (!state || state.dirty) return { error: 'ночной worktree содержит локальные изменения; проверьте git status' };
    const r = sh('git', ['checkout', '--detach', commit], { cwd: WORKTREE });
    if (r.code) return { error: 'worktree: checkout — ' + r.out.trim().slice(0, 150) };
  } else {
    sh('git', ['worktree', 'prune']);
    fs.mkdirSync(NIGHT_DIR, { recursive: true });
    const r = sh('git', ['worktree', 'add', '--detach', WORKTREE, commit]);
    if (r.code) return { error: 'worktree add — ' + r.out.trim().slice(0, 150) };
  }
  // зависимости не ставим заново: junction на node_modules основной папки (на Windows права админа не нужны)
  const nm = path.join(WORKTREE, 'backend', 'node_modules');
  const srcNm = path.join(ROOT, 'backend', 'node_modules');
  if (!fs.existsSync(srcNm)) return { error: 'нет backend/node_modules в основной папке — выполните pnpm install --frozen-lockfile' };
  if (!fs.existsSync(nm)) fs.symlinkSync(srcNm, nm, process.platform === 'win32' ? 'junction' : 'dir');
  if (fs.realpathSync(nm) !== fs.realpathSync(srcNm)) return { error: 'backend/node_modules ночной копии не указывает на зависимости основной папки' };
  return { commit };
}

export async function cmdNight({ quick = false } = {}, ctx) {
  const t0 = Date.now();
  assertStandSafe();
  const lk = acquireLock(LOCK);
  if (!lk.ok) { ctx.say(`Ночной прогон уже идёт (${lk.lock.host}, pid ${lk.lock.pid}, с ${new Date(lk.lock.start).toLocaleString('ru-RU')}) — отказываюсь`); return 2; }
  try {
    return await runNight(quick, ctx, t0);
  } finally {
    releaseLock(LOCK);
  }
}

async function runNight(quick, ctx, t0) {
  const id = stamp(new Date(t0));
  const runDir = path.join(NIGHT_DIR, 'runs', id);
  try {
    fs.mkdirSync(path.dirname(runDir), { recursive: true });
    fs.mkdirSync(runDir);
  } catch {
    ctx.say('Не удалось создать отдельный каталог для ночного прогона.');
    return 2;
  }
  const runLog = [];
  const slog = (s) => { runLog.push(String(s)); ctx.log(s); };
  const sctx = { log: slog, say: ctx.say };
  const steps = [];
  let commit = '?';
  let run = null;
  let preparationFailed = false;
  try {
    const wt = prepareWorktree(ctx);
    if (wt.error) {
      preparationFailed = true;
      throw new Error(wt.error);
    }
    commit = wt.commit;
    ctx.say(`Ночной прогон${quick ? ' (быстрый)' : ''}: origin/main ${commit.slice(0, 8)}, worktree tools/.night/worktree`);
    const be = path.join(WORKTREE, 'backend');
    const baseEnv = (() => { const { MONGO_URI, MONGO_DB, MONGO_DB_TEST, MONGO_PORT: _p, MONGO_ROOT_PASSWORD, ...rest } = process.env; return rest; })();
    const doStep = async (name, cmd, args, o) => {
      const r = await runAsync(cmd, args, { env: baseEnv, ...o });
      const s = makeStep(name, r, commit);
      steps.push(s);
      slog(`\n=== ${name}: ${cmd} ${args.join(' ')} → код ${r.code}, ${(r.ms / 1000).toFixed(1)} с${r.timedOut ? ' (ТАЙМАУТ)' : ''} ===\n${r.out}`);
      return s;
    };
    const MIN = 60000;
    await doStep('tsc', process.execPath, [path.join(be, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'], { cwd: be, timeoutMs: 10 * MIN });
    await doStep('unit', process.execPath, [path.join(be, 'node_modules', 'jest', 'bin', 'jest.js'), '--silent'], { cwd: be, timeoutMs: 25 * MIN });
    await doStep('imports', process.execPath, ['backend/scripts/pwa-import-check.mjs'], { cwd: WORKTREE, timeoutMs: 3 * MIN });
    await doStep('eslint', process.execPath, [path.join(be, 'node_modules', 'eslint', 'bin', 'eslint.js'), 'src/**/*.ts'], { cwd: be, timeoutMs: 10 * MIN });
    await doStep('design-lint', process.execPath, ['backend/scripts/design-lint.mjs'], { cwd: WORKTREE, timeoutMs: 3 * MIN });

    if (!quick) {
      const tools = await doStep('tools-unit', process.execPath, ['--test', 'tools/dc.test.mjs', 'tools/night.test.mjs', ...fs.readdirSync(path.join(WORKTREE, 'pult', 'test')).filter((f) => f.endsWith('.test.mjs')).map((f) => 'pult/test/' + f)], { cwd: WORKTREE, timeoutMs: 5 * MIN });
      if (!tools.ok) throw new Error('Safety unit не прошли; новый стенд не создаётся');
      assertStandSafe();
      run = newStandRun({ apiPort: await freePort(), mongoPort: await freePort() });
      fs.writeFileSync(path.join(runDir, 'stand-run.json'), JSON.stringify(run, null, 2) + '\n');
      const up = await standUp(sctx, WORKTREE, run);
      const e = stand.credentials(run);
      if (up !== 0) {
        for (const n of ['e2e', 'smoke', 'screen-walk', 'scenarios', 'stock-filters']) steps.push(makeStep(n, { code: 2, ms: 0, out: 'стенд не поднялся' }, commit));
      } else {
        const eenv = { ...baseEnv, MONGO_ROOT_PASSWORD: e.NIGHT_ROOT_PW, MONGO_HOST: '127.0.0.1', MONGO_PORT: String(run.mongoPort), MONGO_DB: run.testDb, MONGO_DB_TEST: run.testDb, MONGO_URI: `mongodb://root:${e.NIGHT_ROOT_PW}@127.0.0.1:${run.mongoPort}/${run.testDb}?authSource=admin&replicaSet=rs0&directConnection=true` };
        Object.assign(eenv, { STOCK_CATALOG_TEST_DISPOSABLE: '1', STOCK_CATALOG_TEST_URI: `mongodb://root:${e.NIGHT_ROOT_PW}@127.0.0.1:${run.mongoPort}/datacore-test-t26-${run.id}-night?authSource=admin&replicaSet=rs0&directConnection=true` });
        assertStandSafe({ testDb: eenv.MONGO_DB_TEST });
        await doStep('e2e', process.execPath, ['--max-old-space-size=8192', path.join(be, 'node_modules', 'jest', 'bin', 'jest.js'), '--config', './test/jest-e2e.json', '--runInBand', '--forceExit'], { cwd: be, env: eenv, timeoutMs: 30 * MIN });
        await doStep('smoke', process.execPath, ['backend/scripts/qa-smoke.mjs'], { cwd: WORKTREE, env: { ...baseEnv, QA_BASE: `http://localhost:${run.apiPort}`, QA_DIR: stand.runDir(run) }, timeoutMs: 15 * MIN });
        // обход экранов: мусор на экране («[object …]», undefined, «Изменить» без сущности); код из worktree, вход — тестовый qa
        const qaPw = fs.readFileSync(path.join(stand.runDir(run), 'qa-login.txt'), 'utf8').trim();
        await doStep('screen-walk', process.execPath, ['tools/screen-walk.mjs', `http://localhost:${run.apiPort}`], { cwd: WORKTREE, env: { ...baseEnv, STAND_LOGIN: 'qa', STAND_PASSWORD: qaPw }, timeoutMs: 10 * MIN });
        // сценарии «как человек»: паспорт, документация, проектирование, продукция, доски (tools/scenarios.mjs)
        await doStep('scenarios', process.execPath, ['tools/scenarios.mjs', `http://localhost:${run.apiPort}`], { cwd: WORKTREE, env: { ...baseEnv, STAND_LOGIN: 'qa', STAND_PASSWORD: qaPw }, timeoutMs: 10 * MIN });
        // фильтры «Остатков»: число на кнопке признака = позиций в списке (замечание пользователя 2026-11-01)
        await doStep('stock-filters', process.execPath, ['tools/stock-filter-check.mjs', `http://localhost:${run.apiPort}`], { cwd: WORKTREE, env: { ...baseEnv, STAND_LOGIN: 'qa', STAND_PASSWORD: qaPw }, timeoutMs: 5 * MIN });
      }
    }
  } catch (e) {
    ctx.say('Сбой инструмента: ' + e.message);
    slog(e.stack || '');
    steps.push(makeStep('tool', { code: 2, ms: 0, out: e.message }, commit));
  } finally {
    if (run) { try { standDown(sctx, run); } catch (e) { ctx.say('Cleanup отказан, данные сохранены: ' + e.message); steps.push(makeStep('cleanup', { code: 2, ms: 0, out: e.message }, commit)); } }
  }
  const sum = summarize(steps);
  const summary = { date: new Date(t0).toISOString(), commit, quick, durationMs: Date.now() - t0, ...sum, steps };
  const summaryFile = path.join(runDir, 'summary.json');
  fs.writeFileSync(summaryFile + '.tmp', JSON.stringify(summary, null, 2), { flag: 'wx' });
  fs.renameSync(summaryFile + '.tmp', summaryFile);
  let handoffMessage;
  try {
    const report = runHandoff(ROOT, Date.now(), id);
    handoffMessage = report.issue || 'Сводка для Codex сохранена в ' + persistHandoff(ROOT, report);
  } catch {
    handoffMessage = 'Не удалось сохранить локальную сводку для Codex.';
  }
  slog(handoffMessage);
  fs.writeFileSync(path.join(runDir, 'night.log'), runLog.join('\n') + '\n');
  ctx.say(handoffMessage);
  for (const s of steps) ctx.say(stepLine(s));
  ctx.say('Итог сохранён локально.');
  ctx.say(`Итог: зелёных ${sum.green}, красных ${sum.red} за ${Math.round(summary.durationMs / 1000)} с · ${path.relative(ROOT, runDir).replace(/\\/g, '/')}/summary.json`);
  return preparationFailed ? 2 : sum.red ? 1 : 0;
}
