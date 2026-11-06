/* C027 — заявки → подстатьи расходов (supplyrequests.articleId). Сопоставление по правилам map-articles.rules.json.
 *   MONGO_URI=… [MONGO_DB=…] node scripts/map-articles.js            — только ПЛАН: tools/logs/map-articles-<дата>.md и .csv
 *   … node scripts/map-articles.js --apply [--min=средняя|высокая]   — запись (на проде запускает пользователь после «да»)
 * --apply: бэкап {_id, articleId} в tools/logs/; пишет только заявкам без articleId (filter {_id:{$in}, articleId:{$exists:false}});
 *   подстатьи берёт из коллекции expensearticles (должна быть создана сидом бэкенда); categoryIds подстатей — только добавление.
 * Порядок правил: ручные (manual) → карта категорий → без статьи. Мягко: ничего не удаляется и не перезаписывается. */
const path = require('path');
const fs = require('fs');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const RULES = JSON.parse(fs.readFileSync(path.join(__dirname, 'map-articles.rules.json'), 'utf8'));
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/crew/C027-money-by-articles/articles-seed.json'), 'utf8'));
const LOGS = path.join(__dirname, '../../tools/logs');
const RANK = { 'нет': 0, 'средняя': 1, 'высокая': 2 };

const seedPaths = new Set();
for (const a of SEED) for (const c of a.children) seedPaths.add(`${a.name} / ${c}`);

/** Чистая функция: заявка → { to, rule, conf }. ctx: { categoryName, supplierName } */
function classify(req, ctx) {
  const f = { title: norm(req.title), category: norm(ctx.categoryName), supplier: norm(ctx.supplierName) };
  for (const r of RULES.manual) {
    for (const field of ['title', 'category', 'supplier']) {
      const w = (r[field] || []).find((x) => f[field].includes(norm(x)));
      if (w) return { to: r.to, rule: `${field}: «${w}»`, conf: r.confidence || 'высокая' };
    }
  }
  const cm = Object.entries(RULES.categories || {}).find(([k]) => norm(k) === f.category && f.category);
  if (cm) return { to: cm[1], rule: `категория «${cm[0]}»`, conf: RULES.categoriesConfidence || 'средняя' };
  return { to: null, rule: '', conf: 'нет' };
}

const arg = (k) => { const a = process.argv.find((x) => x.startsWith(k + '=')); return a ? a.slice(k.length + 1) : undefined; };
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const stamp = () => new Date().toISOString().slice(0, 10);

async function buildPlan(db) {
  const [cats, orgs, reqs] = await Promise.all([
    db.collection('categories').find({}, { projection: { name: 1 } }).toArray(),
    db.collection('organizations').find({}, { projection: { name: 1 } }).toArray(),
    db.collection('supplyrequests').find({ deletedAt: null, articleId: { $exists: false } },
      { projection: { title: 1, categoryId: 1, supplierId: 1, lineTotal: 1, priceHint: 1, qty: 1, requestNo: 1, number: 1, num: 1, status: 1 } }).toArray(),
  ]);
  const catName = new Map(cats.map((c) => [String(c._id), c.name]));
  const orgName = new Map(orgs.map((o) => [String(o._id), o.name]));
  const rows = reqs.map((r) => {
    const categoryName = r.categoryId ? catName.get(String(r.categoryId)) || '' : '';
    const supplierName = r.supplierId ? orgName.get(String(r.supplierId)) || '' : '';
    const amount = r.lineTotal ?? (r.priceHint != null ? r.priceHint * (r.qty || 1) : null);
    const m = classify(r, { categoryName, supplierName });
    return { id: String(r._id), no: r.requestNo ?? r.number ?? r.num ?? '', title: r.title || '', categoryName, supplierName, amount, ...m };
  });
  // предложение categoryIds: категория → подстатья (только из правил категорий и совпадений в данных)
  const catSug = new Map(); // path → Set(categoryName)
  for (const [cn, to] of Object.entries(RULES.categories || {})) {
    if (cats.some((c) => norm(c.name) === norm(cn))) (catSug.get(to) || catSug.set(to, new Set()).get(to)).add(cn);
  }
  const badTargets = [...new Set([...RULES.manual.map((r) => r.to), ...Object.values(RULES.categories || {})])].filter((p) => !seedPaths.has(p));
  return { rows, catSug, badTargets, total: reqs.length };
}

