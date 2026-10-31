#!/usr/bin/env node
// dc — одна команда вместо россыпи шагов. Без зависимостей, на обоих ПК.
//   node tools/dc.mjs start | errors [часы] | check | data | status | logs [имя]
//                     stand [up|down|status] (ночной стенд на копии прода) | night [--quick] (ночной прогон в worktree)
// Полный вывод — tools/logs/<дата-время>-<команда>.log, в консоль — короткий итог (до 15 строк).
// Коды выхода: 0 норма · 1 есть находки · 2 сбой инструмента.
// Прод — только чтение через deploy/synology/api.sh. Записи на прод и выкладки здесь нет.
// Отличия ПК — окружением: DC_BASH (путь к bash.exe), DC_PROD_URL.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmdStand, cmdNight } from './night.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGS = path.join(ROOT, 'tools', 'logs');
const PROD_URL = process.env.DC_PROD_URL || 'https://kppdf-crm.ru/db';

// ---------- чистые функции (проверяются без сети) ----------

/** Время ISO → «30.10 14:44» (по местному часовому поясу). */
export function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Ответ /api/client-errors/top → массив записей (или null, если форма не та). */
export function parseErrors(text) {
  try {
    const j = JSON.parse(text);
    return Array.isArray(j.items) ? j.items : null;
  } catch { return null; }
}

/** Строки «топ ошибок»: текст, экран, повторы, время; для SlowScreen — первая строка sampleStack. */
export function formatErrors(items, max = 10) {
  const out = [];
  for (const e of items.slice(0, max)) {
    out.push(`${e.count}× ${cut(String(e.message || e.name || '?'), 70)} · ${e.section || '—'} · ${fmtTime(e.lastAt)}`);
    if (e.name === 'SlowScreen' && e.sampleStack) out.push('    ↳ ' + cut(String(e.sampleStack).split('\n')[0], 90));
  }
  return out;
}

/** Ответ /api/fill-audit → топ групп «Требуют заполнения». */
export function parseFill(text, top = 5) {
  try {
    const j = JSON.parse(text);
    if (!Array.isArray(j.groups)) return null;
    const groups = j.groups.map((g) => ({ area: g.area, title: g.title, count: g.count, money: !!g.money }))
      .sort((a, b) => b.count - a.count).slice(0, top);
    return { total: j.total ?? j.groups.reduce((s, g) => s + g.count, 0), groups };
  } catch { return null; }
}

/** `git status --porcelain` → число изменённых и неотслеживаемых. */
export function parseGitStatus(text) {
  let changed = 0, untracked = 0;
  for (const l of text.split(/\r?\n/)) {
    if (!l.trim()) continue;
    if (l.startsWith('??')) untracked++; else changed++;
  }
  return { changed, untracked };
}

/** `git rev-list --left-right --count HEAD...@{u}` → {ahead, behind}. */
export function parseAheadBehind(text) {
  const m = String(text).trim().split(/\s+/).map(Number);
  return m.length === 2 && m.every((n) => !isNaN(n)) ? { ahead: m[0], behind: m[1] } : null;
}

/** Последняя строка таблицы docs/TEST-LOG.md → «дата: суть». */
export function lastTestLog(md) {
  const rows = md.split(/\r?\n/).filter((l) => /^\|\s*\d{4}-\d{2}-\d{2}/.test(l));
  if (!rows.length) return null;
  const c = rows[rows.length - 1].split('|').map((s) => s.trim());
  return `${c[1]}: ${cut(c[3] || c[2] || '', 110)}`;
}

/** Итог jest: строки «Tests:» и «Test Suites:». */
export function parseJest(text) {
  const t = (text.match(/^Tests:\s*(.+)$/m) || [])[1];
  const s = (text.match(/^Test Suites:\s*(.+)$/m) || [])[1];
  return { tests: t || null, suites: s || null };
}

// ---------- запуск внешних команд ----------

