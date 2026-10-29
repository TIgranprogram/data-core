#!/usr/bin/env node
/**
 * «Ведение проекта»: импорт git, TASKS, закрытых документов и набора процесса в data-core.
 *   node scripts/devlog-import.js <local|prod>            - план: что отправил бы, ничего не шлёт
 *   node scripts/devlog-import.js <local|prod> --apply    - отправка (POST /api/devlog/import), затем сверка sha256 документов
 * Идемпотентно: повтор не плодит записи, ручные пометки на сервере не затирает. Запускать на машине разработчика (на VM нет git).
 * Не копирует: stack ошибок, тела коммитов (только заголовок и последняя строка-эстафета), секреты (сервер дополнительно маскирует kppd_… и password=…).
 * Файлы не удаляет: в плане и после сверки только пишет, какие закрытые документы можно удалить (git rm - отдельным коммитом, вручную).
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [env, ...flags] = process.argv.slice(2);
if (!['local', 'prod'].includes(env)) { console.error('usage: <local|prod> [--apply]'); process.exit(2); }
const APPLY = flags.includes('--apply');
const BASE = env === 'prod' ? 'https://kppdf-crm.ru/db' : 'http://localhost:3001';
const ROOT = path.join(__dirname, '../..');
const MAX_BODY = 700_000;

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Коммиты по порядку времени; версия v1.N - как в release.sh (число коммитов, менявших backend/pwa). */
function readCommits() {
  const raw = git('-c', 'core.quotepath=off', 'log', '--reverse', '--name-only', '--format=%x1e%H%x1f%aI%x1f%s%x1f%b%x1f');
  const out = [];
  let n = 0, pending = [];
  for (const rec of raw.split('\x1e').slice(1)) {
    const [hash, date, subject, body, files] = rec.split('\x1f');
    const paths = (files || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const footer = (body || '').split('\n').map((s) => s.trim()).filter(Boolean).pop();
    const c = { hash: hash.slice(0, 12), date, subject: subject.slice(0, 500), paths: paths.slice(0, 50) };
    if (footer && /[🏠🏢]/u.test(footer)) c.footer = footer.slice(0, 300);
    pending.push(c);
    if (paths.some((p) => p.startsWith('backend/pwa'))) {
      n++;
      for (const p of pending) p.releaseVersion = `v1.${n}`;
      pending = [];
    }
    out.push(c);
  }
  return out;
}

/** Задачи из TASKS.md: `- [x] 1.1 текст` -> task:<код>. Строки без латинского кода пропускаем. */
function readTasks() {
  const f = path.join(ROOT, 'docs/TASKS.md');
  if (!fs.existsSync(f)) return [];
  const seen = new Set(), items = [];
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+\[([ x~])\]\s+\**([A-Za-z0-9][A-Za-z0-9.-]{0,40}?)\**[\s:—-]+(.+)$/);
    if (!m || seen.has(m[2])) continue;
    seen.add(m[2]);
    items.push({ key: `task:${m[2]}`, type: 'task', title: m[3].replace(/[*`]/g, '').slice(0, 300), status: m[1] === 'x' ? 'done' : 'open', file: 'docs/TASKS.md' });
  }
  return items;
}

const WORKING = /^docs\/(AGENTS|CLAUDE|CANON|PRODUCT|DESIGN|MAP|ARCHITECTURE|data-model|TASKS|QUESTIONS)\.md$|^docs\/roles\/(README|TZ-TEMPLATE|lessons-coordinator|analyst|architect|backend|data-steward|designer|frontend|qa)\.md$|^docs\/roles\/maps\//;

function docKind(rel) {
  if (/audit/i.test(rel)) return 'audit';
  if (/\/tz\//.test(rel)) return 'tz';
  return 'checklist';
}

/** Закрытый = все пункты [x]/[-] (хотя бы один) или в шапке (первые 15 строк) слово «Архив». */
function isClosed(text) {
  // шапка: строка начинается с «Архив» или «Статус: архив»
  if (/^[>*\s]*(статус\s*:\s*)?\**архив/im.test(text.split(/\r?\n/).slice(0, 15).join('\n'))) return true;
  const boxes = [...text.matchAll(/^\s*[-*]\s+\[([ x~-])\]/gm)].map((m) => m[1]);
  return boxes.length > 0 && boxes.every((b) => b === 'x' || b === '-');
}

function readDocs() {
  const files = git('ls-files', 'docs').split('\n').filter((p) => /\.md$/.test(p) && !WORKING.test(p) && /(CHECKLIST|audit|AUDIT|\/tz\/)/.test(p));
  const docs = [], open = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (text.length > 600_000) { console.warn(`  пропуск (больше 600 КБ): ${rel}`); continue; }
    if (!isClosed(text)) { open.push(rel); continue; }
    const title = (text.match(/^#\s+(.+)$/m) || [, path.basename(rel)])[1].slice(0, 300);
    docs.push({ path: rel, title, kind: docKind(rel), text, sha: sha(text) });
  }
  return { docs, open };
}

const KIT = [/^\.claude\/agents\/[\w.-]+\.md$/, /^\.claude\/skills\/[\w.-]+\/SKILL\.md$/, /^docs\/roles\/(README|TZ-TEMPLATE)\.md$/, /^(CLAUDE|AGENTS)\.md$/, /^docs\/(CANON|DESIGN)\.md$/];
function readKit() {
  return git('ls-files').split('\n').filter((p) => KIT.some((re) => re.test(p)))
    .map((p) => ({ path: p, text: fs.readFileSync(path.join(ROOT, p), 'utf8') }))
    .filter((k) => k.text.length <= 200_000);
}

/** Пачки с ограничением по числу и размеру тела. */
function batches(list, maxCount, size) {
  const out = []; let cur = [], bytes = 0;
  for (const x of list) {
    const s = size(x);
    if (cur.length && (cur.length >= maxCount || bytes + s > MAX_BODY)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(x); bytes += s;
  }
  if (cur.length) out.push(cur);
  return out;
}

function creds() {
  const d = path.join(ROOT, 'deploy/synology');
  const get = (k, f) => { try { const m = fs.readFileSync(path.join(d, f), 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].replace(/["\r]/g, '') : ''; } catch { return ''; } };
  return { username: get('ACCESS_USER', 'access.env') || 'admin', password: get('ACCESS_PASSWORD', 'access.env') || get('ADMIN_PASSWORD', 'config.env') };
}
let token = '';
async function login() {
  const c = creds();
  if (!c.password) throw new Error('нет пароля (config.env / access.env)');
  const j = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) }).then((r) => r.json());
  token = j.access || (j.tokens && j.tokens.access);
  if (!token) throw new Error('вход не удался');
}
async function api(method, p, body) {
  await new Promise((r) => setTimeout(r, 700)); // лимит запросов в минуту
  const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : {};
}

(async () => {
  const commits = readCommits();
  const items = readTasks();
  const { docs, open } = readDocs();
  const kit = readKit();
  const kitVersion = git('rev-parse', '--short=12', 'HEAD').trim();
  const versions = new Set(commits.map((c) => c.releaseVersion).filter(Boolean));
  console.log(`${APPLY ? 'ОТПРАВКА' : 'ПЛАН, ничего не отправляется'} -> ${BASE}`);
  console.log(`  коммитов: ${commits.length} (версий приложения: ${versions.size}); задач: ${items.length}; ошибки: копия групп clienterrors на сервере`);
  console.log(`  набор процесса: ${kit.length} файлов (снимок ${kitVersion})`);
  console.log(`  документы: закрытых ${docs.length}, рабочих/открытых ${open.length}`);
  for (const d of docs) console.log(`    закрыт: ${d.path} [${d.kind}] ${d.sha.slice(0, 12)}`);
  if (!APPLY) {
    console.log('  Удалять документы нельзя до сверки: после --apply скрипт сверит sha256 с сервером и назовёт файлы, которые можно удалить (git rm - отдельным коммитом).');
    return;
  }
  await login();
  const total = {};
  const add = (r) => { for (const [k, v] of Object.entries(r)) total[k] = (total[k] || 0) + (typeof v === 'number' ? v : 0); };
  for (const b of batches(commits, 300, (c) => JSON.stringify(c).length)) add(await api('POST', '/api/devlog/import', { commits: b }));
  for (const b of batches(items, 500, (i) => JSON.stringify(i).length)) add(await api('POST', '/api/devlog/import', { items: b }));
  for (const b of batches(kit, 80, (k) => k.text.length)) add(await api('POST', '/api/devlog/import', { kit: b.map(({ path: p, text }) => ({ path: p, text })), kitVersion }));
  for (const b of batches(docs, 20, (d) => d.text.length)) add(await api('POST', '/api/devlog/import', { docs: b.map(({ sha: _s, ...d }) => d) }));
  add(await api('POST', '/api/devlog/import', { syncErrors: true }));
  console.log('  новых записей на сервере:', JSON.stringify(total));
  const ok = [], bad = [];
  for (const d of docs) {
    const r = await api('GET', `/api/devlog/docs?path=${encodeURIComponent(d.path)}`);
    ((r.items || [])[0] && r.items[0].sha256 === d.sha ? ok : bad).push(d.path);
  }
  console.log(`  сверка sha256: совпало ${ok.length}, не совпало ${bad.length}`);
  if (bad.length) console.log('  НЕ удалять:\n    ' + bad.join('\n    '));
  if (ok.length) console.log('  можно удалить (git rm, отдельным коммитом «docs: архив → devlog»):\n    ' + ok.join('\n    '));
})().catch((e) => { console.error('devlog-import:', e.message); process.exit(1); });
