#!/usr/bin/env node
/**
 * КМ7 (узко): старые позиции договоров -> изделия, ТОЛЬКО при точном совпадении названия
 * (решение пользователя 2026-10-29). Прямой доступ к Mongo (метка matchSource='legacy-exact' — для отката).
 *   MONGO_URI=… [MONGO_DB=datacore] node scripts/match-legacy-exact.js <local|prod>                        - план, ничего не пишет
 *   MONGO_URI=… node scripts/match-legacy-exact.js <local|prod> --apply --out копия.json                   - запись
 *   MONGO_URI=… node scripts/match-legacy-exact.js <local|prod> --rollback копия.json                      - откат
 * Берёт incomes: живые, без productId, без matchStatus. Название позиции и поля изделия (name, orderName, fullName)
 * сравниваются целиком после нормализации (регистр, ё/е, пробелы, кавычки). Ровно 1 изделие -> привязка;
 * 0 или 2+ -> не трогается, идёт в список «нужно вручную». Позиции с productId/matchStatus не трогаются.
 * Алиас (productaliases) добавляется только если ключа ещё нет; созданные ключи пишутся в копию и убираются откатом.
 */
const fs = require('fs');
const path = require('path');

// те же правила, что normSearch / shortProductName / aliasKey в src (ключ алиаса совместим с приложением)
const LOOKALIKE = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };
const normSearch = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[×*]/g, 'х')
  .replace(/[abcehkmoptxy]/g, (ch) => LOOKALIKE[ch]).replace(/(\d),(\d)/g, '$1.$2')
  .replace(/[«»"'(),;]+/g, ' ').replace(/\s+/g, ' ').trim();
function shortProductName(title) {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim();
  const cut = t.search(/\s(?:цвет|размеры?|высота|требовани[ея])\s*:|\.\s|;/i);
  let s = (cut > 0 ? t.slice(0, cut) : t).trim().replace(/[,.:;\s]+$/, '');
  if (s.length > 120) { const sp = s.lastIndexOf(' ', 120); s = s.slice(0, sp > 40 ? sp : 120).trim(); }
  return s;
}
const aliasKey = (title) => normSearch(shortProductName(title));

/** Чистый план: lines (incomes) + products -> {matches:[{line,product}], manual:[{line,count}]}. */
function makePlan(lines, products) {
  const index = new Map(); // нормализованное название -> Set(id изделия)
  const byId = new Map();
  for (const p of products) {
    byId.set(String(p._id), p);
    for (const n of [p.name, p.orderName, p.fullName]) {
      const k = normSearch(n);
      if (!k) continue;
      if (!index.has(k)) index.set(k, new Set());
      index.get(k).add(String(p._id));
    }
  }
  const matches = [], manual = [];
  for (const l of lines) {
    if (l.productId || l.matchStatus) continue;
    const k = normSearch(l.title);
    const ids = k ? [...(index.get(k) || [])] : [];
    if (ids.length === 1) matches.push({ line: l, product: byId.get(ids[0]) });
    else manual.push({ line: l, count: ids.length });
  }
  return { matches, manual };
}

const BEFORE = ['productId', 'matchStatus', 'matchedAt', 'matchSource'];

/** Запись: копия -> out, потом incomes и алиасы. db - объект с collection(). */
async function apply(db, matches, out, now = new Date()) {
  const keys = [...new Set(matches.map((m) => aliasKey(m.line.title)).filter(Boolean))];
  const have = new Set((await db.collection('productaliases').find({ key: { $in: keys } }).toArray()).map((a) => a.key));
  const newKeys = keys.filter((k) => !have.has(k));
  const backup = {
    createdAt: now.toISOString(),
    lines: matches.map((m) => ({ _id: String(m.line._id), before: Object.fromEntries(BEFORE.filter((f) => f in m.line).map((f) => [f, m.line[f]])) })),
    createdAliasKeys: newKeys,
  };
  fs.writeFileSync(out, JSON.stringify(backup, null, 1)); // копия - до первой записи
  for (const m of matches) {
    await db.collection('incomes').updateOne({ _id: m.line._id, deletedAt: null, productId: null, matchStatus: null },
      { $set: { productId: m.product._id, matchStatus: 'confirmed', matchedAt: now, matchSource: 'legacy-exact' } });
  }
  const seen = new Set();
  for (const m of matches) {
    const key = aliasKey(m.line.title);
    if (!key || !newKeys.includes(key) || seen.has(key)) continue;
    seen.add(key);
    await db.collection('productaliases').updateOne({ key }, { $setOnInsert: { key, productId: m.product._id, count: 1, lastAt: now, createdAt: now, updatedAt: now } }, { upsert: true });
  }
  return { lines: matches.length, aliases: seen.size };
}

/** Откат по копии. ObjectId берётся из переданного конструктора. */
async function rollback(db, backup, ObjectId) {
  let n = 0;
  for (const l of backup.lines) {
    const set = {}, unset = {};
    for (const f of BEFORE) {
      if (!(f in l.before)) { unset[f] = ''; continue; }
      const v = l.before[f];
      set[f] = f === 'matchedAt' && v ? new Date(v) : (f === 'productId') && typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v) ? new ObjectId(v) : v;
    }
    const upd = {};
    if (Object.keys(set).length) upd.$set = set;
    if (Object.keys(unset).length) upd.$unset = unset;
    await db.collection('incomes').updateOne({ _id: new ObjectId(l._id), matchSource: 'legacy-exact' }, upd);
    n++;
  }
  if (backup.createdAliasKeys.length) await db.collection('productaliases').deleteMany({ key: { $in: backup.createdAliasKeys } });
  return { lines: n, aliases: backup.createdAliasKeys.length };
}

module.exports = { normSearch, aliasKey, makePlan, apply, rollback };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });

