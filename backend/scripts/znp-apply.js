#!/usr/bin/env node
/**
 * ЗНП → заказы и задачи проектирования (ТЗ docs/roles/tz/ZNP-ORDERS.md, «Порядок» п. 4). Источник правды — YouGile.
 *   node scripts/znp-apply.js <local|prod> <папка «для анализа»>                       — план, ничего не пишет
 *   node scripts/znp-apply.js <local|prod> <папка> --apply --out откат.json
 * В папке: znp-parsed.json, znp-match.json, znp-img.json + znp-img/, yougile-2026-10-27/mcp-export.json.
 * Действия: 1) № на производство у заказов; 2) 6 новых заказов 15-26…20-26 с позициями; 3) этап и отгрузка заказов по карточкам
 * доски «Производство»; 4) привязка существующих задач к позициям (PATCH incomeId) и новые задачи для строк с артикулом;
 * 5) вопросы менеджеру в обсуждение задач (externalId `znp:…`). Повтор безопасен: делается только то, чего ещё нет.
 * Откат: у заказов — прежние значения (PATCH), у созданного — id (DELETE); привязку задачи обратно снять нельзя (помечена в файле).
 */
const fs = require('fs');
const path = require('path');

const [env, dir, ...flags] = process.argv.slice(2);
if (!['local', 'prod'].includes(env) || !dir) { console.error('usage: <local|prod> <папка> [--apply --out f.json]'); process.exit(2); }
const APPLY = flags.includes('--apply');
const OUT = flags[flags.indexOf('--out') + 1];
if (APPLY && (!OUT || OUT.startsWith('--'))) { console.error('--apply требует --out откат.json'); process.exit(2); }
const BASE = env === 'prod' ? 'https://kppdf-crm.ru/db' : 'http://localhost:3001';

const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const PARSED = read('znp-parsed.json');
const MATCH = read('znp-match.json');
const IMG = read('znp-img.json');
const YG = read('yougile-2026-10-27/mcp-export.json').tasks;

// ЗНП → наши заказы «№|часть заказчика» (как в znp/match.js)
const ORDERS_OF = {
  '1-26': ['15|ЕХ'], '2-26': ['14|АКАД'], '3-26': ['12|АКАД', '17|АКАД', '18|АКАД'], '4-26': ['25|'], '5-26': ['25|'], '6-26': ['19|', '20|'],
  '7-26': ['13|АКАД'], '8-26': ['90-П|', '109-П|'], '9-26': ['0376300000126000163|'], '10-26': ['10|Сахаджи'], '11-26': ['9|Сахаджи'],
  '12-26': ['110-П|', '111-П|', '114-П|', '115-П|'], '13-26': ['23|'], '14-26': ['22|'],
};
const NEW_ZNP = ['15-26', '16-26', '17-26', '18-26', '19-26', '20-26'];
const ORDER_NO = { '16-26': '0318300017526000116' }; // входящий номер; у остальных новых — сам № на производство
const COLUMN_STAGE = { '6c6a': 'new', '70e9': 'production', '54fb': 'ready', '246f': 'shipped' }; // 07af «Приостановлены» — этапа нет
const COLUMN_NAME = { '6c6a': 'Входящие', '70e9': 'В работе', '54fb': 'Изготовлены не отгружены', '246f': 'Отгружены', '07af': 'Приостановлены' };
const RANK = { cancelled: -1, new: 0, production: 1, ready: 2, shipped: 3, closed: 3 };
const znpNum = (z) => Number(z.split('-')[0]);
const byZnp = (a, b) => znpNum(a) - znpNum(b);

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
async function api(method, p, body, form) {
  for (let i = 0; ; i++) {
    await sleep(700); // лимит 100/мин
    const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${token}`, ...(body && !form ? { 'Content-Type': 'application/json' } : {}) }, body: body ? (form ? body : JSON.stringify(body)) : undefined });
    if (r.status === 429 && i < 5) { await sleep(15000); continue; }
    if (r.status === 401 && i < 2) { await sleep(13000); await login(); continue; } // перевход только на 401 (лимит входа 20/час)
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = txt; }
    if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${typeof j === 'object' ? j.message : txt.slice(0, 200)}`);
    return j;
  }
}
async function allItems(p) {
  const out = [];
  for (let page = 1; ; page++) {
    const items = (await api('GET', `${p}${p.includes('?') ? '&' : '?'}limit=200&page=${page}`)).items || [];
    out.push(...items);
    if (items.length < 200) return out;
  }
}