/** Git Bash: DC_BASH → рядом с git → типовые места. Не берём bash из System32 (это WSL). */
export function findBash() {
  if (process.env.DC_BASH && fs.existsSync(process.env.DC_BASH)) return process.env.DC_BASH;
  if (process.platform !== 'win32') return 'bash';
  const cands = [];
  const w = spawnSync('where', ['git'], { encoding: 'utf8' });
  for (const g of (w.stdout || '').split(/\r?\n/).filter(Boolean)) {
    const base = path.dirname(path.dirname(g)); // ...\Git\cmd\git.exe → ...\Git
    cands.push(path.join(base, 'bin', 'bash.exe'), path.join(base, 'usr', 'bin', 'bash.exe'));
  }
  for (const pf of [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), 'C:\\Program Files', 'D:\\Program Files']) {
    if (pf) cands.push(path.join(pf, 'Git', 'bin', 'bash.exe'));
  }
  return cands.find((c) => fs.existsSync(c)) || null;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status ?? (r.error ? -1 : 1), out: (r.stdout || '') + (r.stderr ? '\n' + r.stderr : ''), stdout: r.stdout || '', err: r.error };
}

/** GET на прод только чтением, через api.sh (токен кэшируется там на 10 минут; вход — 20 в час). */
function prodGet(p) {
  const bash = findBash();
  if (!bash) return { ok: false, text: 'не найден Git Bash (задайте DC_BASH)' };
  const r = run(bash, ['deploy/synology/api.sh', 'prod', 'GET', p], { timeout: 90000 });
  return { ok: r.code === 0, text: r.stdout || r.out };
}

// ---------- журнал и итог ----------

const full = [];
const log = (s = '') => full.push(String(s));
const lines = [];
const say = (s = '') => lines.push(String(s));

function finish(cmd, code) {
  fs.mkdirSync(LOGS, { recursive: true });
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const file = path.join(LOGS, `${stamp}-${cmd}.log`);
  fs.writeFileSync(file, full.join('\n') + '\n');
  console.log(lines.slice(0, 14).join('\n'));
  console.log('Полный лог: ' + path.relative(ROOT, file).replace(/\\/g, '/'));
  process.exit(code);
}

// ---------- команды ----------

function cmdErrors(hours = 24) {
  const r = prodGet(`/api/client-errors/top?hours=${hours}`);
  log(r.text);
  const items = r.ok ? parseErrors(r.text) : null;
  if (!items) { say('Сбой: не получил ошибки с сайта — ' + cut(r.text.trim(), 160)); return { code: 2, count: 0 }; }
  const total = items.reduce((s, e) => s + e.count, 0);
  say(`Ошибки сайта за ${hours} ч: ${items.length} видов, ${total} раз`);
  for (const l of formatErrors(items)) say(l);
  return { code: items.length ? 1 : 0, count: items.length };
}

function cmdData() {
  const r = prodGet('/api/fill-audit');
  log(r.text);
  const f = r.ok ? parseFill(r.text) : null;
  if (!f) { say('Сбой: не получил fill-audit — ' + cut(r.text.trim(), 160)); return 2; }
  say(`Требуют заполнения: ${f.total} записей`);
  for (const g of f.groups) say(`${String(g.count).padStart(4)}  ${g.area} · ${g.title}${g.money ? ' (деньги)' : ''}`);
  return f.total ? 1 : 0;
}

function step(label, cmd, args, opts) {
  const t = Date.now();
  const r = run(cmd, args, { timeout: 15 * 60 * 1000, ...opts });
  log(`\n=== ${label}: ${cmd} ${args.join(' ')} → код ${r.code}, ${((Date.now() - t) / 1000).toFixed(1)} с ===\n${r.out}`);
  return r;
}

