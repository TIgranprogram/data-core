#!/usr/bin/env node
/**
 * Перенос доски «Проектирование» из YouGile (выгрузка MCP) в /api/design-tasks.
 *   node scripts/yougile-import.js <local|prod> <папка-выгрузки>                 — план, ничего не пишет
 *   node scripts/yougile-import.js <local|prod> <папка> --apply --out откат.json [--replace]
 * В папке: mcp-export.json, lines.json, persons.json. Пары «ЗНП → заказ» — только подтверждённые (ZNP ниже).
 * --replace — сначала мягко удалить задачи доски, что не из YouGile (вернуть — POST /api/design-tasks/:id/restore).
 * Повтор безопасен: задача с примечанием «YouGile D-N» уже есть — пропуск.
 * Пароль берётся как в deploy/synology/api.sh (access.env / config.env), в вывод не попадает.
 */
const fs = require('fs');
const path = require('path');

const [env, dir, ...flags] = process.argv.slice(2);
if (!['local', 'prod'].includes(env) || !dir) { console.error('usage: <local|prod> <папка> [--apply --out f.json] [--replace]'); process.exit(2); }
const APPLY = flags.includes('--apply');
const REPLACE = flags.includes('--replace');
const OUT = flags[flags.indexOf('--out') + 1];
if (APPLY && (!OUT || OUT.startsWith('--'))) { console.error('--apply требует --out откат.json'); process.exit(2); }
const BASE = env === 'prod' ? 'https://kppdf-crm.ru/db' : 'http://localhost:3001';

// Подтверждено пользователем 2026-10-27; остальные ЗНП — без позиции, ЗНП в примечании.
const ZNP = { '11-26': '9', '10-26': '10', '8-26': '90-П' };
const PERSON = { 'Александр Нестратов': 'Нестратов Александр', Tigran: 'Овакян Тигран', 'Аркадий': 'Сим Аркадий' };
const STATUS = { 'На распределении': 'queue', 'В работе': 'work', 'Приостановлены': 'paused', 'Завершены': 'done' };
const PRIORITY = { 'Обычный': 'normal', 'В приоретете': 'high', 'Срочно': 'urgent', 'Низкий': 'low' };
const MAX_PHOTOS = 20;

const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const E = read('mcp-export.json');
const LINES = read('lines.json').items;

