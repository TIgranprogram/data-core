/* ИЗ-4 (решение пользователя 2026-10-31 «исправь паспорта»): у ВЫДАННЫХ паспортов с изделием категория ≠ категории изделия
 * → поставить категорию изделия. Черновики сервер правит сам при открытии (passport-from-product.ts).
 *   Категория изделия — тем же кодом, что на сервере (dist/src/modules/product-passport/passport-from-product.js; запуск — в контейнере).
 *   Снимок текста (textSnapshot) другой категории сбрасывается — соберётся при печати; снимок с ручной правкой (editedAt) не трогается, паспорт — в отчёт.
 *   У изделия выданные паспорта разных категорий — не трогаю (в отчёт: разобрать вручную).
 *   Запускать после scripts/products-category-from-passports.js. Повторный запуск — 0 изменений. Коллекция общая с CRM: только $set/$unset по одному документу.
 *
 *   План:     node scripts/passports-category-from-product.js            (или remote-access/run-script.sh passports-category-from-product)
 *   Записать: … --apply [--out файл.json]   (без --out — /tmp контейнера; run-script.sh перед записью делает бэкап базы)
 */
const path = require('path');
const fs = require('fs');

// require.main нет при запуске через stdin (remote-access/run-script.sh: node -)
if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); let outFile = i > 0 ? process.argv[i + 1] : null;
  if (apply && !outFile) outFile = '/tmp/passports-category-from-product-' + Date.now() + '.json';
  const base = [process.cwd(), path.join(__dirname, '..')];
  const { productCategories } = require(require.resolve('./dist/src/modules/product-passport/passport-from-product.js', { paths: base }));
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: base })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const pp = await db.collection('productpassports').find({ deletedAt: null, productId: { $ne: null }, status: { $ne: 'draft' } },
      { projection: { productId: 1, passportCategory: 1, name: 1, number: 1, textSnapshot: 1, editedAt: 1 } }).toArray();
    const cats = await productCategories(db, [...new Set(pp.map((p) => String(p.productId)))]);
    // изделие удалено — паспорт не трогаю (категория удалённого изделия не довод)
    const live = new Set((await db.collection('products').find({ _id: { $in: pp.map((p) => p.productId) }, deletedAt: null }, { projection: { _id: 1 } }).toArray()).map((x) => String(x._id)));
    for (const k of [...cats.keys()]) if (!live.has(k)) cats.delete(k);
    const fix = []; const manual = []; const mixed = new Set();
    const kinds = new Map();
    for (const p of pp) if (p.passportCategory) { const k = String(p.productId); (kinds.get(k) || kinds.set(k, new Set()).get(k)).add(p.passportCategory); }
    for (const p of pp) {
      const pc = cats.get(String(p.productId));
      if (kinds.get(String(p.productId))?.size > 1) { if (pc !== p.passportCategory) mixed.add(String(p.name ?? '').slice(0, 60)); continue; }
      if (!pc || !p.passportCategory || pc === p.passportCategory) continue;
      const row = { id: String(p._id), number: p.number ?? null, name: p.name ?? '', old: p.passportCategory, next: pc, snapshot: p.textSnapshot ?? null };
      (p.editedAt ? manual : fix).push(row);
    }
    console.log(`Выданных с изделием: ${pp.length} · категорию исправить: ${fix.length} · с ручной правкой текста (не трогаю): ${manual.length} · у изделия паспорта разных категорий (разобрать вручную): ${mixed.size}`);
    for (const m of mixed) console.log(`  вручную: «${m}»`);
    for (const f of [...fix, ...manual].slice(0, 40)) console.log(`  № ${f.number ?? '—'} «${String(f.name).slice(0, 50)}»: ${f.old} → ${f.next}${manual.includes(f) ? ' (ручной текст — пропуск)' : ''}`);
    if (outFile) { fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), backup: fix.map((f) => ({ _id: f.id, passportCategory: f.old, textSnapshot: f.snapshot })), manual }, null, 2)); console.log(`Выгрузка для отката: ${outFile}`); }
    if (!apply) { console.log('Ничего не записано. Записать: --apply'); return; }
    let n = 0;
    for (const f of fix) {
      const r = await db.collection('productpassports').updateOne({ _id: new ObjectId(f.id), passportCategory: f.old, editedAt: null },
        { $set: { passportCategory: f.next, updatedAt: new Date() }, $unset: { textSnapshot: '' } });
      n += r.modifiedCount;
    }
    console.log(`Готово: исправлено паспортов ${n}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
