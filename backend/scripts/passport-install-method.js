/* Паспорта (PASSPORT-FLOW-AUDIT, шаг 2): способ установки изделия из текста.
 * Текст `installationMethod` последнего выпущенного паспорта изделия (нет — `products.installation`) → запись справочника
 * «Способ установки» (dict_values, dict passportInstall) → `products.passportDefaults.installationTypeId`. Только если там пусто.
 * Паспорта (в том числе выданные) не меняются.
 *
 *   Правила RULES — по ключевым словам, первое совпадение (порядок важен: «закладных деталей» важнее «бетонирования»).
 *   Название записи справочника совпало с текстом целиком — тоже годится. Не подошло ни одно правило — в списке «не распознано».
 *   Повторный запуск — 0 изменений.
 *
 *   План:     MONGO_URI=… [MONGO_DB=…] node scripts/passport-install-method.js
 *   Записать: … --apply [--out backup.json]   (выгрузка прежнего passportDefaults — для отката; без --out пишется в /tmp)
 */
const path = require('path');
const fs = require('fs');

const norm = (v) => String(v ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
/** Ключевые слова → код способа установки (справочник passportInstall). */
const RULES = [
  ['EMBEDDED', /закладн/],
  ['ANCHORS', /анкер/],
  ['FENCE_POSTS', /по периметру|огражд/],
  ['CONCRETE_POSTS', /бетонир/],
  ['FREESTANDING', /свободно ?стоящ|свободн\S* установк/],
];
const EMPTY = [null, 0, '', []];
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && v._bsontype === undefined;
const filled = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);

/** Запись справочника для текста или null. */
function matchInstall(text, installs) {
  const t = norm(text);
  if (!t) return null;
  const byName = installs.find((i) => norm(i.name) === t);
  if (byName) return byName;
  const rule = RULES.find(([, rx]) => rx.test(t));
  return rule ? installs.find((i) => String(i.code ?? '').toUpperCase() === rule[0]) ?? null : null;
}

const when = (p) => new Date(p.issuedAt || p.date || p.updatedAt || 0).getTime();

/** Чистая функция: план по изделиям, паспортам и справочнику. */
function buildPlan(products, passports, installs) {
  const last = new Map(); // productId → последний выпущенный паспорт с текстом установки
  for (const p of [...passports].filter((x) => x.productId && String(x.installationMethod ?? '').trim()).sort((a, b) => when(b) - when(a))) if (!last.has(String(p.productId))) last.set(String(p.productId), p);
  const plan = { total: products.length, items: [], already: 0, noText: 0, unmatched: [] };
  for (const p of products) {
    if (filled(p.passportDefaults?.installationTypeId)) { plan.already++; continue; }
    const text = String(last.get(String(p._id))?.installationMethod ?? p.installation ?? '').trim();
    if (!text) { plan.noText++; continue; }
    const hit = matchInstall(text, installs);
    if (hit) plan.items.push({ id: String(p._id), sku: p.sku ?? null, name: String(p.name ?? ''), typeId: String(hit._id), typeName: String(hit.name), text, prev: p.passportDefaults ?? null });
    else plan.unmatched.push({ id: String(p._id), sku: p.sku ?? null, name: String(p.name ?? ''), text });
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
    const filter = { _id: cur._id, deletedAt: null, [ok ? 'passportDefaults.installationTypeId' : 'passportDefaults']: { $in: EMPTY } };
    const $set = ok ? { 'passportDefaults.installationTypeId': new ObjectId(it.typeId), updatedAt: new Date() } : { passportDefaults: { installationTypeId: new ObjectId(it.typeId) }, updatedAt: new Date() };
    n += (await col.updateOne(filter, { $set })).modifiedCount;
  }
  return n;
}

function printPlan(plan, log = console.log) {
  log(`Изделий: ${plan.total} · способ уже задан: ${plan.already} · нет текста установки: ${plan.noText}`);
  log(`Получат способ установки: ${plan.items.length} · текст не распознан: ${plan.unmatched.length}`);
  const by = {};
  for (const i of plan.items) by[i.typeName] = (by[i.typeName] ?? 0) + 1;
  for (const [k, v] of Object.entries(by)) log(`  «${k}»: ${v}`);
  for (const i of plan.items.slice(0, 10)) log(`  ${i.sku || i.id} «${i.name.slice(0, 40)}» → «${i.typeName}» ← ${i.text.slice(0, 70)}`);
  if (plan.items.length > 10) log(`  … ещё ${plan.items.length - 10}`);
  const texts = {};
  for (const u of plan.unmatched) texts[u.text] = (texts[u.text] ?? 0) + 1;
  for (const [t, n] of Object.entries(texts).sort((a, b) => b[1] - a[1]).slice(0, 5)) log(`  не распознано (${n}): ${t.slice(0, 90)}`);
}

module.exports = { buildPlan, applyPlan, printPlan, matchInstall };

// require.main нет при запуске через stdin (remote-access/run-script.sh: node -)
if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); let outFile = i > 0 ? process.argv[i + 1] : null;
  if (apply && !outFile) outFile = '/tmp/passport-install-method-' + Date.now() + '.json';
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const [products, passports, installs] = await Promise.all([
      db.collection('products').find({ deletedAt: null }, { projection: { name: 1, sku: 1, installation: 1, passportDefaults: 1 } }).toArray(),
      db.collection('productpassports').find({ deletedAt: null, status: 'issued', productId: { $ne: null } }, { projection: { productId: 1, installationMethod: 1, issuedAt: 1, date: 1, updatedAt: 1 } }).toArray(),
      db.collection('dict_values').find({ dict: 'passportInstall', deletedAt: null }, { projection: { name: 1, code: 1 } }).toArray(),
    ]);
    const plan = buildPlan(products, passports, installs);
    printPlan(plan);
    if (outFile) { fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), backup: plan.items.map((x) => ({ _id: x.id, passportDefaults: x.prev })), plan }, null, 2)); console.log(`\nВыгрузка (для отката) и план: ${outFile}`); }
    if (!apply) { console.log('\nНичего не записано. Записать: --apply'); return; }
    console.log(`\nГотово: изделий обновлено ${await applyPlan(db, plan, { ObjectId })}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