function cmdCheck() {
  const shell = process.platform === 'win32';
  const be = path.join(ROOT, 'backend');
  let bad = 0;
  const tsc = step('tsc', 'npx', ['tsc', '--noEmit'], { cwd: be, shell });
  const errs = (tsc.out.match(/error TS\d+/g) || []).length;
  say(tsc.code === 0 ? 'tsc: 0 ошибок' : `tsc: ошибок ${errs || '?'} (первая: ${cut((tsc.out.split('\n').find((l) => /error TS/.test(l)) || '').trim(), 100)})`);
  if (tsc.code) bad++;
  const jest = step('jest', 'npx', ['jest', '--silent'], { cwd: be, shell });
  const j = parseJest(jest.out);
  say(jest.code === 0 ? `юнит: ${j.tests || 'зелёный'}` : `юнит УПАЛ: ${j.tests || '?'}`);
  if (jest.code) { bad++; for (const l of jest.out.split('\n').filter((x) => /●|FAIL/.test(x)).slice(0, 4)) say('  ' + cut(l.trim(), 110)); }
  const imp = step('импорты приложения', process.execPath, ['backend/scripts/pwa-import-check.mjs']);
  say(imp.code === 0 ? 'импорты pwa/admin: ок — ' + cut(imp.out.trim().split('\n').pop(), 80) : 'импорты pwa/admin: ОШИБКА — ' + cut(imp.out.trim().split('\n')[0], 110));
  if (imp.code) bad++;
  const pult = step('пульт', process.execPath, ['--test', 'pult/test/catalog.test.mjs', 'pult/test/server.test.mjs', 'pult/test/advisor.test.mjs']);
  say(pult.code === 0 ? 'пульт: каталог совпадает с проектом' : 'пульт: ОТСТАЛ — ' + cut((pult.out.split('\n').find((l) => /Скрипт без кнопки|Команда dc без кнопки|gen-docs|✖ /.test(l)) || '').trim(), 110));
  if (pult.code) bad++;
  if (tsc.err || jest.err) { say('Сбой запуска npx: ' + (tsc.err || jest.err).message); return 2; }
  say(bad ? `Итог: проверки не прошли (${bad})` : 'Итог: tsc, юнит, импорты и пульт зелёные (как шаги 4–5 ворот preflight)');
  return bad ? 1 : 0;
}

function cmdStatus() {
  let bad = 0;
  const h = prodGet('/api/health');
  log(h.text);
  let hj = null;
  try { hj = JSON.parse(h.text); } catch { /* не json */ }
  if (hj?.status === 'ok') say(`Прод: health ok · копия ${hj.info?.backup?.ageHours ?? '?'} ч назад`);
  else { say('Прод: health НЕ ок — ' + cut(h.text.trim(), 120)); bad++; }
  const v = run('curl', ['-s', '-m', '20', PROD_URL + '/app/version.json']);
  log(v.stdout);
  let vj = null;
  try { vj = JSON.parse(v.stdout); } catch { /* не json */ }
  say(vj ? `Версия сервера: ${vj.v} (сборка ${vj.n}, ${fmtTime(vj.date)})` : 'Версия сервера: не получена');
  if (!vj) bad++;
  const head = run('git', ['rev-parse', '--short', 'HEAD']).stdout.trim();
  if (vj && head && vj.v !== head) say(`HEAD локально ${head} — на сайте другой коммит`);
  try { say('Последний полный прогон: ' + (lastTestLog(fs.readFileSync(path.join(ROOT, 'docs', 'TEST-LOG.md'), 'utf8')) || 'нет записей')); } catch { say('TEST-LOG не прочитан'); }
  say('Ночной прогон: ' + nightLine());
  return bad ? 1 : 0;
}

/** Состояние ночного прогона: идёт (есть lock.json) или итог последнего summary.json. */
function nightLine() {
  const dir = path.join(ROOT, 'tools', '.night');
  if (fs.existsSync(path.join(dir, 'lock.json'))) return 'идёт сейчас';
  try {
    const runs = fs.readdirSync(path.join(dir, 'runs')).sort();
    for (const r of runs.reverse()) {
      const f = path.join(dir, 'runs', r, 'summary.json');
      if (!fs.existsSync(f)) continue;
      const steps = JSON.parse(fs.readFileSync(f, 'utf8')).steps || [];
      const red = steps.filter((s) => s.code !== 0).length;
      return `последний ${r}: зелёных ${steps.length - red}, красных ${red}`;
    }
  } catch { /* прогонов ещё нет */ }
  return 'ещё не запускался';
}

