#!/usr/bin/env node
/**
 * Заполнить `spec` («что изготовить») у задач проектирования без spec.
 *   node scripts/design-spec-fill.js <local|prod>                            - план, ничего не пишет
 *   node scripts/design-spec-fill.js <local|prod> --apply --out откат.json   - запись (PATCH /api/design-tasks/:id)
 * Источник: 1) для анализа/znp-parsed.json (по productionNo заказа + lineNo позиции) - приоритет;
 *           2) самое раннее сообщение обсуждения source 'yougile' - разбор parseZnpLine (нужна сборка: npx nest build).
 * Откат: [{id, label}] - вернуть PATCH {spec:null}. Повтор безопасен (задачи со spec пропускаются).
 */
const fs = require('fs');
const path = require('path');

let parseZnpLine;
try { ({ parseZnpLine } = require('../dist/modules/design/znp-line')); } catch { console.error('нет dist: сначала npx nest build'); process.exit(2); }

const [env, ...flags] = process.argv.slice(2);
if (!['local', 'prod'].includes(env)) { console.error('usage: <local|prod> [--apply --out откат.json]'); process.exit(2); }
const APPLY = flags.includes('--apply');
const OUT = flags[flags.indexOf('--out') + 1];
if (APPLY && (!OUT || OUT.startsWith('--'))) { console.error('--apply требует --out откат.json'); process.exit(2); }
const BASE = env === 'prod' ? 'https://kppdf-crm.ru/db' : 'http://localhost:3001';

// строка znp-parsed.json -> spec (колонки: № арт вид наим кол-во ед габариты крепление покрытие RAL доп)
function fromParsed(parsed, productionNo, lineNo) {
  const row = (parsed[productionNo]?.rows || []).find((r) => String(r[0]).trim() === String(lineNo));
  if (!row) return null;
  const [qty, unit, size, mount, cover, ral, extra] = row.slice(4, 11).map((x) => String(x ?? '').trim());
  const spec = { qty, unit, size, mount, cover, ral, extra, raw: '' };
  return [qty, unit, size, mount, cover, ral].filter(Boolean).length >= 3 ? spec : null;
}

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
    if (r.status === 401 && i < 2) { await sleep(13000); await login(); continue; }
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = txt; }
    if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${typeof j === 'object' ? j.message : txt.slice(0, 200)}`);
    return j;
  }
}
async function all(p) {
  const out = [];
  for (let page = 1; ; page++) { const r = await api('GET', `${p}?limit=200&page=${page}`); out.push(...(r.items || [])); if (out.length >= (r.total ?? 0) || !(r.items || []).length) break; }
  return out;
}

(async () => {
  await login();
  let parsed = {};
  try { parsed = JSON.parse(fs.readFileSync(path.join(__dirname, '../../для анализа/znp-parsed.json'), 'utf8')); } catch { console.log('znp-parsed.json не найден - только разбор YouGile'); }
  const tasks = (await all('/api/design-tasks')).filter((t) => !t.spec);
  console.log(`Задач без spec: ${tasks.length}`);
  const plan = [], none = [];
  for (const t of tasks) {
    let spec = t.productionNo && t.lineNo != null ? fromParsed(parsed, t.productionNo, t.lineNo) : null, src = 'znp-parsed';
    if (!spec) {
      const notes = (await api('GET', `/api/design-tasks/${t.id}/notes`)).items || [];
      const first = notes.filter((n) => n.source === 'yougile').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];
      spec = first ? parseZnpLine(first.text) : null; src = 'yougile';
    }
    if (spec) plan.push({ id: t.id, label: `D-${t.seq}`, src, spec }); else none.push(`D-${t.seq}`);
  }
  console.log(`ПЛАН: заполнить ${plan.length} (znp-parsed ${plan.filter((p) => p.src === 'znp-parsed').length}, yougile ${plan.filter((p) => p.src === 'yougile').length}); не разобрано ${none.length}: ${none.slice(0, 40).join(', ')}`);
  plan.slice(0, 8).forEach((p) => console.log(`  ${p.label} [${p.src}] ${p.spec.qty} ${p.spec.unit} | ${p.spec.size} | ${p.spec.mount} | ${p.spec.cover} | ${p.spec.ral}`));
  if (!APPLY) return console.log('\nплан - ничего не записано; запись: --apply --out откат.json');
  const log = [];
  try { for (const p of plan) { await api('PATCH', `/api/design-tasks/${p.id}`, { spec: p.spec }); log.push({ id: p.id, label: p.label }); } }
  finally { fs.writeFileSync(OUT, JSON.stringify(log, null, 1)); }
  console.log(`готово: записей ${log.length}; откат - ${OUT}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