function renderPlan(p) {
  const by = (c) => p.rows.filter((r) => r.conf === c).length;
  const sum = (arr) => arr.reduce((s, r) => s + (r.amount || 0), 0);
  const unm = p.rows.filter((r) => !r.to);
  const top = new Map();
  for (const r of unm) { const k = r.categoryName ? `категория «${r.categoryName}»` : `название «${r.title}»`; const o = top.get(k) || { n: 0, s: 0 }; o.n++; o.s += r.amount || 0; top.set(k, o); }
  const topList = [...top.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15);
  const md = [`# Сопоставление заявок со статьями — план (${stamp()})`, '',
    `Заявок без статьи: ${p.total}. Высокая уверенность: ${by('высокая')}, средняя: ${by('средняя')}, не сопоставлено: ${by('нет')}.`,
    `Сумма сопоставленных: ${Math.round(sum(p.rows.filter((r) => r.to)))} ₽; несопоставленных: ${Math.round(sum(unm))} ₽.`, '',
    p.badTargets.length ? `⚠ Правила ссылаются на подстатьи, которых нет в articles-seed.json: ${p.badTargets.join('; ')}` : 'Все цели правил есть в articles-seed.json.', '',
    '## Топ несопоставленных', '', ...(topList.length ? topList.map(([k, o]) => `- ${k} — ${o.n} заявок, ${Math.round(o.s)} ₽`) : ['- нет']), '',
    '## Предложение categoryIds (категория → подстатья)', '', ...(p.catSug.size ? [...p.catSug].map(([t, s]) => `- ${t} ← ${[...s].join(', ')}`) : ['- нет']), '',
    '## Было → станет', '', '| № | Название | Категория | Поставщик | Сумма | → Подстатья | Правило | Уверенность |', '|--|--|--|--|--|--|--|--|',
    ...p.rows.map((r) => `| ${r.no} | ${r.title} | ${r.categoryName} | ${r.supplierName} | ${r.amount ?? ''} | ${r.to || '—'} | ${r.rule} | ${r.conf} |`)];
  const csv = '﻿' + ['№;Название;Категория;Поставщик;Сумма;Подстатья;Правило;Уверенность',
    ...p.rows.map((r) => [r.no, r.title, r.categoryName, r.supplierName, r.amount, r.to, r.rule, r.conf].map(csvCell).join(';'))].join('\n');
  return { md: md.join('\n'), csv };
}

async function applyPlan(db, p, minConf) {
  const subs = await db.collection('expensearticles').find({ deletedAt: null, parentId: { $ne: null } }).toArray();
  const parents = new Map((await db.collection('expensearticles').find({ deletedAt: null, parentId: null }).toArray()).map((a) => [String(a._id), a.name]));
  if (!subs.length) throw new Error('Коллекция expensearticles пуста — сначала запустите бэкенд с сидом статей.');
  const idByPath = new Map(subs.map((s) => [`${parents.get(String(s.parentId))} / ${s.name}`, s._id]));
  const todo = p.rows.filter((r) => r.to && RANK[r.conf] >= RANK[minConf] && idByPath.has(r.to));
  fs.mkdirSync(LOGS, { recursive: true });
  const bak = path.join(LOGS, `map-articles-backup-${stamp()}-${Date.now()}.json`);
  const ObjectId = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo.ObjectId;
  const ids = todo.map((r) => new ObjectId(r.id));
  const before = await db.collection('supplyrequests').find({ _id: { $in: ids } }, { projection: { articleId: 1 } }).toArray();
  fs.writeFileSync(bak, JSON.stringify(before.map((b) => ({ _id: String(b._id), articleId: b.articleId ?? null }))));
  let written = 0;
  const byTarget = new Map();
  for (const r of todo) (byTarget.get(r.to) || byTarget.set(r.to, []).get(r.to)).push(new ObjectId(r.id));
  for (const [to, list] of byTarget) {
    const res = await db.collection('supplyrequests').updateMany({ _id: { $in: list }, articleId: { $exists: false } }, { $set: { articleId: idByPath.get(to) } });
    written += res.modifiedCount;
  }
  const catByName = new Map((await db.collection('categories').find({}, { projection: { name: 1 } }).toArray()).map((c) => [norm(c.name), c._id]));
  let catAdded = 0;
  for (const [to, names] of p.catSug) {
    const sid = idByPath.get(to); const cids = [...names].map((n) => catByName.get(norm(n))).filter(Boolean);
    if (sid && cids.length) { const res = await db.collection('expensearticles').updateOne({ _id: sid }, { $addToSet: { categoryIds: { $each: cids } } }); catAdded += res.modifiedCount; }
  }
  return { written, planned: todo.length, catAdded, backup: bak };
}

module.exports = { classify, buildPlan, renderPlan, applyPlan };

if (require.main === module) (async () => {
  if (!process.env.MONGO_URI) { console.error('Нужен MONGO_URI'); process.exit(2); }
  const c = await MongoClient.connect(process.env.MONGO_URI);
  try {
    const db = c.db(process.env.MONGO_DB || undefined);
    const p = await buildPlan(db);
    if (process.argv.includes('--apply')) {
      const min = arg('--min') || 'высокая';
      if (!(min in RANK)) throw new Error('--min: высокая | средняя');
      const r = await applyPlan(db, p, min);
      console.log(`Записано заявок: ${r.written} из ${r.planned}; подстатей с новыми категориями: ${r.catAdded}; бэкап: ${r.backup}`);
    } else {
      fs.mkdirSync(LOGS, { recursive: true });
      const { md, csv } = renderPlan(p);
      const base = path.join(LOGS, `map-articles-${stamp()}`);
      fs.writeFileSync(base + '.md', md); fs.writeFileSync(base + '.csv', csv);
      console.log(md.split('\n').slice(0, 14).join('\n'));
      console.log(`\nПлан: ${base}.md / .csv (только план, ничего не записано)`);
    }
  } finally { await c.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
