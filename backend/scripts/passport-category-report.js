/* PASSPORT-CATEGORY: отчёт расхождений (ТОЛЬКО ЧТЕНИЕ, ничего не пишет): изделия, у которых своя
 * `passportDefaults.passportCategory` не совпадает с категорией, унаследованной от группы/раздела
 * (`categories.passportCategory`, запасной путь — `catalogNames` справочника). Список — на просмотр пользователю;
 * решение о сбросе (`$unset passportDefaults.passportCategory`) — только по его «да», отдельным действием.
 *
 *   MONGO_URI=… [MONGO_DB=datacore] node scripts/passport-category-report.js [--out report.json]
 */
const fs = require('fs');
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const key = (v) => clean(v).toLowerCase().replace(/ё/g, 'е');

/** Чистая: что унаследовало бы изделие (код или null) — тот же порядок, что passportCategoryFor. */
function inherited(group, type, cats) {
  if (clean(group?.passportCategory)) return clean(group.passportCategory);
  if (clean(type?.passportCategory)) return clean(type.passportCategory);
  for (const name of [group?.name, type?.name]) {
    if (!clean(name)) continue;
    const c = cats.find((x) => clean(x.catalogNames).split(/[,;\n]/).some((n) => clean(n) && key(n) === key(name)));
    if (c) return clean(c.code);
  }
  return null;
}

function buildReport(products, categories, dictCats) {
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  const items = [];
  for (const p of products) {
    const own = clean(p.passportDefaults?.passportCategory);
    if (!own) continue;
    const c = p.categoryId ? byId.get(String(p.categoryId)) : null;
    const parent = c?.parentId ? byId.get(String(c.parentId)) : null;
    const inh = c ? (parent ? inherited(c, parent, dictCats) : inherited(null, c, dictCats)) : null;
    if (own !== inh) items.push({ id: String(p._id), sku: p.sku ?? '', name: p.name ?? '', group: parent ? c.name : null, type: parent ? parent.name : c?.name ?? null, own, inherited: inh, source: p.source ?? null });
  }
  return { total: items.length, items };
}

async function main() {
  const { MongoClient } = require('mongodb');
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
  const cl = await MongoClient.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/?replicaSet=rs0');
  try {
    const db = cl.db(process.env.MONGO_DB || 'datacore');
    const [products, categories, dictCats] = await Promise.all([
      db.collection('products').find({ deletedAt: null, 'passportDefaults.passportCategory': { $exists: true } }).project({ sku: 1, name: 1, categoryId: 1, passportDefaults: 1, source: 1 }).toArray(),
      db.collection('categories').find({ type: 'product', deletedAt: null }).project({ name: 1, parentId: 1, passportCategory: 1 }).toArray(),
      db.collection('dict_values').find({ dict: 'passportCategories', deletedAt: null }).project({ code: 1, catalogNames: 1 }).toArray(),
    ]);
    const r = buildReport(products, categories, dictCats);
    console.log(`Расхождений: ${r.total}`);
    for (const i of r.items) console.log(`${i.sku}\t${i.name}\tгруппа: ${i.group ?? '-'}\tсвоя: ${i.own}\tунаследована: ${i.inherited ?? 'нет'}\t${i.source ?? ''}`);
    if (out) fs.writeFileSync(out, JSON.stringify(r, null, 2));
  } finally { await cl.close(); }
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { buildReport, inherited };
