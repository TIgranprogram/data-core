/* Паспорта (PASSPORT-FLOW-AUDIT, шаг 1): перенос полей из выпущенных паспортов в карточку изделия — только в пустые поля.
 *
 *   Откуда: выпущенные паспорта изделия (productpassports.productId), от нового к старому. Поле берётся из самого нового паспорта,
 *   где оно заполнено. Расходятся значения в паспортах одного изделия — берём новейшее, расхождение идёт в список плана.
 *   Куда:   products.dimensions.{length,width,height} · products.weightKg ·
 *           products.passportDefaults.{ageFrom, ageTo, heightMin, heightMax, weightMax, maxUsers, fallHeight, siteLength, siteWidth,
 *           serviceLifeYears, warrantyMonths, isKit, elements, materialIds, installationTypeId}.
 *   Заполненное в изделии не меняется. Паспорта не меняются. Повторный запуск — 0 изменений.
 *
 *   План:     MONGO_URI=… [MONGO_DB=…] node scripts/passport-fields-to-product.js
 *   Записать: … --apply [--out backup.json]   (выгрузка прежних dimensions / weightKg / passportDefaults — для отката; без --out — в /tmp)
 */
const path = require('path');
const fs = require('fs');

const NUMS = ['ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth', 'serviceLifeYears', 'warrantyMonths'];
const DIMS = ['length', 'width', 'height'];
const LISTS = ['elements', 'materialIds'];
const OID_KEYS = new Set([...LISTS, 'installationTypeId']);
const EMPTY = [null, 0, '', []];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && v._bsontype === undefined;
const filled = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
const pos = (v) => (Number(v) > 0 ? Number(v) : null);
const when = (p) => new Date(p.issuedAt || p.date || p.updatedAt || 0).getTime();
const str = (v) => (Array.isArray(v) ? v.map(String) : String(v));

/** Значения паспорта в виде { путь в изделии: значение } (только заполненные, числа — положительные). */
function passportValues(p) {
  const out = {};
  for (const k of DIMS) if (pos(p[k])) out[`dimensions.${k}`] = pos(p[k]);
  if (pos(p.weight)) out.weightKg = pos(p.weight);
  for (const k of NUMS) if (pos(p[k])) out[`passportDefaults.${k}`] = pos(p[k]);
  if (typeof p.isKit === 'boolean') out['passportDefaults.isKit'] = p.isKit;
  for (const k of LISTS) if (filled(p[k])) out[`passportDefaults.${k}`] = str(p[k]);
  if (filled(p.installationTypeId)) out['passportDefaults.installationTypeId'] = str(p.installationTypeId);
  return out;
}

/** Что в изделии уже заполнено, по тому же пути. */
function productHas(prod, key) {
  const [root, sub] = key.split('.');
  const v = sub ? prod[root]?.[sub] : prod[root];
  return filled(v) && v !== 0;
}

/** Чистая функция: план по живым изделиям и выпущенным паспортам. */
function buildPlan(products, passports) {
  const by = new Map();
  for (const p of [...passports].filter((x) => x.productId).sort((a, b) => when(b) - when(a))) { const k = String(p.productId); (by.get(k) ?? by.set(k, []).get(k)).push(p); }
  const plan = { total: products.length, withPassports: 0, items: [], conflicts: [], fields: {} };
  for (const prod of products) {
    const list = by.get(String(prod._id));
    if (!list) continue;
    plan.withPassports++;
    const vals = list.map(passportValues);
    const set = {};
    for (const key of new Set(vals.flatMap((v) => Object.keys(v)))) {
      const have = vals.filter((v) => key in v).map((v) => v[key]);
      if (new Set(have.map((x) => JSON.stringify(x))).size > 1) plan.conflicts.push({ id: String(prod._id), sku: prod.sku ?? null, field: key, values: [...new Set(have.map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x)), taken: have[0] });
      if (!productHas(prod, key)) set[key] = have[0]; // have[0] — из самого нового паспорта, где поле заполнено
    }
    if (Object.keys(set).length) {
      plan.items.push({ id: String(prod._id), sku: prod.sku ?? null, name: String(prod.name ?? ''), set, prev: { dimensions: prod.dimensions ?? null, weightKg: prod.weightKg ?? null, passportDefaults: prod.passportDefaults ?? null } });
      for (const k of Object.keys(set)) plan.fields[k] = (plan.fields[k] ?? 0) + 1;
    }
  }
  return plan;
}

