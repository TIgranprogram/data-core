/* Единый источник (CANON §5): заявке без materialId — ссылка на позицию склада, если название совпало ровно с одной позицией.
 * Ноль или несколько совпадений — не трогает, только список для ручной привязки. Заявки отмечать не нужно: сравнение без учёта регистра, ё и лишних пробелов.
 *   План:     bash remote-access/run-script.sh link-requests-materials
 *   Записать: bash remote-access/run-script.sh link-requests-materials --apply
 */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

(async () => {
  const apply = process.argv.includes('--apply');
  const cl = await MongoClient.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/?replicaSet=rs0');
  try {
    const db = cl.db(process.env.MONGO_DB || 'datacore');
    const mats = await db.collection('materials').find({ deletedAt: null }, { projection: { name: 1, invoiceName: 1 } }).toArray();
    const byName = new Map();
    for (const m of mats) for (const n of new Set([norm(m.name), norm(m.invoiceName)])) if (n) byName.set(n, [...(byName.get(n) || []), m]);
    const reqs = db.collection('supplyrequests');
    const list = await reqs.find({ deletedAt: null, $or: [{ materialId: null }, { materialId: { $exists: false } }] }, { projection: { num: 1, title: 1, status: 1 } }).toArray();
    const sure = [], none = [], many = [];
    for (const r of list) {
      const found = byName.get(norm(r.title)) || [];
      const ids = new Set(found.map((m) => String(m._id)));
      if (ids.size === 1) sure.push({ r, m: found[0] }); else (ids.size ? many : none).push(r);
    }
    console.log(`${apply ? '== ЗАПИСЬ ==' : '== ПЛАН (ничего не пишем) =='} заявок без ссылки: ${list.length}; привязать: ${sure.length}; нет позиции: ${none.length}; несколько позиций: ${many.length}`);
    for (const { r, m } of sure.slice(0, 40)) console.log(`  №${r.num} «${r.title}» → ${m.name}`);
    if (sure.length > 40) console.log(`  … и ещё ${sure.length - 40}`);
    if (many.length) console.log(`Несколько позиций, вручную: ${many.map((r) => '№' + r.num).join(', ')}`);
    if (none.length) console.log(`Нет позиции (заявка на то, чего нет на складе): ${none.slice(0, 40).map((r) => '№' + r.num).join(', ')}${none.length > 40 ? ' …' : ''}`);
    if (apply) {
      let done = 0;
      for (const { r, m } of sure) done += (await reqs.updateOne({ _id: r._id, $or: [{ materialId: null }, { materialId: { $exists: false } }] }, { $set: { materialId: m._id } })).modifiedCount;
      console.log(`Записано: ${done}`);
    } else console.log('Для записи добавьте --apply');
  } finally {
    await cl.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