/** Возраст копий: дом и Sportin — из открытого /api/health (backup), ПК — свежий файл в D:\datacore-backups. Старше 30 ч — находка. */
export const BACKUP_SOURCES = [['дом', 'https://kppdf-crm.ru/db/api/health'], ['Sportin', 'http://31.222.224.247:8080/api/health']];
export function backupWord(body) {
  try {
    const j = JSON.parse(body); const b = (j.details || j.info || {}).backup || (j.error || {}).backup;
    if (!b) return { bad: true, text: 'нет данных' };
    if (b.ageHours != null) return { bad: b.status !== 'up', text: `${b.ageHours} ч` + (b.status !== 'up' ? ' — СТАРАЯ' : '') };
    return { bad: b.status !== 'up', text: b.message || b.note || b.status };
  } catch { return { bad: true, text: 'не отвечает' }; }
}
function backupsLine() {
  let bad = false; const parts = [];
  for (const [name, url] of BACKUP_SOURCES) {
    const r = run('curl', ['-s', '-m', '15', url], { timeout: 20000 });
    const w = backupWord(r.stdout); bad ||= w.bad; parts.push(`${name} ${w.text}`);
    log(`${name} ${url}: ${r.stdout.slice(0, 400)}`);
  }
  const dir = process.env.DC_BACKUPS || 'D:/datacore-backups';
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.tgz')).map((f) => fs.statSync(path.join(dir, f)).mtimeMs) : [];
  const pcH = files.length ? Math.round((Date.now() - Math.max(...files)) / 36e5) : null;
  parts.push(`ПК ${pcH == null ? 'нет' : pcH + ' ч'}`);
  say('Копии: ' + parts.join(' · ') + (bad ? '  ← проверить бэкап' : ''));
  return bad;
}

function cmdStart() {
  let code = 0;
  const hp = run('git', ['config', 'core.hooksPath']).stdout.trim();
  if (hp !== '.githooks') { run('git', ['config', 'core.hooksPath', '.githooks']); say('Хук меток коммита: включён (core.hooksPath=.githooks)'); }
  else say('Хук меток коммита: на месте');
  const br = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
  const fe = run('git', ['fetch', '--quiet'], { timeout: 60000 });
  log('fetch код ' + fe.code + ' ' + fe.out);
  const ab = parseAheadBehind(run('git', ['rev-list', '--left-right', '--count', 'HEAD...@{u}']).stdout);
  const st = parseGitStatus(run('git', ['status', '--porcelain']).stdout);
  log(run('git', ['status', '--short']).stdout);
  say(`Ветка ${br}: ` + (ab ? `впереди ${ab.ahead}, позади ${ab.behind}` : 'сравнить с origin не удалось') + (fe.code ? ' (fetch не удался)' : ''));
  say(st.changed || st.untracked ? `Незакоммиченное: изменено ${st.changed}, новых ${st.untracked}` : 'Незакоммиченного нет');
  if (st.changed) code = 1;
  if (ab?.behind) { code = 1; say('Отстаёт от origin: нужен git pull (чужие правки — сначала спросить)'); }
  if (backupsLine()) code = Math.max(code, 1);
  const e = cmdErrors(24);
  if (e.code === 2) code = 2; else if (e.count) code = Math.max(code, 1);
  return code;
}

// ---------- архив на сервере (devlog): законченные ТЗ, аудиты, старый журнал и задачи ----------

