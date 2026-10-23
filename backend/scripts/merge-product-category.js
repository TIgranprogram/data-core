/* Объединить раздел «Продукции» в другой (Т-11: «МАФ» → «Благоустройство», решение пользователя 2026-10-23).
 * categories type product — ОБЩАЯ с CRM kppdf. Перед записью: ссылки CRM на раздел (любое поле любой таблицы, кроме
 * products и самих разделов) — есть → стоп. Логика — category-merge-plan.js (тест рядом). Ничего не стирает: в корзину.
 *
 *   План:      MONGO_URI=… [MONGO_DB=…] node scripts/merge-product-category.js --from "МАФ" --into "Благоустройство"
 *   Записать:  … --apply      (откат — JSON прежних значений в /var/lib/datacore/backups через docker cp, см. HISTORY)
 */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
const { mergePlan } = require('./category-merge-plan.js');

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
const APPLY = process.argv.includes('--apply');
const FROM = arg('--from') || 'МАФ';
const INTO = arg('--into') || 'Благоустройство';

(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URI);
  const db = c.db(process.env.MONGO_DB || undefined);
  const cats = await db.collection('categories').find({ type: 'product' }).toArray();
  const products = await db.collection('products').find({}, { projection: { categoryId: 1, deletedAt: 1, name: 1 } }).toArray();
  const { ops, error, src } = mergePlan({ cats, products, from: FROM, into: INTO });
  if (error) { console.log('СТОП: ' + error); await c.close(); return; }

  // ссылки на раздел и его группы из других таблиц (CRM) — тогда не объединяем
  const ids = [String(src._id), ...cats.filter((k) => String(k.parentId) === String(src._id)).map((k) => String(k._id))];
  const crm = {};
  for (const { name } of await db.listCollections().toArray()) {
    if (name.startsWith('system.') || name === 'products' || name === 'categories') continue;
    for (const d of await db.collection(name).find({}).toArray()) {
      const s = JSON.stringify(d, (k, v) => (v && v._bsontype === 'ObjectId' ? String(v) : v));
      if (ids.some((x) => s.includes(x))) crm[name] = (crm[name] || 0) + 1;
    }
  }
  if (Object.keys(crm).length) { console.log('СТОП: на раздел ссылаются другие таблицы — ' + JSON.stringify(crm)); await c.close(); return; }

  const count = ops.reduce((m, o) => ((m[o.coll] = (m[o.coll] || 0) + 1), m), {});
  console.log(`${APPLY ? 'ЗАПИСЬ' : 'ПЛАН (ничего не пишем)'}: ${ops.length} ${JSON.stringify(count)}; ссылок из других таблиц нет`);
  for (const o of ops.filter((x) => x.coll !== 'products').concat(ops.filter((x) => x.coll === 'products').slice(0, 3))) console.log(' - ' + o.why);
  if (!APPLY || !ops.length) { await c.close(); return; }

  const before = [];
  for (const o of ops) {
    const doc = await db.collection(o.coll).findOne({ _id: o.id });
    before.push({ coll: o.coll, _id: String(o.id), before: Object.fromEntries(Object.keys(o.set).map((k) => [k, doc?.[k] ?? null])) });
  }
  const file = path.join(__dirname, `merge-category-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(before, null, 1));
  console.log('откат — ' + file);
  const now = new Date();
  for (const o of ops) {
    const set = Object.fromEntries(Object.entries(o.set).map(([k, v]) => [k, v === 'NOW' ? now : v]));
    await db.collection(o.coll).updateOne({ _id: o.id }, { $set: { ...set, updatedAt: now } });
  }
  console.log('готово');
  await c.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
