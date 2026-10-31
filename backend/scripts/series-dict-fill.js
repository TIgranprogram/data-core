/* ИЗ-18 (docs/TASKS.md «Фаза ИЗ»): справочник «Серии изделий» (dict_values, dict 'productSeries') из того, что уже введено в изделиях.
 *
 *   Все различные непустые products.series → в справочник, если там нет (сравнение без регистра, «ё» и лишних пробелов).
 *   Написание — самое частое. Изделия не меняются. Повторный запуск — 0 новых.
 *
 *   План:     MONGO_URI=… [MONGO_DB=…] node scripts/series-dict-fill.js [--out plan.json]
 *   Записать: … --apply --out backup.json   (--out обязателен: _id созданных записей — для отката)
 *   Откат: удалить из dict_values записи с _id из выгрузки.
 */
const path = require('path');
const fs = require('fs');

const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const key = (v) => s(v).toLowerCase().replace(/ё/g, 'е');

/** Чистая функция: какие серии добавить. products — [{ series }], dictNames — названия, уже лежащие в справочнике. */
function buildPlan(products, dictNames) {
  const have = new Set(dictNames.map(key));
  const by = new Map(); // key → Map(написание → сколько)
  for (const p of products) {
    const v = s(p.series); if (!v) continue;
    const sp = by.get(key(v)) ?? new Map(); sp.set(v, (sp.get(v) ?? 0) + 1); by.set(key(v), sp);
  }
  const add = [];
  for (const [k, sp] of by) {
    if (have.has(k)) continue;
    const name = [...sp.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))[0][0];
    add.push({ name, uses: [...sp.values()].reduce((a, b) => a + b, 0) });
  }
  add.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name, 'ru'));
  return { total: products.length, distinct: by.size, add };
}

async function applyPlan(db, plan) {
  const now = new Date(); const ids = [];
  for (const a of plan.add) {
    const r = await db.collection('dict_values').insertOne({ dict: 'productSeries', name: a.name, deletedAt: null, createdAt: now, updatedAt: now });
    ids.push(String(r.insertedId));
  }
  return ids;
}

function printPlan(plan, log = console.log) {
  log(`Изделий: ${plan.total} · различных серий: ${plan.distinct} · добавить в справочник: ${plan.add.length}`);
  for (const a of plan.add.slice(0, 50)) log(`  ${a.name} — изделий: ${a.uses}`);
  if (plan.add.length > 50) log(`  … ещё ${plan.add.length - 50}`);
}

module.exports = { buildPlan, applyPlan, printPlan };

if (require.main === module) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); const outFile = i > 0 ? process.argv[i + 1] : null;
  if (apply && !outFile) throw new Error('Для --apply укажите --out файл.json — выгрузка для отката');
  const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const [products, dict] = await Promise.all([
      db.collection('products').find({ deletedAt: null }, { projection: { series: 1 } }).toArray(),
      db.collection('dict_values').find({ dict: 'productSeries', deletedAt: null }, { projection: { name: 1 } }).toArray(),
    ]);
    const plan = buildPlan(products, dict.map((d) => d.name));
    printPlan(plan);
    if (!apply) {
      if (outFile) { fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), plan }, null, 2)); console.log(`\nПлан: ${outFile}`); }
      console.log('\nНичего не записано. Записать: --apply --out файл.json'); return;
    }
    const ids = await applyPlan(db, plan);
    fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), createdIds: ids, plan }, null, 2));
    console.log(`\nГотово: добавлено ${ids.length}. Выгрузка для отката: ${outFile}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
