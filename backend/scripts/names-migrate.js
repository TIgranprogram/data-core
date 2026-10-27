/* ТИ-8 (docs/roles/tz/NAMES.md §3 «Миграция»): три названия у продукта и покупного.
 *
 * Что делает:
 *   1. products: у кого `name` пусто — берёт `fullName`, иначе `orderName` (Н-2). Нет и их — оставляет (в списках будет sku).
 *      Существующие `name` не меняет.
 *   2. materials: `name` не меняет. В отчёт «кандидаты на сокращение»: name длиннее 80 знаков или совпадает с invoiceName.
 *      Автоматически не режет (решает человек).
 *   3. incomes.title не трогает никогда.
 *   4. Отчёт: сколько изделий, сколько пустых, дублей коротких названий.
 *   Повторный запуск — 0 изменений.
 *
 *   План (ничего не пишет; --dry-run — то же самое):  MONGO_URI=… [MONGO_DB=…] node scripts/names-migrate.js [--dry-run] [--out backup.json]
 *   Записать:  … --apply --out backup.json   (только на копии; на проде — по «да» пользователя. --out обязателен:
 *              выгрузка _id + старого name изменяемых изделий — для отката)
 *   Откат: для каждой записи выгрузки `products.updateOne({ _id }, { $set: { name: <old> } })` (old = null — вернуть пусто).
 */
const path = require('path');
const fs = require('fs');

const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const LONG = 80;

/** Чистая функция: план по живым изделиям и позициям склада. */
function buildPlan(products, materials) {
  const plan = { total: products.length, empty: 0, fill: [], unfilled: [], duplicates: [], longMaterials: [] };
  const seen = new Map();
  for (const p of products) {
    const cur = s(p.name);
    const next = cur || s(p.fullName) || s(p.orderName);
    if (!cur) {
      plan.empty++;
      if (next) plan.fill.push({ id: String(p._id), sku: p.sku ?? null, old: p.name ?? null, name: next });
      else plan.unfilled.push({ id: String(p._id), sku: p.sku ?? null });
    }
    if (next) { const k = next.toLowerCase().replace(/ё/g, 'е'); seen.set(k, [...(seen.get(k) ?? []), p.sku ?? String(p._id)]); }
  }
  for (const [name, skus] of seen) if (skus.length > 1) plan.duplicates.push({ name, count: skus.length, skus });
  for (const m of materials) {
    const name = s(m.name);
    if (name.length > LONG) plan.longMaterials.push({ id: String(m._id), name, reason: 'длиннее ' + LONG });
    else if (name && name === s(m.invoiceName)) plan.longMaterials.push({ id: String(m._id), name, reason: 'совпадает с названием в счёте' });
  }
  return plan;
}

async function applyPlan(db, plan, { ObjectId }) {
  let changed = 0;
  for (const f of plan.fill) {
    // условие «name пусто» — повторный запуск и гонка с ручной правкой ничего не затирают
    const r = await db.collection('products').updateOne({ _id: new ObjectId(f.id), deletedAt: null, $or: [{ name: null }, { name: '' }, { name: { $exists: false } }] }, { $set: { name: f.name, updatedAt: new Date() } });
    changed += r.modifiedCount;
  }
  return changed;
}

function printPlan(plan, log = console.log) {
  log(`Изделий: ${plan.total} · с пустым name: ${plan.empty} · заполнить: ${plan.fill.length} · останутся пустыми (в списках — sku): ${plan.unfilled.length}`);
  log(`Повторов коротких названий: ${plan.duplicates.length}`);
  for (const d of plan.duplicates) log(`  «${d.name}» ×${d.count}: ${d.skus.join(', ')}`);
  log(`Кандидаты на сокращение (позиции склада): ${plan.longMaterials.length}`);
  for (const m of plan.longMaterials.slice(0, 50)) log(`  ${m.id}: «${m.name.slice(0, 90)}» — ${m.reason}`);
}

module.exports = { buildPlan, applyPlan, printPlan };

if (require.main === module) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); const outFile = i > 0 ? process.argv[i + 1] : null;
  if (apply && !outFile) throw new Error('Для --apply укажите --out файл.json — выгрузка для отката');
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН (--dry-run), ничего не меняется'}`);
    const [products, materials] = await Promise.all([
      db.collection('products').find({ deletedAt: null }, { projection: { name: 1, fullName: 1, orderName: 1, sku: 1 } }).toArray(),
      db.collection('materials').find({ deletedAt: null }, { projection: { name: 1, invoiceName: 1 } }).toArray(),
    ]);
    const plan = buildPlan(products, materials);
    printPlan(plan);
    if (outFile) { fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), products: plan.fill.map((f) => ({ _id: f.id, name: f.old })), plan }, null, 2)); console.log(`\nВыгрузка (для отката) и план: ${outFile}`); }
    if (!apply) { console.log('\nНичего не записано. Записать: --apply --out файл.json'); return; }
    console.log(`\nГотово: изменено изделий ${await applyPlan(db, plan, { ObjectId })}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
