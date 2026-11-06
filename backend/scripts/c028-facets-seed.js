/* C028 (паспорт «воронкой», B1.7): справочники «Признаки продукции» (dict_values, dict 'productFacets') и «Значения признаков»
 * ('productFacetValues') из docs/crew/C028-passport-funnel/facets-seed.json.
 *
 *   Ключ — code. Что уже есть в базе, не трогается (правки директора не затираются); создаётся только недостающее.
 *   Значение ссылается на признак по id (parentId). purposePhrase из seed → id записи «Тексты паспорта» (раздел purpose) по названию;
 *   нет такого текста — ссылка пустая, в плане строка «нет текста». estimate в базу не идёт. Повторный запуск — 0 новых.
 *   Лог — tools/logs/c028-facets-seed-<время>.log (нет папки — во временную).
 *
 *   План:     MONGO_URI=… [MONGO_DB=…] node scripts/c028-facets-seed.js [--seed файл.json]
 *   Записать: … --apply [--out backup.json]   (в выгрузке _id созданных записей — для отката: удалить их из dict_values)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const key = (v) => s(v).toLowerCase().replace(/ё/g, 'е');
const words = (v) => [...new Set(String(v ?? '').split(/[|;,\n]/).map(key).filter(Boolean))];
const DEFAULT_SEED = path.join(__dirname, '..', '..', 'docs', 'crew', 'C028-passport-funnel', 'facets-seed.json');

/** Чистая функция: что создать. have — { facets: [{code}], values: [{code}] }, phrases — [{ _id, name, text }] (раздел purpose). */
function buildPlan(seed, have, phrases) {
  const facetHave = new Set(have.facets.map((x) => s(x.code)));
  const valueHave = new Set(have.values.map((x) => s(x.code)));
  const phrase = new Map(phrases.filter((p) => s(p.text)).map((p) => [key(p.name), String(p._id)]));
  const plan = { facets: [], values: [], keepFacets: 0, keepValues: 0, noPhrase: [] };
  for (const c of seed.categories) {
    for (const f of c.facets) {
      if (facetHave.has(f.code)) plan.keepFacets++;
      else plan.facets.push({ code: f.code, name: f.name, category: c.category, order: f.order, step: f.step === true, multi: f.multi === true, hint: f.hint ?? null });
      for (const v of f.values) {
        if (valueHave.has(v.code)) { plan.keepValues++; continue; }
        const pid = v.purposePhrase ? phrase.get(key(v.purposePhrase)) ?? null : null;
        if (v.purposePhrase && !pid) plan.noPhrase.push(`${v.code}: «${v.purposePhrase}»`);
        plan.values.push({ code: v.code, name: v.name, facetCode: f.code, order: v.order, words: words(v.words), purposePhraseId: pid });
      }
    }
  }
  return plan;
}

async function applyPlan(db, plan, ObjectId) {
  const now = new Date(); const created = [];
  const facetId = new Map((await db.collection('dict_values').find({ dict: 'productFacets', deletedAt: null }, { projection: { code: 1 } }).toArray()).map((x) => [s(x.code), x._id]));
  for (const f of plan.facets) {
    const r = await db.collection('dict_values').insertOne({ dict: 'productFacets', ...f, deletedAt: null, createdAt: now, updatedAt: now });
    facetId.set(f.code, r.insertedId); created.push(String(r.insertedId));
  }
  for (const v of plan.values) {
    const { facetCode, purposePhraseId, ...rest } = v;
    const r = await db.collection('dict_values').insertOne({ dict: 'productFacetValues', ...rest, parentId: facetId.get(facetCode), purposePhraseId: purposePhraseId ? new ObjectId(purposePhraseId) : null, installTypeId: null, elementIds: [], deletedAt: null, createdAt: now, updatedAt: now });
    created.push(String(r.insertedId));
  }
  return created;
}

function printPlan(plan, log = console.log) {
  log(`Признаков: создать ${plan.facets.length}, уже есть ${plan.keepFacets} · значений: создать ${plan.values.length}, уже есть ${plan.keepValues}`);
  for (const f of plan.facets) log(`  + признак ${f.category} ${f.code} «${f.name}»`);
  for (const v of plan.values.slice(0, 80)) log(`  + значение ${v.code} «${v.name}»${v.purposePhraseId ? ' (назначение найдено)' : ''}`);
  if (plan.values.length > 80) log(`  … ещё ${plan.values.length - 80}`);
  if (plan.noPhrase.length) { log(`Нет текста «Назначение» в справочнике (ссылка останется пустой): ${plan.noPhrase.length}`); for (const x of plan.noPhrase) log('  ! ' + x); }
}

module.exports = { buildPlan, applyPlan, printPlan };

// require.main нет при запуске через stdin (remote-access/run-script.sh: node -)
if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const seed = JSON.parse(fs.readFileSync(arg('--seed') || DEFAULT_SEED, 'utf8'));
  let outFile = arg('--out');
  if (apply && !outFile) outFile = path.join(os.tmpdir(), 'c028-facets-seed-' + Date.now() + '.json');
  const lines = []; const log = (t = '') => { lines.push(t); console.log(t); };
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const rows = await db.collection('dict_values').find({ dict: { $in: ['productFacets', 'productFacetValues', 'passportPhrases'] }, deletedAt: null }).toArray();
    const plan = buildPlan(seed, { facets: rows.filter((r) => r.dict === 'productFacets'), values: rows.filter((r) => r.dict === 'productFacetValues') }, rows.filter((r) => r.dict === 'passportPhrases' && r.section === 'purpose'));
    printPlan(plan, log);
    if (apply) {
      const ids = await applyPlan(db, plan, ObjectId);
      fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), createdIds: ids, plan }, null, 2));
      log(`\nГотово: создано ${ids.length}. Выгрузка для отката: ${outFile}`);
    } else log('\nНичего не записано. Записать: --apply');
    // лог в tools/logs (на сервере папки нет — во временную)
    const dir = path.join(__dirname, '..', '..', 'tools', 'logs');
    const name = path.join(fs.existsSync(dir) ? dir : os.tmpdir(), `c028-facets-seed-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.log`);
    fs.writeFileSync(name, lines.join('\n') + '\n'); console.log(`Лог: ${name}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