/** dc find <слово>: где встречается — рабочие доки (git grep) и архив на сервере (поиск по тексту). */
function cmdFind(words) {
  const q = words.join(' ').trim();
  if (!q) { say('Укажите слово: dc find <слово>'); return 2; }
  const loc = run('git', ['-c', 'core.quotepath=off', 'grep', '-n', '-i', '-F', q, '--', 'docs', 'AGENTS.md', 'CLAUDE.md', ':!docs/archive', ':!docs/openapi.json']);
  const hits = loc.stdout.split('\n').filter(Boolean);
  log(loc.stdout);
  say(`В рабочих доках: ${hits.length}`);
  for (const h of hits.slice(0, 5)) say('  ' + cut(h, 150));
  const r = prodGet(`/api/devlog/docs?limit=10&search=${encodeURIComponent(q)}`);
  log(r.text);
  let items = null;
  try { items = JSON.parse(r.text).items; } catch { /* ниже — сбой */ }
  if (!r.ok || !items) { say('Архив на сервере: сбой — ' + cut(r.text.trim(), 120)); return 2; }
  say(`В архиве на сервере: ${items.length}${items.length === 10 ? '+' : ''}`);
  for (const d of items.slice(0, 7)) say(`  ${d.path} — ${cut(d.title, 70)}`);
  if (items.length) say('Текст: dc doc <путь>');
  return hits.length || items.length ? 0 : 1;
}

/** dc doc <путь> [слово]: файл из репо, а нет — из архива на сервере. Со словом — только строки рядом с ним. */
function cmdDoc(p, word) {
  if (!p) { say('Укажите путь: dc doc docs/roles/tz/SK-5a.md [слово]'); return 2; }
  let text = '';
  if (fs.existsSync(path.join(ROOT, p))) text = fs.readFileSync(path.join(ROOT, p), 'utf8');
  else {
    const list = prodGet(`/api/devlog/docs?path=${encodeURIComponent(p)}`);
    let id;
    try { id = JSON.parse(list.text).items[0]?.id; } catch { /* нет */ }
    if (!id) { say(`Нет ни в репо, ни в архиве: ${p}. Поиск: dc find <слово>`); return 1; }
    const one = prodGet(`/api/devlog/docs/${id}`);
    try { text = JSON.parse(one.text).text || ''; } catch { say('Сбой чтения архива — ' + cut(one.text, 120)); return 2; }
  }
  const all = text.split(/\r?\n/);
  const pick = word ? all.flatMap((l, i) => (l.toLowerCase().includes(word.toLowerCase()) ? [i] : []))
    .flatMap((i) => all.slice(Math.max(0, i - 2), i + 3).concat('…')) : all;
  // итог dc обрезается до 14 строк: документ печатаем целиком сразу, в лог — тоже
  log(pick.join('\n'));
  console.log(pick.join('\n'));
  return 0;
}

function cmdLogs(name) {
  const files = fs.existsSync(LOGS) ? fs.readdirSync(LOGS).filter((f) => f.endsWith('.log') && (!name || f.includes(name))).sort() : [];
  if (!files.length) { console.log('Логов нет' + (name ? ` по имени «${name}»` : '')); process.exit(1); }
  const f = path.join(LOGS, files[files.length - 1]);
  console.log('# ' + path.relative(ROOT, f).replace(/\\/g, '/'));
  console.log(fs.readFileSync(f, 'utf8'));
  process.exit(0);
}

async function main(argv) {
  const [cmd, arg] = argv;
  try {
    if (cmd === 'logs') return cmdLogs(arg);
    const table = {
      start: () => cmdStart(),
      errors: () => cmdErrors(Number(arg) > 0 ? Number(arg) : 24).code,
      check: () => cmdCheck(),
      data: () => cmdData(),
      status: () => cmdStatus(),
      stand: () => cmdStand(arg, { log, say }),
      night: () => cmdNight({ quick: argv.includes('--quick') }, { log, say }),
      find: () => cmdFind(argv.slice(1)),
      doc: () => cmdDoc(arg, argv[2]),
    };
    if (!table[cmd]) {
      console.log('dc start | errors [часы] | check | data | status | find <слово> | doc <путь> [слово] | logs [имя] | stand [up|down|status] | night [--quick]\nКоды выхода: 0 норма · 1 находки · 2 сбой инструмента');
      process.exit(cmd ? 2 : 0);
    }
    finish(cmd, await table[cmd]());
  } catch (e) {
    say('Сбой инструмента dc: ' + e.message);
    log(e.stack || '');
    finish(cmd || 'dc', 2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
