#!/usr/bin/env node
/**
 * Перенос переписки задач «Разработка ТД» из YouGile в обсуждение задач проектирования (/api/design-tasks/:id/notes).
 *   node scripts/yougile-notes-import.js <local|prod> <папка-выгрузки>                     — план, ничего не пишет
 *   node scripts/yougile-notes-import.js <local|prod> <папка> --apply --out откат.json
 * В папке: messages.json ([{id, title, msgs:[{a, ts, text}]}] — MCP query_tasks), mcp-export.json (id → D-N), users.json.
 * Задача на сайте находится по примечанию «YouGile D-N». Запись — комментарий, source 'yougile', автор — имя сотрудника,
 * время — из YouGile, externalId `yg:<id задачи>:<ts>` (повтор без дублей). Ссылки на картинки → «[фото]» (фото уже в задаче).
 * Переписка карточек «Производства» не переносится: у них нет задачи проектирования.
 */
const fs = require('fs');
const path = require('path');

const [env, dir, ...flags] = process.argv.slice(2);
if (!['local', 'prod'].includes(env) || !dir) { console.error('usage: <local|prod> <папка> [--apply --out f.json]'); process.exit(2); }
const APPLY = flags.includes('--apply');
const OUT = flags[flags.indexOf('--out') + 1];
if (APPLY && (!OUT || OUT.startsWith('--'))) { console.error('--apply требует --out откат.json'); process.exit(2); }
const BASE = env === 'prod' ? 'https://kppdf-crm.ru/db' : 'http://localhost:3001';
const PERSON = { 'Александр Нестратов': 'Нестратов Александр', Tigran: 'Овакян Тигран', 'Александр Еничевский': 'Еничевский Александр' };

const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const MSG = read('messages.json');
const YG = Object.fromEntries(read('mcp-export.json').tasks.filter((t) => t.p === 'D' && t.taskId).map((t) => [t.id, t.taskId]));
const USERS = Object.fromEntries(read('users.json').map((u) => [u.id, u.name]));
const clean = (s) => String(s || '').replace(/https?:\/\/\S+/g, '[фото]').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);

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
async function api(method, p, body) {
  for (let i = 0; ; i++) {
    await sleep(700); // лимит 100/мин
    const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429 && i < 5) { await sleep(15000); continue; }
    if (r.status === 401 && i < 2) { await sleep(13000); await login(); continue; } // перевход только на 401 (лимит входа 20/час)
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = txt; }
    if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${typeof j === 'object' ? j.message : txt.slice(0, 200)}`);
    return j;
  }
}

(async () => {
  await login();
  const tasks = (await api('GET', '/api/design-tasks?status=queue,work,done,paused&limit=500')).items;
  const byYg = Object.fromEntries(tasks.map((t) => [(String(t.note || '').match(/^YouGile (D-\d+)/) || [])[1], t]).filter(([k]) => k));
  const plan = []; const miss = []; let skipZ = 0;
  for (const t of MSG) {
    const d = YG[t.id];
    if (!d) { skipZ += t.msgs.length; continue; }
    const site = byYg[d];
    if (!site) { miss.push(`${d} (${t.msgs.length})`); continue; }
    for (const m of t.msgs) {
      const text = clean(m.text);
      if (!text) continue;
      const who = USERS[m.a] || 'YouGile';
      plan.push({ taskId: site.id, code: site.code, yg: d, body: { text, kind: 'comment', source: 'yougile', authorName: PERSON[who] || who, createdAt: new Date(m.ts).toISOString(), externalId: `yg:${t.id}:${m.ts}` } });
    }
  }
  const per = {}; plan.forEach((p) => { per[p.body.authorName] = (per[p.body.authorName] || 0) + 1; });
  console.log(`записей к переносу: ${plan.length} в ${new Set(plan.map((p) => p.taskId)).size} задач; авторы:`, per);
  console.log(`пропуск: «Производство» — ${skipZ} сообщ.; задачи YouGile без задачи на сайте: ${miss.join(', ') || '—'}`);
  plan.slice(0, 5).forEach((p) => console.log(' ', p.code, '←', p.yg, p.body.createdAt.slice(0, 16), p.body.authorName + ':', p.body.text.slice(0, 70).replace(/\n/g, ' ')));
  if (!APPLY) return console.log('план — ничего не записано; запись: --apply --out откат.json');
  const done = [];
  for (const p of plan) { const r = await api('POST', `/api/design-tasks/${p.taskId}/notes`, p.body); done.push({ id: r.id, taskId: p.taskId, externalId: p.body.externalId }); }
  fs.writeFileSync(OUT, JSON.stringify(done, null, 1));
  console.log(`записано ${done.length}; откат — DELETE /api/design-notes/<id> из ${OUT}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
