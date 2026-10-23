/* Справочники металла (SPR-1): «Сортамент / сечение» (metalAssortments) и «Марки стали» (steelGrades) из позиций склада.
 * Берёт уникальные непустые materials.assortment / materials.materialGrade (без учёта регистра и пробелов, ё = е;
 * из вариантов написания — самое частое), добавляет в dict_values недостающие. Существующие записи и materials не трогает.
 * НА ПРОДЕ — запускает координатор.
 *
 *   План (ничего не меняет):  MONGO_URI=… [MONGO_DB=…] node scripts/seed-metal-dicts.js
 *   Записать:                 … --apply
 */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

const DICTS = [['metalAssortments', 'assortment'], ['steelGrades', 'materialGrade']];
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
// ключ сравнения: регистр и ё не различаем, повторные пробелы схлопнуты
const key = (v) => clean(v).toLowerCase().replace(/ё/g, 'е');

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const client = await MongoClient.connect(uri);
  const db = client.db(process.env.MONGO_DB || undefined);
  const apply = process.argv.includes('--apply');
  console.log(`База ${db.databaseName}${apply ? '' : ' (план)'}`);
  for (const [dict, field] of DICTS) {
    // написание → сколько позиций
    const rows = await db.collection('materials').aggregate([
      { $match: { deletedAt: null, [field]: { $type: 'string', $nin: ['', null] } } },
      { $group: { _id: `$${field}`, n: { $sum: 1 } } },
    ]).toArray();
    const groups = new Map(); // ключ → { total, best, bestN }
    for (const r of rows) {
      const name = clean(r._id); if (!name) continue;
      const k = key(name), g = groups.get(k) || { total: 0, best: name, bestN: 0 };
      g.total += r.n;
      if (r.n > g.bestN) { g.best = name; g.bestN = r.n; }
      groups.set(k, g);
    }
    const c = db.collection('dict_values');
    const have = new Set((await c.find({ dict, deletedAt: null }, { projection: { name: 1 } }).toArray()).map((d) => key(d.name)));
    const add = [...groups.entries()].filter(([k]) => !have.has(k)).map(([, g]) => g).sort((a, b) => b.total - a.total || a.best.localeCompare(b.best, 'ru'));
    console.log(`\n${dict} (materials.${field}): в данных ${groups.size}, в справочнике ${have.size}, добавить ${add.length}`);
    for (const g of add.slice(0, 200)) console.log(`  ${g.best}  (${g.total})`);
    if (add.length > 200) console.log(`  … и ещё ${add.length - 200}`);
    if (apply && add.length) {
      const now = new Date();
      const r = await c.insertMany(add.map((g) => ({ dict, name: g.best, deletedAt: null, createdAt: now, updatedAt: now })));
      console.log(`Добавлено: ${r.insertedCount}`);
    }
  }
  if (!apply) console.log('\nНичего не записано (план). Записать: --apply');
  await client.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
