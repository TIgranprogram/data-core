/* Паспорта (PRODUCT-FILES «Без дублей»): категория паспорта пишется СРАЗУ в изделия — `products.passportDefaults.passportCategory`,
 * только если пусто. Поле у групп каталога не пишется (и не удаляется).
 *
 *   Источник по порядку: название изделия (RULES) → название его группы → уже заданная `categories.passportCategory` группы/раздела
 *   (подсказка существующей цепочки passportCategoryFor) → название раздела. Нет совпадения — в списке «не определено».
 *   Повторный запуск — 0 изменений.
 *
 *   План:     MONGO_URI=… [MONGO_DB=…] node scripts/passport-category-groups.js
 *   Записать: … --apply [--out backup.json]   (выгрузка прежних значений — для отката; без --out пишется в /tmp)
 *   Откат: `products.updateOne({ _id }, { $unset: { 'passportDefaults.passportCategory': '' } })` для записей выгрузки.
 */
const path = require('path');
const fs = require('fs');

const norm = (v) => String(v ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Правила названия → код категории паспорта (порядок важен: первое совпадение). Те же слова, что categoryByName в pwa, плюс слова групп. */
const RULES = [
  ['DSP', /детск\S* спорт/],
  ['DIO', /качел|карусел|горк|песочн|игров|домик|балансир|качалк|геопласт|детск|бизиборд|муравейник|тоннел|лабиринт|пространственн\S* сет/],
  ['TRN', /тренаж/],
  ['WRK', /воркаут|workout|турник|брусь|рукоход|шведск|полоса препятств|препятств|баскет|волейб|футбол|ворот|боксер|ринг|помост/],
  ['BLG', /скам(ья|ьи|ейк)|урн|навес|пергол|беседк|вазон|цветоч|огражд|оградит|стенд|указател|информацион|стел|(^|\s)стол|диван|лавк|велопарк|фонар|флагшток|трибун|благоустр|клумб/],
];
const codeByName = (name) => { const n = norm(name); return RULES.find(([, rx]) => rx.test(n))?.[0] || null; };

/** Чистая функция: план по живым категориям и изделиям. */
function buildPlan(categories, products) {
  const cat = new Map(categories.map((c) => [String(c._id), c]));
  const plan = { products: [], unresolved: [], alreadySet: 0, total: products.length, byCode: {} };
  for (const p of products) {
    if (s(p.passportDefaults?.passportCategory)) { plan.alreadySet++; continue; }
    const g = cat.get(String(p.categoryId ?? ''));
    const sec = g?.parentId ? cat.get(String(g.parentId)) : null;
    const hit = [
      [codeByName(p.name), 'название изделия'],
      [g && codeByName(g.name), 'название группы'],
      [s(g?.passportCategory), 'категория группы'],
      [s((sec ?? g)?.passportCategory), 'категория раздела'],
      [sec && codeByName(sec.name), 'название раздела'],
    ].find(([c]) => c);
    if (hit) { plan.products.push({ id: String(p._id), name: s(p.name), code: hit[0], via: hit[1] }); plan.byCode[hit[0]] = (plan.byCode[hit[0]] ?? 0) + 1; }
    else plan.unresolved.push({ id: String(p._id), name: s(p.name), group: s(g?.name) });
  }
  return plan;
}

async function applyPlan(db, plan, { ObjectId }) {
  let n = 0;
  for (const g of plan.products) {
    // условие «пусто» — ручная правка в гонке не затирается
    const r = await db.collection('products').updateOne({ _id: new ObjectId(g.id), deletedAt: null, $or: [{ 'passportDefaults.passportCategory': null }, { 'passportDefaults.passportCategory': '' }, { 'passportDefaults.passportCategory': { $exists: false } }] }, { $set: { 'passportDefaults.passportCategory': g.code, updatedAt: new Date() } });
    n += r.modifiedCount;
  }
  return n;
}

function printPlan(plan, log = console.log) {
  log(`Изделий: ${plan.total} · уже с категорией: ${plan.alreadySet} · получат категорию: ${plan.products.length} · не определено: ${plan.unresolved.length}`);
  log('По категориям: ' + (Object.entries(plan.byCode).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · ') || '—'));
  for (const p of plan.unresolved.slice(0, 30)) log(`  не определено: «${p.name}» (группа: ${p.group || '—'}) — задать вручную в карточке изделия`);
  if (plan.unresolved.length > 30) log(`  … ещё ${plan.unresolved.length - 30}`);
}

module.exports = { buildPlan, applyPlan, printPlan, codeByName };

// require.main нет при запуске через stdin (remote-access/run-script.sh: node -)
if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); let outFile = i > 0 ? process.argv[i + 1] : null;
  if (apply && !outFile) outFile = '/tmp/passport-category-groups-' + Date.now() + '.json';
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const [categories, products] = await Promise.all([
      db.collection('categories').find({ deletedAt: null, type: 'product' }, { projection: { name: 1, parentId: 1, passportCategory: 1 } }).toArray(),
      db.collection('products').find({ deletedAt: null }, { projection: { name: 1, categoryId: 1, 'passportDefaults.passportCategory': 1 } }).toArray(),
    ]);
    const plan = buildPlan(categories, products);
    printPlan(plan);
    if (outFile) { fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), backup: plan.products.map((g) => ({ _id: g.id, 'passportDefaults.passportCategory': null })), plan }, null, 2)); console.log(`\nВыгрузка (для отката) и план: ${outFile}`); }
    if (!apply) { console.log('\nНичего не записано. Записать: --apply'); return; }
    console.log(`\nГотово: изделий обновлено ${await applyPlan(db, plan, { ObjectId })}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
