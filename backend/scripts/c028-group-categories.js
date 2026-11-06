/* C028 (паспорт «воронкой», B1.7): категория паспорта у групп изделий — `categories.passportCategory` для 29 групп из
 * docs/crew/C028-passport-funnel/facets-seed.json (раздел groupCategory: { TRN: [названия групп], … }).
 *
 *   Группа с уже заданной категорией не трогается. Название «Качели (раздел «Оборудование для …»)» — группа «Качели» именно этого раздела.
 *   Группа из seed не найдена или найдена дважды — в плане «не определено», ничего не пишется.
 *   Повторный запуск — 0 изменений. Лог — tools/logs/c028-group-categories-<время>.log (нет папки — во временную).
 *
 *   План:     MONGO_URI=… [MONGO_DB=…] node scripts/c028-group-categories.js [--seed файл.json]
 *   Записать: … --apply [--out backup.json]   (в выгрузке id групп; откат — $unset passportCategory у них)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const key = (v) => s(v).toLowerCase().replace(/ё/g, 'е');
const DEFAULT_SEED = path.join(__dirname, '..', '..', 'docs', 'crew', 'C028-passport-funnel', 'facets-seed.json');

/** «Качели (раздел «Оборудование…»)» → { name: 'Качели', section: 'Оборудование…' }. */
function parseName(raw) {
  const m = s(raw).match(/^(.*?)\s*\(раздел\s*[«"](.+?)[»"]\)\s*$/i);
  return m ? { name: s(m[1]), section: s(m[2]) } : { name: s(raw), section: '' };
}

/** Чистая функция: groupCategory из seed + живые категории каталога (разделы и группы) → план. */
function buildPlan(groupCategory, categories) {
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  const groups = categories.filter((c) => c.parentId);
  const plan = { set: [], keep: [], unresolved: [] };
  for (const [code, names] of Object.entries(groupCategory)) {
    if (!Array.isArray(names) || code === 'skip') continue; // note, skip — не категории
    for (const raw of names) {
      const { name, section } = parseName(raw);
      const found = groups.filter((g) => key(g.name) === key(name) && (!section || key(byId.get(String(g.parentId))?.name) === key(section)));
      if (found.length !== 1) { plan.unresolved.push({ raw, code, found: found.length }); continue; }
      const g = found[0];
      if (s(g.passportCategory)) plan.keep.push({ id: String(g._id), name: s(g.name), has: s(g.passportCategory), want: code });
      else plan.set.push({ id: String(g._id), name: s(g.name), section: s(byId.get(String(g.parentId))?.name), code });
    }
  }
  return plan;
}

async function applyPlan(db, plan, ObjectId) {
  const now = new Date();
  for (const p of plan.set) {
    await db.collection('categories').updateOne({ _id: new ObjectId(p.id), $or: [{ passportCategory: null }, { passportCategory: '' }, { passportCategory: { $exists: false } }] }, { $set: { passportCategory: p.code, updatedAt: now } });
  }
  return plan.set.length;
}

function printPlan(plan, log = console.log) {
  log(`Групп: задать категорию ${plan.set.length}, уже задана ${plan.keep.length}, не определено ${plan.unresolved.length}`);
  for (const p of plan.set) log(`  + ${p.code}  ${p.name} (раздел «${p.section}»)`);
  for (const p of plan.keep) log(`  = ${p.name}: уже ${p.has}${p.has !== p.want ? ` (в seed ${p.want} — не меняем)` : ''}`);
  for (const u of plan.unresolved) log(`  ! ${u.code}  ${u.raw} — ${u.found ? 'найдено групп: ' + u.found : 'нет такой группы'}`);
}

module.exports = { parseName, buildPlan, applyPlan, printPlan };

// require.main нет при запуске через stdin (remote-access/run-script.sh: node -)
if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  const seed = JSON.parse(fs.readFileSync(arg('--seed') || DEFAULT_SEED, 'utf8'));
  let outFile = arg('--out');
  if (apply && !outFile) outFile = path.join(os.tmpdir(), 'c028-group-categories-' + Date.now() + '.json');
  const lines = []; const log = (t = '') => { lines.push(t); console.log(t); };
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const cats = await db.collection('categories').find({ type: 'product', deletedAt: null }, { projection: { name: 1, parentId: 1, passportCategory: 1 } }).toArray();
    const plan = buildPlan(seed.groupCategory, cats);
    printPlan(plan, log);
    if (apply) {
      const n = await applyPlan(db, plan, ObjectId);
      fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), changed: plan.set.map((p) => ({ id: p.id, was: null, now: p.code })) }, null, 2));
      log(`\nГотово: задано ${n}. Выгрузка для отката: ${outFile}`);
    } else log('\nНичего не записано. Записать: --apply');
    const dir = path.join(__dirname, '..', '..', 'tools', 'logs');
    const name = path.join(fs.existsSync(dir) ? dir : os.tmpdir(), `c028-group-categories-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.log`);
    fs.writeFileSync(name, lines.join('\n') + '\n'); console.log(`Лог: ${name}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
