/* МЦ-4 (docs/roles/tz/MC.md): первичное заполнение связи «позиция склада → материал паспорта» — `materials.passportSpec`
 * { materialId, sizes?, isCoating? } по названию (тот же разбор, что «Взять из состава»: common/catalog/materials-text.ts).
 *
 * Пишет ТОЛЬКО `passportSpec`, ТОЛЬКО у живых позиций, где поля ещё нет (`passportSpec: {$exists:false}`): ручные связи и
 * тексты не трогает. Позиции, не подошедшие ни к одной записи справочника, пропускаются (в плане — список «не опознано»).
 * Нужен собранный проект (`npx nest build` → dist/).
 *
 *   План (ничего не пишет):  MONGO_URI=… [MONGO_DB=…] node scripts/material-passport-spec-fill.js [--out backup.json]
 *   Записать:                … --apply --out backup.json   (НА ПРОДЕ — только координатор; --out обязателен: выгрузка
 *                             _id позиций, которым пишем связь, и самой связи — для отката)
 *   Откат: для каждого _id из выгрузки `updateOne({_id}, {$unset:{passportSpec:''}})` (до записи поля не было).
 */
const path = require('path');
const fs = require('fs');

/**
 * Чистая функция: что записать. `match(line, recs, sortament)` — `specFromComposition` (подставляется, чтобы тест не тянул dist).
 * materials — живые позиции без passportSpec; recs — живые passportMaterials (с `id`); sortament — passportSortament.
 */
function buildPlan(materials, recs, sortament, match) {
  const plan = { items: [], unmatched: [] };
  for (const m of materials) {
    const text = [m.name, m.assortment, m.materialGrade].map((x) => String(x ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
    const r = match([{ name: String(m.name ?? ''), text }], recs, sortament);
    if (r.coatingIds.length) plan.items.push({ id: String(m._id), name: String(m.name ?? ''), materialId: r.coatingIds[0], sizes: [], isCoating: true });
    else if (r.rows.length) plan.items.push({ id: String(m._id), name: String(m.name ?? ''), materialId: r.rows[0].materialId, sizes: r.rows[0].sizes, isCoating: false });
    else plan.unmatched.push({ id: String(m._id), name: String(m.name ?? '') });
  }
  return plan;
}

async function applyPlan(db, plan, { ObjectId }) {
  const col = db.collection('materials');
  let n = 0;
  for (const it of plan.items) {
    const spec = { materialId: new ObjectId(it.materialId), ...(it.sizes.length ? { sizes: it.sizes } : {}), ...(it.isCoating ? { isCoating: true } : {}) };
    n += (await col.updateOne({ _id: new ObjectId(it.id), deletedAt: null, passportSpec: { $exists: false } }, { $set: { passportSpec: spec } })).modifiedCount;
  }
  return n;
}

function printPlan(plan, log = console.log) {
  log(`Связать: ${plan.items.length} · не опознано (останутся без связи): ${plan.unmatched.length}`);
  for (const it of plan.items) log(`  «${it.name}» → ${it.materialId}${it.isCoating ? ' · покрытие' : ''}${it.sizes.length ? ' · ' + it.sizes.join(', ') : ''}`);
  for (const u of plan.unmatched.slice(0, 50)) log(`  ? «${u.name}»`);
  if (plan.unmatched.length > 50) log(`  … и ещё ${plan.unmatched.length - 50}`);
}

module.exports = { buildPlan, applyPlan, printPlan };

if (require.main === module) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); const outFile = i > 0 ? process.argv[i + 1] : null;
  if (apply && !outFile) throw new Error('Для --apply укажите --out файл.json — выгрузка для отката');
  const root = path.join(__dirname, '..');
  const { specFromComposition } = require(path.join(root, 'dist/src/common/catalog/materials-text'));
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), root] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const dv = db.collection('dict_values');
    const [materials, recs, sortament] = await Promise.all([
      db.collection('materials').find({ deletedAt: null, passportSpec: { $exists: false } }, { projection: { name: 1, assortment: 1, materialGrade: 1 } }).toArray(),
      dv.find({ dict: 'passportMaterials', deletedAt: null }).toArray(),
      dv.find({ dict: 'passportSortament', deletedAt: null }, { projection: { name: 1, material: 1 } }).toArray(),
    ]);
    const plan = buildPlan(materials, recs.map((x) => ({ ...x, id: String(x._id) })), sortament, specFromComposition);
    printPlan(plan);
    if (outFile) { fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), plan }, null, 2)); console.log(`\nВыгрузка (для отката) и план: ${outFile}`); }
    if (!apply) { console.log('\nНичего не записано. Записать: --apply --out файл.json'); return; }
    console.log(`\nГотово: записано ${await applyPlan(db, plan, { ObjectId })}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
