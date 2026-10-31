/* ИЗ-9, ИЗ-16 (docs/TASKS.md «Фаза ИЗ»): разовое заполнение пустых полей изделий. Заполненное не трогает.
 *
 *   1. orderName («Название в договоре») пусто → копия name («Короткое название»).
 *   2. photoIds пусто → фото из паспорта этого изделия (productpassports.productId):
 *      самый новый паспорт с картинками; сначала вид «overview», затем по порядку. Те же записи photos — без копирования файлов
 *      (фото не удаляются физически, ссылка из изделия безопасна). Первое фото — главное (mainPhotoId).
 *   Повторный запуск — 0 изменений.
 *
 *   План:     MONGO_URI=… [MONGO_DB=…] node scripts/products-fill-defaults.js [--out plan.json]
 *   Записать: … --apply --out backup.json   (--out обязателен: _id и старые значения — для отката)
 *   Откат: для каждой записи выгрузки `products.updateOne({ _id }, { $set: { orderName, photoIds, mainPhotoId } })` старыми значениями.
 */
const path = require('path');
const fs = require('fs');

const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const KIND_ORDER = ['overview', 'view_3d', 'view_front', 'overview_callouts', 'view_side', 'view_top'];

/** Картинки паспорта по порядку: сначала обзорные виды, затем остальные (кроме деталей комплектности). */
function passportPhotos(p) {
  const imgs = (p.images || []).filter((i) => i && i.photoId && i.kind !== 'bom_item');
  const rank = (k) => { const i = KIND_ORDER.indexOf(k); return i < 0 ? KIND_ORDER.length : i; };
  return imgs.sort((a, b) => rank(a.kind) - rank(b.kind) || (a.order ?? 0) - (b.order ?? 0)).map((i) => String(i.photoId));
}

/** Чистая функция: план по живым изделиям и их паспортам. */
function buildPlan(products, passports) {
  const byProduct = new Map();
  // самый новый паспорт с картинками — первым
  for (const p of [...passports].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))) {
    const k = String(p.productId); const ph = passportPhotos(p);
    if (ph.length && !byProduct.has(k)) byProduct.set(k, { photos: [...new Set(ph)], passportId: String(p._id) });
  }
  const plan = { total: products.length, orderName: [], photos: [], noPhotoAnywhere: 0 };
  for (const p of products) {
    const id = String(p._id);
    if (!s(p.orderName) && s(p.name)) plan.orderName.push({ id, sku: p.sku ?? null, old: p.orderName ?? null, orderName: s(p.name) });
    if (!(p.photoIds || []).length) {
      const f = byProduct.get(id);
      if (f) plan.photos.push({ id, sku: p.sku ?? null, name: s(p.name), oldMain: p.mainPhotoId ?? null, photoIds: f.photos, passportId: f.passportId });
      else plan.noPhotoAnywhere++;
    }
  }
  return plan;
}

async function applyPlan(db, plan, { ObjectId }) {
  let names = 0, photos = 0;
  const now = new Date();
  for (const f of plan.orderName) {
    // условие «пусто» — гонка с ручной правкой ничего не затирает
    const r = await db.collection('products').updateOne({ _id: new ObjectId(f.id), deletedAt: null, $or: [{ orderName: null }, { orderName: '' }, { orderName: { $exists: false } }] }, { $set: { orderName: f.orderName, updatedAt: now } });
    names += r.modifiedCount;
  }
  for (const f of plan.photos) {
    const ids = f.photoIds.map((x) => new ObjectId(x));
    const r = await db.collection('products').updateOne({ _id: new ObjectId(f.id), deletedAt: null, $or: [{ photoIds: { $size: 0 } }, { photoIds: { $exists: false } }, { photoIds: null }] }, { $set: { photoIds: ids, mainPhotoId: ids[0], updatedAt: now } });
    photos += r.modifiedCount;
  }
  return { names, photos };
}

function printPlan(plan, log = console.log) {
  log(`Изделий: ${plan.total}`);
  log(`«Название в договоре» заполнить коротким названием: ${plan.orderName.length}`);
  log(`Фото из паспорта: ${plan.photos.length} · без фото и без паспорта с картинками: ${plan.noPhotoAnywhere}`);
  for (const f of plan.photos.slice(0, 30)) log(`  ${f.sku || f.id} «${f.name.slice(0, 60)}» — фото: ${f.photoIds.length}`);
  if (plan.photos.length > 30) log(`  … ещё ${plan.photos.length - 30}`);
}

module.exports = { buildPlan, applyPlan, printPlan, passportPhotos };

// require.main нет при запуске через stdin (remote-access/run-script.sh: node -)
if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); let outFile = i > 0 ? process.argv[i + 1] : null;
  // --apply без --out (run-script.sh): выгрузка для отката — в /tmp контейнера; полный бэкап базы run-script делает сам
  if (apply && !outFile) outFile = '/tmp/products-fill-defaults-' + Date.now() + '.json';
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const [products, passports] = await Promise.all([
      db.collection('products').find({ deletedAt: null }, { projection: { name: 1, orderName: 1, sku: 1, photoIds: 1, mainPhotoId: 1 } }).toArray(),
      db.collection('productpassports').find({ deletedAt: null, productId: { $ne: null }, 'images.0': { $exists: true } }, { projection: { productId: 1, images: 1, updatedAt: 1 } }).toArray(),
    ]);
    const plan = buildPlan(products, passports);
    printPlan(plan);
    if (outFile) {
      const backup = [...plan.orderName.map((f) => ({ _id: f.id, orderName: f.old })), ...plan.photos.map((f) => ({ _id: f.id, photoIds: [], mainPhotoId: f.oldMain }))];
      fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), backup, plan }, null, 2)); console.log(`\nВыгрузка (для отката) и план: ${outFile}`);
    }
    if (!apply) { console.log('\nНичего не записано. Записать: --apply --out файл.json'); return; }
    const r = await applyPlan(db, plan, { ObjectId });
    console.log(`\nГотово: «Название в договоре» — ${r.names}, фото — ${r.photos}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
