/* Паспорта (PRODUCT-FILES, шаг b): рисунки паспортов -> «Фото и файлы» изделия (productphotos, purpose:'passport', kind).
 *
 *   Откуда: images[] паспортов изделия (productpassports.productId). Паспорта идут по порядку: сначала выпущенные, внутри —
 *           от новейшего updatedAt. Для каждого вида (kind) берутся рисунки из первого паспорта, где этот вид есть.
 *   Куда:   productphotos { productId, photoId (тот же, файлы не копируются), purpose:'passport', kind, caption, sortOrder }.
 *   Уже есть в изделии рисунок этого вида (purpose:'passport') — вид пропускается, повторный запуск = 0 записей.
 *   Расхождения (в других паспортах для того же вида другое фото) и пропуски (нет файла в photos, вид bom_item — нужен refCode)
 *   идут в план. Паспорта не меняются, productphotos не удаляется.
 *
 *   План:     MONGO_URI=… [MONGO_DB=…] node scripts/passport-images-to-product.js
 *   Записать: … --apply [--out backup.json]   (бэкап прежних productphotos этих изделий + список добавленных; без --out — в /tmp)
 */
const path = require('path');
const fs = require('fs');

const SKIP_KINDS = new Set(['bom_item']); // у строки комплектности есть refCode, в productphotos его нет
const issued = (p) => (p.status === 'issued' || p.status == null ? 0 : 1); // выпущенные (и старые без статуса) — первыми
const upd = (p) => new Date(p.updatedAt || p.issuedAt || p.date || 0).getTime();

/** Чистая функция: план по паспортам, рисункам изделия и списку существующих файлов. */
function buildPlan(passports, existing, photoIds) {
  const have = new Map(); // productId -> Set(kind) уже в изделии
  for (const e of existing) (have.get(String(e.productId)) ?? have.set(String(e.productId), new Set()).get(String(e.productId))).add(e.kind);
  const by = new Map();
  for (const p of passports.filter((x) => x.productId && (x.images || []).length)) { const k = String(p.productId); (by.get(k) ?? by.set(k, []).get(k)).push(p); }
  const plan = { products: by.size, items: [], conflicts: [], skipped: [], kinds: {} };
  for (const [productId, list] of by) {
    list.sort((a, b) => issued(a) - issued(b) || upd(b) - upd(a));
    const done = new Set(have.get(productId) ?? []);
    const kinds = [...new Set(list.flatMap((p) => p.images.map((i) => i.kind)))];
    for (const kind of kinds) {
      if (!kind) continue;
      if (done.has(kind)) continue; // в изделии уже есть
      if (SKIP_KINDS.has(kind)) { plan.skipped.push({ productId, kind, reason: 'нужен refCode строки комплектности' }); continue; }
      const src = list.find((p) => p.images.some((i) => i.kind === kind));
      const imgs = src.images.filter((i) => i.kind === kind).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const ok = imgs.filter((i) => i.photoId && photoIds.has(String(i.photoId)));
      for (const i of imgs) if (!ok.includes(i)) plan.skipped.push({ productId, kind, photoId: String(i.photoId ?? ''), reason: 'файла нет в photos' });
      const taken = new Set(ok.map((i) => String(i.photoId)));
      const others = new Set(list.filter((p) => p !== src).flatMap((p) => p.images.filter((i) => i.kind === kind && i.photoId).map((i) => String(i.photoId))));
      if ([...others].some((x) => !taken.has(x))) plan.conflicts.push({ productId, kind, taken: [...taken], other: [...others].filter((x) => !taken.has(x)) });
      ok.forEach((i, n) => {
        plan.items.push({ productId, kind, photoId: String(i.photoId), caption: i.caption || undefined, sortOrder: n, passportId: String(src._id) });
        plan.kinds[kind] = (plan.kinds[kind] ?? 0) + 1;
      });
    }
  }
  return plan;
}

async function applyPlan(db, plan, { ObjectId }) {
  const col = db.collection('productphotos');
  const now = new Date();
  let n = 0;
  for (const it of plan.items) {
    const productId = new ObjectId(it.productId);
    // повторная проверка в момент записи: вид уже занят — не дублируем
    if (await col.findOne({ productId, purpose: 'passport', kind: it.kind, deletedAt: null }, { projection: { _id: 1 } }) && it.sortOrder === 0) continue;
    if (await col.findOne({ productId, purpose: 'passport', photoId: new ObjectId(it.photoId), deletedAt: null }, { projection: { _id: 1 } })) continue;
    await col.insertOne({ productId, photoId: new ObjectId(it.photoId), purpose: 'passport', kind: it.kind, ...(it.caption ? { caption: it.caption } : {}), isMain: false, sortOrder: it.sortOrder, deletedAt: null, createdAt: now, updatedAt: now });
    n++;
  }
  return n;
}

function printPlan(plan, log = console.log) {
  log(`Изделий с рисунками в паспортах: ${plan.products} · будет записано рисунков: ${plan.items.length}`);
  for (const [k, v] of Object.entries(plan.kinds).sort((a, b) => b[1] - a[1])) log(`  ${k}: ${v}`);
  log(`Расхождений (в других паспортах другое фото того же вида): ${plan.conflicts.length} (взят рисунок первого паспорта по порядку: выпущенный, новейший)`);
  for (const c of plan.conflicts.slice(0, 10)) log(`  изделие ${c.productId} · ${c.kind}: взято ${c.taken.length} шт, не взято ${c.other.length} шт`);
  if (plan.conflicts.length > 10) log(`  … ещё ${plan.conflicts.length - 10}`);
  log(`Пропущено: ${plan.skipped.length}`);
  for (const s of plan.skipped.slice(0, 10)) log(`  изделие ${s.productId} · ${s.kind}: ${s.reason}`);
  if (plan.skipped.length > 10) log(`  … ещё ${plan.skipped.length - 10}`);
}

module.exports = { buildPlan, applyPlan, printPlan };

// require.main нет при запуске через stdin (remote-access/run-script.sh: node -)
if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); let outFile = i > 0 ? process.argv[i + 1] : null;
  if (apply && !outFile) outFile = '/tmp/passport-images-to-product-' + Date.now() + '.json';
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const passports = await db.collection('productpassports').find({ deletedAt: null, productId: { $ne: null }, 'images.0': { $exists: true } }, { projection: { productId: 1, status: 1, updatedAt: 1, issuedAt: 1, date: 1, images: 1 } }).toArray();
    const productIds = [...new Set(passports.map((p) => String(p.productId)))].map((x) => new ObjectId(x));
    const existing = await db.collection('productphotos').find({ productId: { $in: productIds }, purpose: 'passport', deletedAt: null }, { projection: { productId: 1, kind: 1 } }).toArray();
    const allIds = [...new Set(passports.flatMap((p) => p.images.map((x) => String(x.photoId))))].filter((x) => ObjectId.isValid(x)).map((x) => new ObjectId(x));
    const photoIds = new Set((await db.collection('photos').find({ _id: { $in: allIds } }, { projection: { _id: 1 } }).toArray()).map((x) => String(x._id)));
    const plan = buildPlan(passports, existing, photoIds);
    printPlan(plan);
    if (outFile) {
      const backup = await db.collection('productphotos').find({ productId: { $in: productIds } }).toArray();
      fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), backup, plan }, null, 2));
      console.log(`\nБэкап productphotos этих изделий (${backup.length}) и план: ${outFile}`);
    }
    if (!apply) { console.log('\nНичего не записано. Записать: --apply'); return; }
    console.log(`\nГотово: записано рисунков ${await applyPlan(db, plan, { ObjectId })}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