const toDb = (key, v, ObjectId) => (OID_KEYS.has(key.split('.')[1]) ? (Array.isArray(v) ? v.map((x) => new ObjectId(x)) : new ObjectId(v)) : v);

async function applyPlan(db, plan, { ObjectId }) {
  let n = 0;
  const col = db.collection('products');
  for (const it of plan.items) {
    const cur = await col.findOne({ _id: new ObjectId(it.id), deletedAt: null }, { projection: { dimensions: 1, passportDefaults: 1, weightKg: 1 } });
    if (!cur) continue;
    const $set = { updatedAt: new Date() }; const cond = []; const bag = {};
    for (const [key, v] of Object.entries(it.set)) {
      const [root, sub] = key.split('.');
      const val = toDb(key, v, ObjectId);
      if (!sub) { $set[root] = val; cond.push({ [root]: { $in: EMPTY } }); }
      else if (isObj(cur[root])) { $set[key] = val; cond.push({ [key]: { $in: EMPTY } }); }
      else (bag[root] ??= {})[sub] = val; // родителя нет — создаём целиком
    }
    for (const [root, o] of Object.entries(bag)) { $set[root] = o; cond.push({ [root]: { $in: [null] } }); }
    if (!cond.length) continue;
    n += (await col.updateOne({ _id: cur._id, deletedAt: null, $and: cond }, { $set })).modifiedCount;
  }
  return n;
}

function printPlan(plan, log = console.log) {
  log(`Изделий: ${plan.total} · с выпущенными паспортами: ${plan.withPassports} · получат поля: ${plan.items.length}`);
  for (const [k, v] of Object.entries(plan.fields).sort((a, b) => b[1] - a[1])) log(`  ${k}: ${v}`);
  for (const it of plan.items.slice(0, 10)) log(`  ${it.sku || it.id} «${it.name.slice(0, 40)}» ← ${Object.entries(it.set).map(([k, v]) => `${k.replace('passportDefaults.', '')}=${Array.isArray(v) ? v.length + ' шт' : v}`).join(', ').slice(0, 110)}`);
  if (plan.items.length > 10) log(`  … ещё ${plan.items.length - 10}`);
  log(`Расхождений между паспортами одного изделия: ${plan.conflicts.length} (взято значение новейшего паспорта)`);
  for (const c of plan.conflicts.slice(0, 10)) log(`  ${c.sku || c.id} · ${c.field}: ${c.values.map((x) => JSON.stringify(x)).join(' / ')} → взято ${JSON.stringify(c.taken)}`);
  if (plan.conflicts.length > 10) log(`  … ещё ${plan.conflicts.length - 10}`);
}

module.exports = { buildPlan, applyPlan, printPlan, passportValues };

// require.main нет при запуске через stdin (remote-access/run-script.sh: node -)
if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); let outFile = i > 0 ? process.argv[i + 1] : null;
  if (apply && !outFile) outFile = '/tmp/passport-fields-to-product-' + Date.now() + '.json';
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..', '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const [products, passports] = await Promise.all([
      db.collection('products').find({ deletedAt: null }, { projection: { name: 1, sku: 1, dimensions: 1, weightKg: 1, passportDefaults: 1 } }).toArray(),
      db.collection('productpassports').find({ deletedAt: null, status: 'issued', productId: { $ne: null } }, { projection: { productId: 1, issuedAt: 1, date: 1, updatedAt: 1, weight: 1, length: 1, width: 1, height: 1, isKit: 1, elements: 1, materialIds: 1, installationTypeId: 1, ...Object.fromEntries(NUMS.map((k) => [k, 1])) } }).toArray(),
    ]);
    const plan = buildPlan(products, passports);
    printPlan(plan);
    if (outFile) { fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), backup: plan.items.map((x) => ({ _id: x.id, ...x.prev })), plan }, null, 2)); console.log(`\nВыгрузка (для отката) и план: ${outFile}`); }
    if (!apply) { console.log('\nНичего не записано. Записать: --apply'); return; }
    console.log(`\nГотово: изделий обновлено ${await applyPlan(db, plan, { ObjectId })}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