function creds() {
  const d = path.join(__dirname, '../../deploy/synology');
  const get = (k, f) => { try { const m = fs.readFileSync(path.join(d, f), 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].replace(/["\r]/g, '') : ''; } catch { return ''; } };
  return { username: get('ACCESS_USER', 'access.env') || 'admin', password: get('ACCESS_PASSWORD', 'access.env') || get('ADMIN_PASSWORD', 'config.env') };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token = '';
async function login() {
  const c = creds();
  if (!c.password) throw new Error('нет пароля (config.env / access.env)');
  const j = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c) }).then((r) => r.json());
  token = j.access || j.tokens?.access;
  if (!token) throw new Error('вход не удался');
}
async function api(method, p, body, isForm) {
  for (let i = 0; ; i++) {
    await sleep(700); // лимит 100/мин
    const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${token}`, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    if (r.status === 429 && i < 5) { await sleep(15000); continue; }
    if (r.status === 401 && i < 2) { await sleep(13000); await login(); continue; } // токен живёт недолго
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = txt; }
    if (!r.ok) { const e = new Error(`${method} ${p} → ${r.status} ${typeof j === 'object' ? j.message : txt.slice(0, 200)}`); e.status = r.status; throw e; }
    return j;
  }
}

const photoUrls = (t) => [...new Set(t.messages.flatMap((m) => m.text.match(/https:\/\/yougile\.com\/user-data\/[^\s?"<>]+/g) || []))];

function plan(persons) {
  const pid = Object.fromEntries(persons.map((p) => [p.name, p.id]));
  const users = Object.fromEntries(E.users.map((u) => [u.id, u.name]));
  return E.tasks.filter((t) => !t.archived).map((t) => {
    const znp = (t.title.match(/ЗНП\s*([\d-]+)/i) || [])[1] || '';
    const pos = +((t.title.match(/поз\.?\s*(\d+)/i) || [])[1] || 0);
    const order = ZNP[znp];
    const line = order ? LINES.find((l) => l.orderNo === order && l.lineNo === pos) : null;
    const names = t.assignedUserIds.map((i) => users[i] || i);
    const assigneeId = pid[PERSON[names[0]]] || null;
    const pri = Object.values(t.stickers).map((v) => PRIORITY[v]).find(Boolean) || 'normal';
    const items = t.checklists.flatMap((c) => c.items.map((i) => `${i.isCompleted ? '☑' : '☐'} ${i.title}`)).concat(t.subtasks.map((s) => `${s.complete ? '☑' : '☐'} ${s.title}`));
    const first = (t.messages[0]?.text || '').replace(/https?:\/\/\S+/g, '').trim();
    const note = [
      `YouGile ${t.taskId}`,
      !line && znp ? `ЗНП ${znp}${pos ? ` поз ${pos}` : ''}` : '',
      !assigneeId && names.length ? `Исполнитель в YouGile: ${names.join(', ')}` : names.length > 1 ? `Ещё исполнители: ${names.slice(1).join(', ')}` : '',
      t.complete && t.completeAt ? `Завершено в YouGile: ${t.completeAt.slice(0, 10)}` : '',
      items.length ? `Подзадачи: ${items.join('; ')}` : '',
      first,
    ].filter(Boolean).join('\n').slice(0, 5000);
    return {
      yg: t.taskId, title: t.title.slice(0, 300), status: STATUS[t.column], incomeId: line?._id || null,
      assigneeId, deadline: t.deadline ? t.deadline.slice(0, 10) : null, priority: pri, note, photos: photoUrls(t).slice(0, MAX_PHOTOS),
    };
  });
}

async function uploadPhoto(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`фото ${r.status}`);
  const blob = await r.blob();
  const fd = new FormData();
  fd.append('file', blob, path.basename(new URL(url).pathname));
  const res = await api('POST', '/api/photos/upload', fd, true);
  return res.original?._id || res.original?.id || res._id || res.id;
}

(async () => {
  await login();

  const persons = (await api('GET', '/api/persons?limit=500')).items.map((p) => ({ id: p.id, name: p.name || p.fullName || [p.lastName, p.firstName].filter(Boolean).join(' ') }));
  const existing = (await api('GET', '/api/design-tasks?limit=500&status=queue,work,paused,done')).items;
  const done = new Set(existing.map((t) => (String(t.note || '').match(/^YouGile (D-\d+)/) || [])[1]).filter(Boolean));
  const toDelete = REPLACE ? existing.filter((t) => !/^YouGile D-\d+/.test(String(t.note || ''))) : [];
  const rows = plan(persons).filter((r) => !done.has(r.yg));

  const cnt = {}; rows.forEach((r) => { cnt[r.status] = (cnt[r.status] || 0) + 1; });
  console.log(`${env}: удалить ${toDelete.length} (${toDelete.map((t) => t.code).join(', ')}); создать ${rows.length} ${JSON.stringify(cnt)}; уже есть ${done.size}`);
  console.log(`с позицией ${rows.filter((r) => r.incomeId).length}, с исполнителем ${rows.filter((r) => r.assigneeId).length}, фото ${rows.reduce((a, r) => a + r.photos.length, 0)}`);
  if (!APPLY) { const miss = Object.values(PERSON).filter((n) => !persons.some((p) => p.name === n)); if (miss.length) console.log(`нет сотрудников: ${miss.join(", ")}; есть: ${persons.map((p) => p.name).join(", ")}`); return; }

  const log = { env, at: new Date().toISOString(), deleted: [], created: [], problems: [] };
  const save = () => fs.writeFileSync(OUT, JSON.stringify(log, null, 1));
  for (const t of toDelete) { await api('DELETE', `/api/design-tasks/${t.id}`); log.deleted.push(t.id); save(); }

  for (const r of rows) {
    try {
      const body = { title: r.title, note: r.note, priority: r.priority, ...(r.deadline ? { deadline: r.deadline } : {}), ...(r.incomeId ? { incomeId: r.incomeId } : {}) };
      let task;
      try { task = await api('POST', '/api/design-tasks', body); } catch (e) {
        if (e.status !== 409) throw e; // позиция занята открытой задачей — без позиции
        delete body.incomeId; task = await api('POST', '/api/design-tasks', body); log.problems.push(`${r.yg}: позиция занята, создана без позиции`);
      }
      log.created.push({ yg: r.yg, id: task.id, code: task.code }); save();
      let status = r.status;
      if (status === 'work' && !r.assigneeId) { status = 'queue'; log.problems.push(`${r.yg}: «В работе», но нет нашего исполнителя — оставлена «На распределении»`); }
      const patch = { ...(r.assigneeId ? { assigneeId: r.assigneeId } : {}), ...(status !== 'queue' ? { status } : {}), ...(status === 'paused' ? { pauseReason: 'Перенесено из YouGile' } : {}) };
      if (status === 'done' && r.assigneeId === null) { /* done без исполнителя допустим */ }
      if (Object.keys(patch).length) await api('PATCH', `/api/design-tasks/${task.id}`, patch);
      for (const u of r.photos) {
        try { const pid = await uploadPhoto(u); await api('POST', `/api/design-tasks/${task.id}/photos`, { photoId: pid }); } catch (e) { log.problems.push(`${r.yg}: фото не перенесено (${e.message})`); }
      }
      console.log(`${r.yg} → ${task.code} ${status} фото ${r.photos.length}`);
    } catch (e) { log.problems.push(`${r.yg}: ${e.message}`); console.log(`${r.yg} ОШИБКА ${e.message}`); }
    save();
  }
  console.log(`итог: создано ${log.created.length}, удалено ${log.deleted.length}, проблем ${log.problems.length}`);
  log.problems.forEach((p) => console.log(' - ' + p));
})().catch((e) => { console.error(e.message); process.exit(1); });
