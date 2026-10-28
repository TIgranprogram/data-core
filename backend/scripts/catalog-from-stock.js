#!/usr/bin/env node
/**
 * Наполнить каталог поставщиков (supplieritems) из заявок снабжения и склада.
 *   node scripts/catalog-from-stock.js <local|prod>                          - план, ничего не пишет
 *   node scripts/catalog-from-stock.js <local|prod> --apply --out откат.json - запись
 * Только через API: GET /api/supply/requests, GET /api/materials, GET /api/supply/catalog/items, POST /api/supply/catalog/bulk.
 * 1) Склад: покупные материалы (не системные, не «Деталь») С поставщиком -> строка (поставщик, артикул материала), source=stock.
 *    Без поставщика - не создаём, список в отчёте «без поставщика».
 * 2) Заявки: пары (поставщик, артикул | название) среди не удалённых заявок с поставщиком; цена и дата - из последней заявки, source=request.
 * 3) Уже есть (поставщик + артикул + цвет) - не плодим; сервер лишь дополняет пустое (связь с материалом, единица), данные прайса не трогает.
 *    Тот же поставщик и то же нормализованное название при другом артикуле - только «возможные дубли» в отчёт, не склеиваем.
 * Идемпотентно: повторный запуск ничего не добавляет. Ничего не удаляется. Откат: --out содержит id созданных строк
 * (DELETE /api/supply/catalog/items/:id - в корзину). Прод - только после «да» пользователя.
 */
const fs = require('fs');
const path = require('path');

const [env, ...flags] = process.argv.slice(2);
if (require.main === module && !['local', 'prod'].includes(env)) { console.error('usage: <local|prod> [--apply --out откат.json]'); process.exit(2); }
const APPLY = flags.includes('--apply');
const OUT = flags[flags.indexOf('--out') + 1];
if (require.main === module && APPLY && (!OUT || OUT.startsWith('--'))) { console.error('--apply требует --out откат.json'); process.exit(2); }
const BASE = env === 'prod' ? 'https://kppdf-crm.ru/db' : 'http://localhost:3001';

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const color = (c) => (/^[-–—]+$/.test(String(c || '').trim()) ? '' : String(c || '').trim());
const keyOf = (sup, article, col) => `${sup}|${norm(article)}|${norm(color(col))}`;
const idOf = (v) => (v && typeof v === 'object' ? String(v.id || v._id || '') : v ? String(v) : '');

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
async function all(p, limit) {
  const out = [];
  for (let page = 1; ; page++) {
    const j = await api('GET', `${p}${p.includes('?') ? '&' : '?'}page=${page}&limit=${limit}`);
    out.push(...(j.items || []));
    if (out.length >= (j.total ?? 0) || !(j.items || []).length) return out;
  }
}

/** Чистая сборка кандидатов (для теста): материалы -> заявки перекрывают цену/дату. */
function build(materials, requests) {
  const rows = new Map();
  const noSupplier = [];
  for (const m of materials) {
    if (m.isSystem || m.materialKind === 'part' || m.deletedAt) continue;
    const sup = idOf(m.supplierId);
    if (!sup) { noSupplier.push({ id: idOf(m), article: m.article, name: m.name }); continue; }
    const article = String(m.article || '').trim();
    const r = { supplierId: sup, article, name: m.invoiceName || m.name, unit: m.unit, materialId: idOf(m), source: 'stock' };
    if (m.pricePerUnit > 0) r.price = m.pricePerUnit;
    rows.set(keyOf(sup, article || `manual:${r.materialId}`, ''), r);
  }
  const sorted = [...requests].filter((q) => !q.deletedAt && idOf(q.supplierId)).sort((a, b) => String(a.requestDate || '').localeCompare(String(b.requestDate || '')));
  for (const q of sorted) { // от старых к новым - последняя заявка перекрывает
    const sup = idOf(q.supplierId);
    const article = String(q.article || q.title || '').trim();
    if (!article) continue;
    const k = keyOf(sup, article, q.color);
    const prev = rows.get(k);
    const r = { ...(prev || {}), supplierId: sup, article, color: color(q.color) || undefined, name: prev?.name || q.title || article, unit: q.unit || prev?.unit, source: prev ? prev.source : 'request' };
    const mid = idOf(q.materialId); if (mid) r.materialId = mid;
    if (q.priceHint > 0) { r.price = q.priceHint; if (q.requestDate) r.priceDate = String(q.requestDate).slice(0, 10); }
    rows.set(k, r);
  }
  return { rows: [...rows.values()], noSupplier };
}

/** Сравнение с имеющимся каталогом. */
function diff(rows, existing) {
  const have = new Map(existing.map((e) => [keyOf(e.supplierId, e.article, e.color), e]));
  const byName = new Map(existing.map((e) => [`${e.supplierId}|${norm(e.name)}`, e]));
  const create = [], touch = [], same = [], dups = [];
  for (const r of rows) {
    const e = have.get(keyOf(r.supplierId, r.article || `manual:${r.materialId}`, r.color));
    if (e) { (r.materialId && !e.materialId ? touch : same).push(r); continue; }
    const d = byName.get(`${r.supplierId}|${norm(r.name)}`);
    if (d) dups.push({ new: r.article, existing: d.article, name: r.name, supplierId: r.supplierId });
    create.push(r);
  }
  return { create, touch, same, dups };
}

module.exports = { build, diff, keyOf };

if (require.main === module) {
  (async () => {
    await login();
    console.log(`Среда: ${env}${APPLY ? ' - ЗАПИСЬ' : ' - план'}`);
    const [materials, requests, existing] = await Promise.all([all('/api/materials?', 100), all('/api/supply/requests?', 1000), all('/api/supply/catalog/items?', 500)]);
    console.log(`Склад: ${materials.length} материалов, заявок: ${requests.length}, в каталоге уже: ${existing.length}`);
    const { rows, noSupplier } = build(materials, requests);
    const { create, touch, same, dups } = diff(rows, existing);
    console.log(`К созданию: ${create.length} | дополнится связью: ${touch.length} | уже есть: ${same.length} | без поставщика (не создаём): ${noSupplier.length} | возможные дубли: ${dups.length}`);
    noSupplier.slice(0, 20).forEach((m) => console.log(`  без поставщика: ${m.article} ${m.name}`));
    dups.slice(0, 20).forEach((d) => console.log(`  дубль? ${d.name}: новый «${d.new}», в каталоге «${d.existing}»`));
    if (!APPLY) { console.log('Это план. Запись: --apply --out откат.json'); return; }
    const todo = [...create, ...touch];
    for (let i = 0; i < todo.length; i += 200) {
      const r = await api('POST', '/api/supply/catalog/bulk', { items: todo.slice(i, i + 200) });
      if (r.errors?.length) console.log('  ошибки:', r.errors.join('; '));
    }
    const after = await all('/api/supply/catalog/items?', 500);
    const before = new Set(existing.map((e) => e.id));
    const created = after.filter((e) => !before.has(e.id)).map((e) => ({ id: e.id, supplierId: e.supplierId, article: e.article }));
    fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), env, created, noSupplier, dups }, null, 2));
    console.log(`Готово: создано ${created.length}. Откат: ${OUT}`);
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
