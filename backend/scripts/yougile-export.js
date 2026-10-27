#!/usr/bin/env node
/**
 * Выгрузка доски из YouGile по API v2 (только чтение) — для переноса «Проектирования».
 * Ключ: файл «для анализа/yougile.env» (gitignored) со строкой YOUGILE_KEY=… — ключ в консоль не печатается.
 * Запуск из корня репо:  node backend/scripts/yougile-export.js [фильтр названия доски]
 * Результат: «для анализа/yougile-2026-10-27/export.json» — доски, колонки, задачи (с подзадачами, чек-листами, стикерами, исполнителями), сотрудники, стикеры.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ENV = path.join(ROOT, 'для анализа', 'yougile.env');
const OUT = path.join(ROOT, 'для анализа', 'yougile-2026-10-27', 'export.json');
const API = 'https://yougile.com/api-v2';

// второй источник — прежний сервер синхронизации (06_ИИ_Агенты_и_Инструменты/yougile-sync-server/.env, YG_API_TOKEN)
const SYNC_ENV = path.resolve(ROOT, '..', '..', '06_ИИ_Агенты_и_Инструменты', 'yougile-sync-server', '.env');
const read = (f, re) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '').match(re)?.[1];
const key = read(ENV, /^\s*YOUGILE_KEY\s*=\s*(\S+)/m) || read(SYNC_ENV, /^\s*YG_API_TOKEN\s*=\s*(\S+)/m);
if (!key || /your-yougile/.test(key)) { console.error(`Нет ключа: создайте ${ENV} со строкой YOUGILE_KEY=<ключ>`); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(p, q = {}) {
  const u = new URL(API + p);
  for (const [k, v] of Object.entries(q)) if (v !== undefined) u.searchParams.set(k, String(v));
  for (let i = 0; i < 5; i++) {
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } });
    if (r.status === 429) { await sleep(2000 * (i + 1)); continue; } // лимит YouGile ~50 запросов/мин
    if (!r.ok) throw new Error(`${p}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    await sleep(1300);
    return r.json();
  }
  throw new Error(p + ': 429 — лимит запросов');
}
/** Все страницы списка ({content, paging:{next}}). */
async function all(p, q = {}) {
  const out = []; let offset = 0;
  for (;;) {
    const r = await get(p, { ...q, limit: 1000, offset });
    const items = r.content || r;
    out.push(...items);
    if (!r.paging?.next || !items.length) return out;
    offset += items.length;
  }
}

(async () => {
  const filter = (process.argv[2] || '').toLowerCase();
  const projects = await all('/projects');
  let boards = await all('/boards');
  if (filter) boards = boards.filter((b) => (b.title || '').toLowerCase().includes(filter));
  console.log(`Проектов: ${projects.length}, досок: ${boards.length}${filter ? ` (фильтр «${filter}»)` : ''}`);
  for (const b of boards) console.log('  доска:', b.title);
  const columns = [];
  for (const b of boards) columns.push(...(await all('/columns', { boardId: b.id })));
  const tasks = [];
  for (const c of columns) tasks.push(...(await all('/tasks', { columnId: c.id })));
  // подзадачи лежат в своих колонках не всегда — догружаем по id
  const have = new Set(tasks.map((t) => t.id));
  for (const t of [...tasks]) for (const sid of t.subtasks || []) if (!have.has(sid)) { try { tasks.push({ ...(await get('/tasks/' + sid)), _sub: true }); have.add(sid); } catch (e) { console.warn('подзадача', sid, e.message); } }
  const users = await all('/users');
  let stringStickers = [], sprintStickers = [];
  try { stringStickers = await all('/string-stickers'); } catch (e) { console.warn('стикеры:', e.message); }
  try { sprintStickers = await all('/sprint-stickers'); } catch (e) { console.warn('спринт-стикеры:', e.message); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), projects, boards, columns, tasks, users, stringStickers, sprintStickers }, null, 1));
  console.log(`Колонок: ${columns.length}, задач: ${tasks.length}, сотрудников: ${users.length}, стикеров: ${stringStickers.length}+${sprintStickers.length}`);
  console.log('Записано:', path.relative(ROOT, OUT));
})().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