// ---------- помощники текста ----------
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const normName = (s) => clean(s).toLowerCase().replace(/ё/g, 'е').replace(/[«»"'“”.,]/g, ' ').replace(/\s+/g, ' ').trim();
const LEGAL = new Set(['ооо', 'ип', 'ао', 'зао', 'оао']);
const toks = (s) => new Set(normName(s).split(' ').filter((t) => t && !LEGAL.has(t)));
/** Заказчик «как в справочнике сайта»: совпадение по словам (одно название целиком в другом); иначе — как в ЗНП. */
function siteCustomer(name, dict) {
  const a = toks(name);
  const exact = dict.find((d) => normName(d) === normName(name));
  if (exact) return exact;
  const hit = dict.filter((d) => { const b = toks(d); if (!a.size || !b.size) return false; const [s, l] = a.size <= b.size ? [a, b] : [b, a]; return [...s].every((t) => l.has(t)); });
  return hit.length === 1 ? hit[0] : name;
}
const isoDay = (v) => (v ? String(v).slice(0, 10) : '');
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

function taskNote(z, row) {
  const [pos, art, , name, qty, unit, gab, mount, cover, ral, extra] = row.map((x) => clean(x));
  const gabOk = gab && !/^[?х×x ]+$/i.test(gab);
  return [
    `Арт. ${art}${pos ? ` · поз. ${pos}` : ''} · ЗНП ${z}`,
    name ? `Наименование в ЗНП: ${name}` : '',
    qty ? `Количество: ${qty} ${unit || 'шт'}` : '',
    gab ? (gabOk ? `Габариты: ${gab} мм` : 'Габариты: уточнить') : '',
    mount ? `Крепление: ${mount}` : '',
    cover ? `Ударопоглощающее покрытие: ${/^нет$/i.test(cover) ? 'не нужно' : cover}` : '',
    ral ? `Цвет (RAL): ${ral}` : '',
    extra ? `Доп. информация: ${extra}` : '',
  ].filter(Boolean).join('\n').slice(0, 5000);
}

async function jpeg(file) {
  const sharp = require('sharp');
  return sharp(file).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
}
async function uploadPhoto(file) {
  const fd = new FormData();
  fd.append('file', new Blob([await jpeg(file)], { type: 'image/jpeg' }), path.basename(file).replace(/\.\w+$/, '.jpg'));
  const res = await api('POST', '/api/photos/upload', fd, true);
  return res.original?._id || res.original?.id || res._id || res.id;
}

(async () => {
  await login();
  const [lookups, siteOrders, siteTasks] = await Promise.all([
    api('GET', '/api/incomes/lookups'),
    allItems('/api/salesorders?filter=all'),
    allItems('/api/design-tasks?status=queue,work,done,paused'),
  ]);
  const customersDict = (lookups.customers || []).map((c) => (typeof c === 'string' ? c : c.name)).filter(Boolean);
  const hasSiy = (lookups.companies || []).some((c) => c.name === 'СИЮ');
  const taskByYg = {};
  for (const t of siteTasks) { const m = String(t.note || '').match(/YouGile (D-\d+)/); if (m) taskByYg[m[1]] = t; }
  const taskOnLine = {};
  for (const t of siteTasks) if (t.incomeId) (taskOnLine[t.incomeId] ||= []).push(t);

  // --- заказы сайта по ЗНП ---
  const problems = [];
  const orderIdsOf = {}; // z → [{id, no}]
  for (const z of Object.keys(ORDERS_OF)) {
    orderIdsOf[z] = [];
    for (const k of ORDERS_OF[z]) {
      const [no, sub] = k.split('|');
      const c = siteOrders.filter((o) => o.orderNo === no && (!sub || String(o.customer || '').toUpperCase().includes(sub.toUpperCase())));
      if (c.length !== 1) { problems.push(`ЗНП ${z}: заказ «${no}${sub ? ' ' + sub : ''}» на сайте найден ${c.length} раз`); continue; }
      orderIdsOf[z].push(c[0]);
    }
  }
  const orderById = new Map(siteOrders.map((o) => [o.id, o]));

  // --- карточки «Производство» ---
  const cards = {};
  for (const t of YG.filter((x) => x.p === 'Z')) {
    const m = t.title.match(/^(\d+-\d+)/); if (!m) continue;
    const z = m[1] === '09-26' ? '19-26' : m[1].replace(/^0+/, '');
    cards[z] = { stage: COLUMN_STAGE[t.columnId.slice(0, 4)], column: COLUMN_NAME[t.columnId.slice(0, 4)] || t.columnId.slice(0, 4), deadline: isoDay(t.deadline), title: t.title };
  }

  // ---------- ПЛАН ----------
  const actions = []; // { kind, label, run(ctx) → rollback entry | null }
  const act = (kind, label, run) => actions.push({ kind, label, run });
  const ctx = { orders: new Map(), lines: new Map() }; // новые: z → id заказа; `${z}:${pos}` → id позиции
  const patchOrder = (o, body, before, label, kind) => act(kind, label, async () => { await api('PATCH', `/api/salesorders/${o.id}`, body); return { type: 'order-patch', id: o.id, before }; });

  // 1. № на производство
  const prodNo = new Map(); const alsoZnp = new Map();
  for (const z of Object.keys(ORDERS_OF).sort(byZnp)) for (const o of orderIdsOf[z]) {
    if (!prodNo.has(o.id)) prodNo.set(o.id, z); else if (prodNo.get(o.id) !== z) (alsoZnp.get(o.id) || alsoZnp.set(o.id, []).get(o.id)).push(z);
  }
  for (const [id, z] of prodNo) {
    const o = orderById.get(id);
    const also = alsoZnp.get(id) || [];
    const body = {}; const before = {};
    if ((o.productionNo || '') !== z) { body.productionNo = z; before.productionNo = o.productionNo || ''; }
    const add = also.filter((x) => !String(o.notes || '').includes(`Также ЗНП ${x}`)).map((x) => `Также ЗНП ${x}`);
    if (add.length) { body.notes = [o.notes, ...add].filter(Boolean).join('\n'); before.notes = o.notes || ''; }
    if (Object.keys(body).length) patchOrder(o, body, before, `заказ ${o.orderNo} (${o.customer}) → № на производство ${z}${add.length ? ' + «' + add.join(', ') + '» в примечание' : ''}`, 'productionNo');
  }

  // 2. новые заказы
  const newLineRefs = {}; // z → pos → {id}|{key}
  for (const z of NEW_ZNP) {
    const head = PARSED[z].head; const rows = PARSED[z].rows.filter((r) => num(r[4]) != null);
    const orderNo = ORDER_NO[z] || z;
    const card = cards[z];
    const existing = siteOrders.find((o) => o.orderNo === orderNo && (!o.productionNo || o.productionNo === z));
    const customer = siteCustomer(head['Заказчик'], customersDict);
    const shipDate = card?.deadline || isoDay(head['Дата отгрузки']);
    const body = {
      orderNo, customer, productionNo: z, paymentForm: head['Форма оплаты'] || undefined, shipDate, stage: card?.stage || 'new',
      ...(hasSiy ? { companyName: 'СИЮ' } : {}), clientUid: `znp:${z}`,
    };
    let siteLines = [];
    if (existing) { orderIdsOf[z] = [existing]; siteLines = (await api('GET', `/api/salesorders/${existing.id}/lines-lookup`)); siteLines = siteLines.items || siteLines; }
    else act('order', `новый заказ ${orderNo}: ${customer} · отгрузка ${shipDate} · ${body.stage} · ${rows.length} поз.`, async () => {
      const r = await api('POST', '/api/salesorders', body); ctx.orders.set(z, r.id); return { type: 'order-created', id: r.id };
    });
    newLineRefs[z] = {};
    rows.forEach((r, i) => {
      const n = i + 1; const have = siteLines.find((l) => l.lineNo === n);
      if (have) { newLineRefs[z][r[0]] = { id: have.id }; return; }
      newLineRefs[z][r[0]] = { key: `${z}:${r[0]}` };
      act('line', `позиция ${orderNo}/${n}: ${clean(r[3]).slice(0, 60)} — ${num(r[4])} ${clean(r[5]) || 'шт'}`, async () => {
        const orderId = existing?.id || ctx.orders.get(z);
        const res = await api('POST', '/api/incomes', { orderId, lineNo: n, title: clean(r[3]), qty: num(r[4]), unit: clean(r[5]) || 'шт', clientUid: `znp:${z}:${r[0]}` });
        ctx.lines.set(`${z}:${r[0]}`, res.id); return { type: 'income-created', id: res.id };
      });
    });
  }

  // 3. этап и отгрузка существующих заказов — по карточкам
  const backward = []; const staged = new Set(); // заказ в двух ЗНП (25) — по первой карточке
  for (const z of Object.keys(ORDERS_OF).sort(byZnp)) {
    const card = cards[z];
    if (!card) { problems.push(`ЗНП ${z}: карточки «Производство» нет — этап не трогаем`); continue; }
    if (!card.stage) problems.push(`ЗНП ${z}: колонка «${card.column}» — этапа в заказе нет, не трогаем`);
    for (const o of orderIdsOf[z]) {
      if (staged.has(o.id)) continue; staged.add(o.id);
      const body = {}; const before = {};
      if (card.stage && !((RANK[o.stage] ?? 0) === RANK[card.stage] && RANK[card.stage] === 3) && o.stage !== card.stage) {
        body.stage = card.stage; before.stage = o.stage;
        if (RANK[card.stage] < RANK[o.stage]) backward.push(`${o.orderNo} (${o.customer}): ${o.stage} → ${card.stage}`);
      }
      if (card.deadline && isoDay(o.shipDate) !== card.deadline) { body.shipDate = card.deadline; before.shipDate = isoDay(o.shipDate); }
      if (Object.keys(body).length) patchOrder(o, body, before, `заказ ${o.orderNo} (${o.customer}) ЗНП ${z}: ${Object.entries(body).map(([k, v]) => `${k} ${before[k] || '—'} → ${v}`).join(', ')}`, 'stage');
    }
  }

  // 4–5. задачи и вопросы
  const asks = [];
  const ask1 = (d, ext, text) => asks.push({ d, ext, text });
  const link = []; const create = []; let already = 0; const noSite = [];
  for (const z of Object.keys(MATCH).sort(byZnp)) {
    for (const row of MATCH[z].rows) {
      const ref = NEW_ZNP.includes(z) ? newLineRefs[z][row.pos] : row.line ? { id: row.line.id } : null;
      const art = clean(row.art);
      let yg = row.tasks.slice();
      if (yg.length > 1 && art) {
        const hit = yg.filter((d) => (YG.find((t) => t.taskId === d)?.title || '').includes(art));
        if (hit.length) { for (const d of yg.filter((d) => !hit.includes(d))) ask1(d, `znp:extra:${d}`, `В заказе на производство ${z} у позиции ${row.pos} артикул ${art} — это задача ${hit.join(', ')}. У этой задачи артикула нет в ЗНП. Она лишняя? Если нужна — скажите, к какой позиции её отнести.`); yg = hit; }
      }
      const d = yg[0];
      if (d && !art) ask1(d, `znp:noart:${z}:${row.pos}`, `В заказе на производство ${z} у позиции ${row.pos} («${clean(row.name)}») нет артикула, а задача сделана по артикулу из названия. Подтвердите артикул и внесите его в ЗНП.`);
      if (!ref) continue;
      const site = d ? taskByYg[d] : null;
      if (d && !site) { noSite.push(`${z}/${row.pos} ${d}`); continue; }
      if (site) {
        if (ref.id && site.incomeId === ref.id) { already++; continue; }
        if (site.incomeId) { problems.push(`${d}: уже привязана к другой позиции — не трогаем`); continue; }
        if (ref.id && (taskOnLine[ref.id] || []).some((t) => t.status !== 'done' && t.id !== site.id)) { problems.push(`${d}: на позиции ${z}/${row.pos} уже есть другая открытая задача`); continue; }
        link.push(`${d} → ${z}/${row.pos}`);
        act('link', `привязать ${d} (${site.code}) к позиции ${z}/${row.pos}`, async () => {
          const incomeId = ref.id || ctx.lines.get(ref.key); await api('PATCH', `/api/design-tasks/${site.id}`, { incomeId });
          return { type: 'task-linked', id: site.id, note: 'была свободной (без позиции); обратно через API снять нельзя' };
        });
      } else if (art) {
        if (ref.id && (taskOnLine[ref.id] || []).length) { already++; continue; }
        const parsed = PARSED[z].rows.find((r) => r[0] === row.pos);
        const img = (IMG[z] || []).find((x) => x.pos === row.pos);
        create.push(`${z}/${row.pos} арт. ${art}`);
        act('task', `новая задача ${z}/${row.pos} арт. ${art} ${clean(row.name).slice(0, 40)}${img ? ' + фото' : ''}`, async () => {
          const incomeId = ref.id || ctx.lines.get(ref.key);
          const t = await api('POST', '/api/design-tasks', { incomeId, note: taskNote(z, parsed) });
          const rb = { type: 'task-created', id: t.id, photoId: null };
          if (img) { const f = path.join(dir, img.file); if (fs.existsSync(f)) { rb.photoId = await uploadPhoto(f); await api('POST', `/api/design-tasks/${t.id}/photos`, { photoId: rb.photoId }); } }
          return rb;
        });
      }
    }
  }
  // D-65 и строки без количества
  ask1('D-65', 'znp:D-65:z21', 'Задача «Навес ДПС, ул. Тургенева» не привязана к заказу. Предлагаем завести для неё заказ на производство 21-26. Верно?');
  for (const z of Object.keys(PARSED)) {
    PARSED[z].rows.forEach((r, i, all) => {
      if (num(r[4]) != null || !clean(r[3])) return;
      const sub = (MATCH[z]?.rows || []).find((m) => m.tasks.length && m.pos.startsWith(r[0] + '.')) || (MATCH[z]?.rows || []).slice().reverse().find((m) => m.tasks.length && Number(m.pos) < Number(r[0])) || (MATCH[z]?.rows || []).find((m) => m.tasks.length);
      if (sub) ask1(sub.tasks[0], `znp:noqty:${z}:${r[0]}`, `В заказе на производство ${z} позиция ${r[0]} «${clean(r[3])}» без количества. Нужна ли для неё задача проектирования? Если да — впишите количество: «Заказы» → заказ ${z} → позиция ${r[0]} → «Кол-во».`);
      else problems.push(`ЗНП ${z} поз ${r[0]} без количества: нет задачи для вопроса`);
    });
  }
  const seenExt = new Set();
  for (const a of asks) {
    if (seenExt.has(a.ext)) continue; seenExt.add(a.ext);
    const site = taskByYg[a.d];
    if (!site) { noSite.push(`вопрос ${a.ext}: ${a.d}`); continue; }
    act('question', `вопрос в ${a.d} (${site.code}): ${a.text.slice(0, 80)}…`, async () => {
      const r = await api('POST', `/api/design-tasks/${site.id}/notes`, { text: a.text, kind: 'question', source: 'coordinator', authorName: 'Координатор', externalId: a.ext });
      return { type: 'note-created', id: r.id, taskId: site.id };
    });
  }

  // ---------- вывод плана ----------
  const by = {}; actions.forEach((a) => { (by[a.kind] ||= []).push(a); });
  const TITLE = { productionNo: '1. № на производство', order: '2. новые заказы', line: '2. позиции новых заказов', stage: '3. этап / отгрузка', link: '4. привязка задач к позициям', task: '4. новые задачи', question: '5. вопросы менеджеру' };
  console.log(`== ${env}: действий ${actions.length}`);
  for (const k of Object.keys(TITLE)) { const l = by[k] || []; console.log(`\n${TITLE[k]}: ${l.length}`); l.slice(0, 4).forEach((a) => console.log('  •', a.label)); if (l.length > 4) console.log(`  … ещё ${l.length - 4}`); }
  console.log(`\nзадач уже на месте: ${already}; без задачи на сайте (D-N не найдена): ${noSite.join(', ') || '—'}`);
  if (backward.length) console.log(`этап «назад» (по YouGile): ${backward.join('; ')}`);
  if (problems.length) console.log('внимание:\n  ' + [...new Set(problems)].join('\n  '));
  console.log(`ответственный за заказ: в заказе поля нет — не переносится`);
  if (!APPLY) return console.log('\nплан — ничего не записано; запись: --apply --out откат.json');

  // ---------- запись ----------
  const done = [];
  const save = () => fs.writeFileSync(OUT, JSON.stringify(done, null, 1));
  try {
    for (const a of actions) { const rb = await a.run(); if (rb) { done.push(rb); save(); } }
  } finally { save(); }
  console.log(`\nзаписано ${done.length}; откат — ${OUT}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