async function main() {
  const [env, ...flags] = process.argv.slice(2);
  if (!['local', 'prod'].includes(env)) { console.error('usage: <local|prod> [--apply --out копия.json | --rollback копия.json]'); process.exit(2); }
  const arg = (f) => { const i = flags.indexOf(f); return i < 0 ? undefined : flags[i + 1]; };
  const APPLY = flags.includes('--apply'), OUT = arg('--out'), RB = arg('--rollback');
  if (APPLY && (!OUT || OUT.startsWith('--'))) { console.error('--apply требует --out копия.json'); process.exit(2); }
  if (flags.includes('--rollback') && (!RB || RB.startsWith('--'))) { console.error('--rollback требует файл копии'); process.exit(2); }
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || 'datacore');
    if (RB) {
      const r = await rollback(db, JSON.parse(fs.readFileSync(RB, 'utf8')), ObjectId);
      return console.log(`[${env}] откат: позиций ${r.lines}, алиасов убрано ${r.aliases}`);
    }
    const lines = await db.collection('incomes').find({
      deletedAt: null, $and: [{ $or: [{ productId: null }, { productId: { $exists: false } }] }, { $or: [{ matchStatus: null }, { matchStatus: { $exists: false } }] }],
    }).toArray();
    const products = await db.collection('products').find({ deletedAt: null }, { projection: { name: 1, orderName: 1, fullName: 1 } }).toArray();
    const orders = new Map((await db.collection('salesorders').find({ _id: { $in: [...new Set(lines.map((l) => l.orderId).filter(Boolean))] } }, { projection: { orderNo: 1 } }).toArray()).map((o) => [String(o._id), o.orderNo]));
    const { matches, manual } = makePlan(lines, products);
    console.log(`[${env}] план: договор | позиция | изделие`);
    for (const m of matches) console.log(`  ${orders.get(String(m.line.orderId)) || '?'} | ${m.line.title} | ${m.product.name || m.product.orderName || m.product._id}`);
    console.log(`\nНужно вручную (0 или 2+ совпадений): ${manual.length}`);
    for (const m of manual) console.log(`  ${orders.get(String(m.line.orderId)) || '?'} | ${m.line.title} | совпало изделий: ${m.count}`);
    console.log(`\nИтого: позиций без привязки ${lines.length}; привяжется ${matches.length}; вручную ${manual.length}`);
    if (!APPLY) return console.log('План - ничего не записано. Запуск: --apply --out копия.json');
    const r = await apply(db, matches, OUT);
    console.log(`Готово: позиций ${r.lines}, новых алиасов ${r.aliases}; копия - ${OUT}`);
    console.log(`Откат: MONGO_URI=… node scripts/match-legacy-exact.js ${env} --rollback ${OUT}`);
  } finally { await client.close(); }
}
