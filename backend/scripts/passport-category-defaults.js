/* Паспорта (PASSPORT-FLOW-AUDIT, шаг 3): значения по умолчанию по категории паспорта — только в пустые поля изделия.
 *
 *   Таблица DEFAULTS (решение пользователя 2026-11-01): срок службы 10 лет для всех категорий.
 *   Категория изделия: своя (passportDefaults.passportCategory), иначе группа каталога (categories.passportCategory), иначе её родитель.
 *   Категории нет — изделие пропускается (сначала passport-category-groups). Заполненное не трогаем. Повторный запуск — 0 изменений.
 *
 *   План:     MONGO_URI=… [MONGO_DB=…] node scripts/passport-category-defaults.js
 *   Записать: … --apply [--out backup.json]   (выгрузка прежнего passportDefaults — для отката; без --out — в /tmp)
 */
const path = require('path');
const fs = require('fs');

/** Значения по категории: { код: { поле passportDefaults: значение } }. Менять значения — здесь. */
const DEFAULTS = {
  BLG: { serviceLifeYears: 10 },
  TRN: { serviceLifeYears: 10 },
  WRK: { serviceLifeYears: 10 },
  DSP: { serviceLifeYears: 10 },
  DIO: { serviceLifeYears: 10 },
};
const EMPTY = [null, 0, '', []];
const s = (v) => String(v ?? '').trim();
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && v._bsontype === undefined;
const filled = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);

/** Чистая функция: план по живым изделиям и категориям каталога. */
function buildPlan(products, categories) {
  const cat = new Map(categories.map((c) => [String(c._id), c]));
  const codeOf = (p) => {
    const own = s(p.passportDefaults?.passportCategory);
    if (own) return own === 'MAF' ? 'BLG' : own;
    const g = cat.get(String(p.categoryId ?? ''));
    return s(g?.passportCategory) || s(cat.get(String(g?.parentId ?? ''))?.passportCategory) || null;
  };
  const plan = { total: products.length, items: [], noCategory: 0, fields: {}, unknownCode: 0 };
  for (const p of products) {
    const code = codeOf(p);
    if (!code) { plan.noCategory++; continue; }
    const def = DEFAULTS[code];
    if (!def) { plan.unknownCode++; continue; }
    const set = {};
    for (const [k, v] of Object.entries(def)) if (!filled(p.passportDefaults?.[k]) || p.passportDefaults[k] === 0) set[k] = v;
    if (Object.keys(set).length) {
      plan.items.push({ id: String(p._id), sku: p.sku ?? null, name: String(p.name ?? ''), code, set, prev: p.passportDefaults ?? null });
      for (const k of Object.keys(set)) plan.fields[k] = (plan.fields[k] ?? 0) + 1;
    }
  }
  return plan;
}

async function applyPlan(db, plan, { ObjectId }) {
  let n = 0;
  const col = db.collection('products');
  for (const it of plan.items) {
    const cur = await col.findOne({ _id: new ObjectId(it.id), deletedAt: null }, { projection: { passportDefaults: 1 } });
    if (!cur) continue;
    const ok = isObj(cur.passportDefaults);
    const filter = { _id: cur._id, deletedAt: null, $and: Object.keys(it.set).map((k) => ({ [ok ? `passportDefaults.${k}` : 'passportDefaults']: { $in: EMPTY } })) };
    const $set = ok ? { ...Object.fromEntries(Object.entries(it.set).map(([k, v]) => [`passportDefaults.${k}`, v])), updatedAt: new Date() } : { passportDefaults: it.set, updatedAt: new Date() };
    n += (await col.updateOne(filter, { $set })).modifiedCount;
  }
  return n;
}

function printPlan(plan, log = console.log) {
  log(`Изделий: ${plan.total} · получат значения: ${plan.items.length} · без категории паспорта (пропущены): ${plan.noCategory}${plan.unknownCode ? ` · категория вне таблицы: ${plan.unknownCode}` : ''}`);
  for (const [k, v] of Object.entries(plan.fields)) log(`  ${k}: ${v}`);
  for (const it of plan.items.slice(0, 10)) log(`  ${it.sku || it.id} «${it.name.slice(0, 40)}» (${it.code}) ← ${Object.entries(it.set).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  if (plan.items.length > 10) log(`  … ещё ${plan.items.length - 10}`);
}

module.exports = { buildPlan, applyPlan, printPlan, DEFAULTS };

// require.main нет при запуске через stdin (remote-access/run-script.sh: node -)
if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); let outFile = i > 0 ? process.argv[i + 1] : null;
  if (apply && !outFile) outFile = '/tmp/passport-category-defaults-' + Date.now() + '.json';
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const [products, categories] = await Promise.all([
      db.collection('products').find({ deletedAt: null }, { projection: { name: 1, sku: 1, categoryId: 1, passportDefaults: 1 } }).toArray(),
      db.collection('categories').find({ deletedAt: null }, { projection: { parentId: 1, passportCategory: 1 } }).toArray(),
    ]);
    const plan = buildPlan(products, categories);
    printPlan(plan);
    if (outFile) { fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), backup: plan.items.map((x) => ({ _id: x.id, passportDefaults: x.prev })), plan }, null, 2)); console.log(`\nВыгрузка (для отката) и план: ${outFile}`); }
    if (!apply) { console.log('\nНичего не записано. Записать: --apply'); return; }
    console.log(`\nГотово: изделий обновлено ${await applyPlan(db, plan, { ObjectId })}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
