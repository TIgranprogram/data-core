/* ИЗ-4 (решение пользователя 2026-10-31 «грамотно исправь»): категория изделия и его выданных паспортов расходятся.
 * Причина — ошибочная ручная категория изделия (passportDefaults.passportCategory). Правило по каждому изделию:
 *   П = категория его выданных паспортов (только если у всех выданных одна), Г = категория по группе изделия, С = своя ручная.
 *   Выданные документы главнее (проверка на копии 2026-10-31: урна, стела, ограждения, воркаут лежат в группе «Тренажеры»,
 *   поэтому Г у них неверна, а паспорта верны):
 *   1. П = Г          → снять ручную С: изделие берёт категорию группы (= паспорта).
 *   2. П ≠ Г          → изделию С = П; изделие — в отчёт «не в своей группе» (перенести в группу — менеджеру).
 *   3. PRODUCT_WINS   → права категория изделия (решение пользователя): изделию С = указанной, паспорт правит
 *                       scripts/passports-category-from-product.js (запускать вторым).
 *   Паспорта разных категорий у одного изделия — в отчёт, не трогаю.
 * Запуск в контейнере (код категории — dist/src/modules/product-passport/passport-from-product.js). Повторный запуск — 0.
 *
 *   План:     remote-access/run-script.sh products-category-from-passports
 *   Записать: … --apply   (run-script.sh перед записью делает бэкап базы; выгрузка для отката — /tmp контейнера или --out)
 *   Затем:    remote-access/run-script.sh passports-category-from-product [--apply] — паспорта по случаю 2.
 */
const path = require('path');

/** Артикул → категория, где право изделие, а не паспорт. 3103 «Пергола Г-образная» — благоустройство, паспорт выдан как воркаут. */
const PRODUCT_WINS = { 3103: 'BLG' };
const fs = require('fs');

// require.main нет при запуске через stdin (remote-access/run-script.sh: node -)
if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); let outFile = i > 0 ? process.argv[i + 1] : null;
  if (apply && !outFile) outFile = '/tmp/products-category-from-passports-' + Date.now() + '.json';
  const base = [process.cwd(), path.join(__dirname, '..')];
  const { productPassportCode } = require(require.resolve('./dist/src/modules/product-passport/passport-from-product.js', { paths: base }));
  const { MongoClient } = require(require.resolve('mongoose', { paths: base })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const pp = await db.collection('productpassports').find({ deletedAt: null, productId: { $ne: null }, status: { $ne: 'draft' }, passportCategory: { $nin: [null, ''] } },
      { projection: { productId: 1, passportCategory: 1 } }).toArray();
    const byProd = new Map();
    for (const p of pp) { const k = String(p.productId); (byProd.get(k) || byProd.set(k, new Set()).get(k)).add(p.passportCategory); }
    const prods = await db.collection('products').find({ _id: { $in: pp.map((p) => p.productId) }, deletedAt: null }, { projection: { name: 1, sku: 1, categoryId: 1, passportDefaults: 1 } }).toArray();
    const unset = [], setOwn = [], productRight = [], mixed = [], wrongGroup = [];
    for (const pr of prods) {
      const cats = byProd.get(String(pr._id)); if (!cats) continue;
      const own = String(pr.passportDefaults?.passportCategory ?? '').trim();
      const cur = await productPassportCode(db, pr);
      if (cats.size > 1) { if ([...cats].some((c) => c !== cur)) mixed.push({ name: pr.name, cats: [...cats], cur }); continue; }
      const P = [...cats][0];
      const G = await productPassportCode(db, { ...pr, passportDefaults: { ...(pr.passportDefaults || {}), passportCategory: '' } });
      const row = { id: String(pr._id), sku: pr.sku ?? null, name: String(pr.name ?? ''), own: own || null, group: G, passports: P };
      const keep = PRODUCT_WINS[String(pr.sku ?? '')];
      if (keep) { if (cur !== keep) setOwn.push({ ...row, passports: keep }); if (P !== keep) productRight.push({ ...row, passports: keep }); continue; }
      if (G && P !== G) wrongGroup.push(row);
      if (P === cur) continue;
      if (P === G && own) unset.push(row); else setOwn.push(row);
    }
    const line = (r) => `  ${r.sku || '—'} «${r.name.slice(0, 50)}»: своя ${r.own ?? '—'} · по группе ${r.group ?? '—'} · в паспортах ${r.passports}`;
    console.log(`Изделий с выданными паспортами: ${byProd.size}`);
    console.log(`1. Снять ошибочную ручную категорию (паспорта = группа): ${unset.length}`); unset.forEach((r) => console.log(line(r)));
    console.log(`2. Поставить изделию категорию паспортов: ${setOwn.length}`); setOwn.forEach((r) => console.log(line(r)));
    console.log(`3. Право изделие — паспорта исправит второй скрипт: ${productRight.length}`); productRight.forEach((r) => console.log(line(r)));
    console.log(`Изделие не в своей группе (категория группы ≠ паспортов) — перенести в нужную группу: ${wrongGroup.length}`); wrongGroup.forEach((r) => console.log(line(r)));
    if (mixed.length) { console.log(`Паспорта разных категорий у одного изделия (не трогаю): ${mixed.length}`); mixed.slice(0, 20).forEach((m) => console.log(`  «${String(m.name).slice(0, 50)}»: ${m.cats.join(', ')} · у изделия ${m.cur}`)); }
    if (outFile) { fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), backup: [...unset, ...setOwn].map((r) => ({ _id: r.id, 'passportDefaults.passportCategory': r.own })), unset, setOwn, productRight, wrongGroup, mixed }, null, 2)); console.log(`Выгрузка для отката: ${outFile}`); }
    if (!apply) { console.log('Ничего не записано. Записать: --apply'); return; }
    const { ObjectId } = require(require.resolve('mongoose', { paths: base })).mongo;
    let n = 0; const now = new Date();
    for (const r of unset) n += (await db.collection('products').updateOne({ _id: new ObjectId(r.id), 'passportDefaults.passportCategory': r.own }, { $unset: { 'passportDefaults.passportCategory': '' }, $set: { updatedAt: now } })).modifiedCount;
    for (const r of setOwn) n += (await db.collection('products').updateOne({ _id: new ObjectId(r.id) }, { $set: { 'passportDefaults.passportCategory': r.passports, updatedAt: now } })).modifiedCount;
    console.log(`Готово: изменено изделий ${n}. Дальше: passports-category-from-product — паспорта по п. 3.`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
