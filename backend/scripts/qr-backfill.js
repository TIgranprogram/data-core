/* QR-CODES: выдать коды QR всем позициям склада (S-, материалы со строкой на складе) и изделиям (P-), у кого их ещё нет.
 *
 *   Только добавляет записи в `qrcodes`; материалы и изделия не меняются. Повторный запуск — 0 новых.
 *
 *   План:     MONGO_URI=… [MONGO_DB=…] node scripts/qr-backfill.js [--out plan.json]
 *   Записать: … --apply --out backup.json   (в выгрузке — _id созданных записей для отката)
 *   Откат: удалить из qrcodes записи с _id из выгрузки.
 */
const path = require('path');
const fs = require('fs');
const { randomInt } = require('crypto');

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // как modules/qr/qr-code.ts: без 0 O 1 I L
function makeCode(type, rnd = randomInt) {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[rnd(ALPHABET.length)];
  return `${type}-${s}`;
}

/** Чистая функция: кому нужен код. ids — строки; have — Set «тип:id» уже выданных. */
function buildPlan({ stockIds, productIds, have }) {
  const need = (type, ids) => [...new Set(ids.map(String))].filter((id) => !have.has(`${type}:${id}`));
  const S = need('S', stockIds), P = need('P', productIds);
  return { stock: { total: new Set(stockIds.map(String)).size, add: S }, products: { total: new Set(productIds.map(String)).size, add: P } };
}

/** Записи для вставки; used — коды, которые нельзя повторить. */
function buildDocs(plan, now = new Date(), rnd = randomInt, used = new Set()) {
  const docs = [];
  const make = (type, id) => {
    let code; do { code = makeCode(type, rnd); } while (used.has(code));
    used.add(code); docs.push({ code, entityType: type, entityId: id, createdAt: now, deletedAt: null });
  };
  for (const id of plan.stock.add) make('S', id);
  for (const id of plan.products.add) make('P', id);
  return docs;
}

function printPlan(plan, log = console.log) {
  log(`Позиций склада: ${plan.stock.total} · без кода: ${plan.stock.add.length}`);
  log(`Изделий: ${plan.products.total} · без кода: ${plan.products.add.length}`);
}

module.exports = { makeCode, buildPlan, buildDocs, printPlan };

// require.main нет при запуске через stdin (remote-access/run-script.sh: node -)
if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); let outFile = i > 0 ? process.argv[i + 1] : null;
  if (apply && !outFile) outFile = '/tmp/qr-backfill-' + Date.now() + '.json';
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const onStock = await db.collection('storageitems').distinct('materialId', { deletedAt: null, materialId: { $ne: null } });
    const mats = await db.collection('materials').find({ _id: { $in: onStock }, deletedAt: null }, { projection: { _id: 1 } }).toArray();
    const prods = await db.collection('products').find({ deletedAt: null }, { projection: { _id: 1 } }).toArray();
    const codes = await db.collection('qrcodes').find({}, { projection: { code: 1, entityType: 1, entityId: 1 } }).toArray();
    const have = new Set(codes.map((c) => `${c.entityType}:${c.entityId}`));
    const plan = buildPlan({ stockIds: mats.map((m) => m._id), productIds: prods.map((p) => p._id), have });
    printPlan(plan);
    if (!apply) {
      if (outFile) { fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), plan }, null, 2)); console.log(`\nПлан: ${outFile}`); }
      console.log('\nНичего не записано. Записать: --apply --out файл.json'); return;
    }
    const docs = buildDocs(plan, new Date(), randomInt, new Set(codes.map((c) => c.code))).map((d) => ({ ...d, entityId: new ObjectId(String(d.entityId)) }));
    let ids = [];
    if (docs.length) ids = Object.values((await db.collection('qrcodes').insertMany(docs, { ordered: false })).insertedIds).map(String);
    fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), createdIds: ids }, null, 2));
    console.log(`\nГотово: выдано ${ids.length}. Выгрузка для отката: ${outFile}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
