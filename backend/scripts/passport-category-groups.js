/* Паспорта (PASSPORT-FLOW-AUDIT, шаг 4): категория паспорта у групп каталога. Изделие без своей категории наследует её от группы
 * (passport-inherit.ts), поэтому записывается только `categories.passportCategory`; изделия не меняются.
 *
 *   Группа = категория type 'product' с родителем. Уже заданное не трогаем.
 *   Категория определяется по названию группы по явным правилам RULES (первое совпадение); нет совпадения —
 *   по названиям изделий группы: код, который набрал ≥ 60 % классифицированных изделий (минимум 3). Иначе — в списке «не определено».
 *   Повторный запуск — 0 изменений.
 *
 *   План:     MONGO_URI=… [MONGO_DB=…] node scripts/passport-category-groups.js
 *   Записать: … --apply [--out backup.json]   (выгрузка прежних значений — для отката; без --out пишется в /tmp)
 *   Откат: `categories.updateOne({ _id }, { $unset: { passportCategory: '' } })` для записей выгрузки.
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
  const groups = categories.filter((c) => c.type === 'product' && c.parentId);
  const byGroup = new Map();
  for (const p of products) { const k = String(p.categoryId ?? ''); if (k) (byGroup.get(k) ?? byGroup.set(k, []).get(k)).push(p); }
  const plan = { groups: [], unresolved: [], alreadySet: 0, productsInherit: 0, totalGroups: groups.length };
  const groupCode = new Map(); // id → код (уже заданный или новый)
  for (const g of groups) {
    const id = String(g._id);
    if (s(g.passportCategory)) { plan.alreadySet++; groupCode.set(id, s(g.passportCategory)); continue; }
    const prods = byGroup.get(id) ?? [];
    let code = codeByName(g.name), via = 'по названию группы';
    if (!code) {
      const tally = {};
      for (const p of prods) { const c = codeByName(p.name); if (c) tally[c] = (tally[c] ?? 0) + 1; }
      const total = Object.values(tally).reduce((a, b) => a + b, 0);
      const [top, n] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0] ?? [];
      if (top && total >= 3 && n / total >= 0.6) { code = top; via = `по названиям изделий (${n} из ${total})`; }
    }
    if (code) { plan.groups.push({ id, name: s(g.name), code, via, products: prods.length }); groupCode.set(id, code); }
    else plan.unresolved.push({ id, name: s(g.name), products: prods.length });
  }
  // изделия без своей категории, которые получат её от группы
  for (const p of products) {
    if (s(p.passportDefaults?.passportCategory)) continue;
    if (groupCode.has(String(p.categoryId ?? ''))) plan.productsInherit++;
  }
  return plan;
}

async function applyPlan(db, plan, { ObjectId }) {
  let n = 0;
  for (const g of plan.groups) {
    // условие «пусто» — ручная правка в гонке не затирается
    const r = await db.collection('categories').updateOne({ _id: new ObjectId(g.id), deletedAt: null, $or: [{ passportCategory: null }, { passportCategory: '' }, { passportCategory: { $exists: false } }] }, { $set: { passportCategory: g.code, updatedAt: new Date() } });
    n += r.modifiedCount;
  }
  return n;
}

function printPlan(plan, log = console.log) {
  log(`Групп: ${plan.totalGroups} · уже с категорией: ${plan.alreadySet} · получат категорию: ${plan.groups.length} · не определено: ${plan.unresolved.length}`);
  log(`Изделий без своей категории, которые её унаследуют: ${plan.productsInherit}`);
  for (const g of plan.groups.slice(0, 10)) log(`  ${g.code} ← «${g.name}» (${g.via}, изделий: ${g.products})`);
  if (plan.groups.length > 10) log(`  … ещё ${plan.groups.length - 10}`);
  for (const g of plan.unresolved) log(`  не определено: «${g.name}» (изделий: ${g.products}) — задать вручную в «Группах каталога»`);
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
      db.collection('categories').find({ deletedAt: null }, { projection: { name: 1, type: 1, parentId: 1, passportCategory: 1 } }).toArray(),
      db.collection('products').find({ deletedAt: null }, { projection: { name: 1, categoryId: 1, 'passportDefaults.passportCategory': 1 } }).toArray(),
    ]);
    const plan = buildPlan(categories, products);
    printPlan(plan);
    if (outFile) { fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), backup: plan.groups.map((g) => ({ _id: g.id, passportCategory: null })), plan }, null, 2)); console.log(`\nВыгрузка (для отката) и план: ${outFile}`); }
    if (!apply) { console.log('\nНичего не записано. Записать: --apply'); return; }
    console.log(`\nГотово: групп обновлено ${await applyPlan(db, plan, { ObjectId })}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
