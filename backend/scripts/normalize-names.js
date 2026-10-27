#!/usr/bin/env node
/**
 * Единое оформление названий (отчёт для анализа/SITE-CHECK-2026-10-28.md, «Правила единого оформления»).
 *   node scripts/normalize-names.js <local|prod>                              - план, ничего не пишет
 *   node scripts/normalize-names.js <local|prod> --apply --out откат.json     - запись (PATCH через API)
 *   --typos  - дополнительно применить словарь опечаток (по умолчанию не применяется: в отчёте «только по да»)
 * Поля: изделия (showcase) name/orderName/fullName; позиции (incomes) title; задачи (design-tasks) title.
 * Задача, чьё название - копия названия позиции (incomeId), получает то же новое название. Заказчиков не трогаем.
 * Спорное (нечётные кавычки, «_» в середине, размер «37м*5м») - отдельно, не пишется.
 * Артикул в хвосте убирается только если равен sku этой записи (у позиции/задачи - sku изделия по productId).
 * Откат: для каждой записи {coll, id, field, old}; PATCH обратно. Повтор безопасен (уже нормальное не меняется).
 */
const fs = require('fs');
const path = require('path');

// ---------- правила (чистые функции) ----------
const spaces = (s) => s.replace(/[ \t ]{2,}/g, ' ').replace(/«\s+/g, '«').replace(/\s+»/g, '»').replace(/\s+([,;])/g, '$1').trim();
/** " по парам -> « »; нечётное число - null (спорное). */
function quotes(s) {
  const n = (s.match(/"/g) || []).length;
  if (!n) return s;
  if (n % 2) return null;
  let open = true;
  return s.replace(/"/g, () => { const r = open ? '«' : '»'; open = !open; return r; });
}
const SIZE = /\d+(?:[.,]\d+)?(?:\s*[*×xх]\s*\d+(?:[.,]\d+)?)+(?:\s*м(?![а-яёa-z.]))?/gi;
/** 6150*2200*2600 / 2400×1200 / 1,5 х 0,58 х 0.85м -> русская «х» без пробелов, запятая, «85 м». */
function sizes(s) {
  return s.replace(SIZE, (m) => m.replace(/\s*[*×xх]\s*/gi, 'х').replace(/(\d)\.(\d)/g, '$1,$2').replace(/\s*м$/i, ' м'));
}
const yo = (s) => s.replace(/([Тт])ренажер/g, '$1ренажёр');
const mm = (s) => s.replace(/(\d)\s*мм\.?(?![а-яёa-z])/gi, '$1 мм');
const mp = (s) => s.replace(/м\.п(?![.\wа-яё])/g, 'м.п.');
const capital = (s) => (s && /^[a-zа-яё]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);
/** Артикул в хвосте (после «_», пробела или в «…») - только если равен sku этой записи. */
function article(s, sku) {
  if (!sku) return s;
  const esc = sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return s.replace(new RegExp(`[\\s_]*[«"]?${esc}[»"]?\\s*$`), '').trim();
}
const TYPOS = [ // из отчёта; применяются только с --typos
  ['жим к к груди', 'жим к груди'], ['внутри раммы', 'внутри рамы'], ['(теплоё свечение)', '(тёплое свечение)'],
  ['плавнойрегулировки', 'плавной регулировки'], ['механизмомнатяжения', 'механизмом натяжения'], ['влагозащитна от дождя', 'влагозащищено'],
];
const typos = (s) => TYPOS.reduce((a, [from, to]) => a.split(from).join(to), s);

const RULES = [
  ['артикул в названии', (s, o) => article(s, o.sku)],
  ['кавычки « »', quotes],
  ['размеры «х»', sizes],
  ['«тренажёр» с ё', yo],
  ['«мм» без точки', mm],
  ['«м.п.» с точкой', mp],
  ['пробелы', spaces],
  ['первая буква заглавная', capital],
];
const dispute = (s) => {
  const d = [];
  if (/_/.test(s)) d.push('«_» в названии');
  if (/\d\s*м\s*[*×x]\s*\d/.test(s)) d.push('размер вида «37м*5м»');
  if ((s.match(/[«»]/g) || []).length % 2) d.push('нечётные « »');
  return d;
};
/** -> {out, hits:[правила], disputed:[причины]}; спорное без других правок не меняется. */
function normalize(s, opts = {}) {
  if (typeof s !== 'string' || !s) return { out: s, hits: [], disputed: [] };
  let cur = s; const hits = [];
  const rules = opts.typos ? [RULES[0], ['опечатки', typos], ...RULES.slice(1)] : RULES;
  for (const [name, fn] of rules) {
    const r = fn(cur, opts);
    if (r === null) return { out: s, hits: [], disputed: ['нечётные " (кавычки без пары)'] };
    if (r !== cur) { hits.push(name); cur = r; }
  }
  return { out: cur, hits, disputed: dispute(cur) };
}
module.exports = { spaces, quotes, sizes, yo, mm, mp, capital, article, typos, normalize, TYPOS };
if (require.main === module) main();

// ---------- CLI ----------
function main() {
  const [env, ...flags] = process.argv.slice(2);
  if (!['local', 'prod'].includes(env)) { console.error('usage: <local|prod> [--typos] [--apply --out откат.json]'); process.exit(2); }
  const APPLY = flags.includes('--apply'), TYPOS_ON = flags.includes('--typos');
  const OUT = flags[flags.indexOf('--out') + 1];
  if (APPLY && (!OUT || OUT.startsWith('--'))) { console.error('--apply требует --out откат.json'); process.exit(2); }
  const BASE = env === 'prod' ? 'https://kppdf-crm.ru/db' : 'http://localhost:3001';

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
  async function all(p) {
    const out = [];
    for (let page = 1; ; page++) { const r = await api('GET', `${p}?limit=200&page=${page}`); out.push(...(r.items || [])); if (out.length >= (r.total ?? 0) || !(r.items || []).length) break; }
    return out;
  }

  (async () => {
    await login();
    const products = await all('/api/showcase');
    const incomes = await all('/api/incomes');
    const tasks = await all('/api/design-tasks');
    console.log(`Прочитано: изделий ${products.length}, позиций ${incomes.length}, задач ${tasks.length}`);
    const skuOf = new Map(products.map((p) => [String(p.id), p.sku]));
    const changes = [], disputed = [];
    const consider = (coll, rec, label, field, sku) => {
      const old = rec[field]; if (!old) return null;
      const r = normalize(old, { sku, typos: TYPOS_ON });
      if (r.disputed.length) disputed.push({ coll, label, field, old, why: r.disputed.join(', ') });
      if (r.out !== old) { const c = { coll, id: rec.id, label, field, old, now: r.out, hits: r.hits }; changes.push(c); return c; }
      return null;
    };
    for (const p of products) for (const f of ['name', 'orderName', 'fullName']) consider('showcase', p, p.sku, f, p.sku);
    const incNew = new Map(), incOld = new Map();
    for (const i of incomes) {
      incOld.set(String(i.id), i.title);
      const c = consider('incomes', i, `${i.orderNo || '?'}/${i.lineNo || '?'}`, 'title', i.productId ? skuOf.get(String(i.productId)) : '');
      if (c) incNew.set(String(i.id), c.now);
    }
    for (const t of tasks) {
      const label = `D-${t.seq}`;
      if (t.incomeId && incNew.has(String(t.incomeId)) && t.title === incOld.get(String(t.incomeId))) {
        changes.push({ coll: 'design-tasks', id: t.id, label, field: 'title', old: t.title, now: incNew.get(String(t.incomeId)), hits: ['вместе с позицией'] });
        continue;
      }
      consider('design-tasks', t, label, 'title', t.productId ? skuOf.get(String(t.productId)) : '');
    }

    const byRule = {};
    changes.forEach((c) => c.hits.forEach((h) => (byRule[h] = byRule[h] || []).push(c)));
    console.log(`\nПЛАН: записей к правке ${changes.length}`);
    for (const [rule, cs] of Object.entries(byRule)) {
      console.log(`\n- ${rule}: ${cs.length}`);
      cs.slice(0, 5).forEach((c) => console.log(`    [${c.coll} ${c.label}.${c.field}] ${c.old}  →  ${c.now}`));
    }
    const names = new Map();
    changes.filter((c) => c.coll === 'showcase' && c.field === 'name').forEach((c) => names.set(c.now, (names.get(c.now) || 0) + 1));
    const dups = [...names].filter(([, n]) => n > 1);
    console.log(`\nСПОРНОЕ (не пишется или остаётся как есть, смотреть глазами): ${disputed.length}`);
    disputed.slice(0, 40).forEach((d) => console.log(`    [${d.coll} ${d.label}.${d.field}] ${d.old}  — ${d.why}`));
    if (dups.length) console.log('Станут одинаковыми названия изделий (решать менеджерам): ' + dups.map(([n, k]) => `«${n}» ×${k}`).join('; '));
    if (!TYPOS_ON) console.log('Опечатки (словарь) не применяются без --typos (в отчёте: «только по да»).');
    if (!APPLY) return console.log('\nплан - ничего не записано; запись: --apply --out откат.json');

    const URL = { showcase: '/api/showcase/', incomes: '/api/incomes/', 'design-tasks': '/api/design-tasks/' };
    const log = [];
    try {
      for (const c of changes) {
        await api('PATCH', URL[c.coll] + c.id, { [c.field]: c.now });
        log.push({ coll: c.coll, id: c.id, field: c.field, old: c.old, now: c.now });
      }
    } finally { fs.writeFileSync(OUT, JSON.stringify(log, null, 1)); }
    console.log(`готово: записей ${log.length}; откат - ${OUT}`);
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
