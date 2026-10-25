/* Тексты паспортов v2 по категориям (БЗ-6 Э7) → новые версии в passporttemplates (как «Сохранить» шаблона в приложении:
 * service.saveTemplate). Тексты — scripts/passport-texts.v2.json (их же типизирует src/modules/product-passport/passport-texts.v2.ts).
 * НА ПРОДЕ — только после «да» пользователя.
 *
 *   План (ничего не меняет):  MONGO_URI=… [MONGO_DB=…] node scripts/seed-passport-texts.js [--only=TRN,DIO]
 *   Записать:                 … --apply
 *
 * Для каждой категории: версия = наибольшая в этой категории + 1; прежние активные этой категории → isActive:false.
 * «Для всех» v2 (ALL) пишется с category ALL_V2 (БЗ-6 Э9.4) — шаблон «Для всех» PDF v1 (category пусто/ALL) не трогается.
 * Если активная версия уже совпадает с текстом — пропуск. */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
const TEXTS = require('./passport-texts.v2.json');

const ORDER = ['ALL', 'TRN', 'WRK', 'DSP', 'BLG', 'DIO'];
const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const onlyArg = argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : null;

const dbCat = (cat) => (cat === 'ALL' ? 'ALL_V2' : cat);
const filterOf = (cat) => ({ category: dbCat(cat) });
const same = (doc, t) => !!doc && JSON.stringify(doc.sections || []) === JSON.stringify(t.sections) && JSON.stringify(doc.tables || []) === JSON.stringify(t.tables);
const count = (t) => `${t.sections.length} разд., ${t.sections.reduce((n, s) => n + s.paragraphs.length, 0)} п.`;

(async () => {
  const bad = (only || []).filter((c) => !ORDER.includes(c));
  if (bad.length) throw new Error(`--only: неизвестные категории ${bad.join(', ')} (есть: ${ORDER.join(', ')})`);
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const client = await MongoClient.connect(uri);
  const db = client.db(process.env.MONGO_DB || undefined);
  const c = db.collection('passporttemplates');
  console.log(`База ${db.databaseName}, коллекция passporttemplates${apply ? '' : ' — ПЛАН, ничего не меняется'}`);
  let written = 0;
  for (const cat of ORDER) {
    if (only && !only.includes(cat)) continue;
    const t = TEXTS[cat];
    if (!t) { console.log(`${cat}: нет текстов в JSON — пропуск`); continue; }
    const f = filterOf(cat);
    const active = await c.find({ ...f, isActive: true }).sort({ version: -1 }).limit(1).next();
    const last = await c.find(f).sort({ version: -1 }).limit(1).next();
    const next = (last?.version ?? 0) + 1;
    const head = `${cat}: ${count(t)}; сейчас активна ${active ? 'v' + active.version : '—'}`;
    if (same(active, t)) { console.log(`${head} — уже совпадает, пропуск`); continue; }
    if (!apply) { console.log(`${head} → будет v${next}`); continue; }
    const now = new Date();
    await c.updateMany({ ...f, isActive: true }, { $set: { isActive: false, updatedAt: now } });
    await c.insertOne({ version: next, isActive: true, category: dbCat(cat), sections: t.sections, tables: t.tables, createdAt: now, updatedAt: now });
    console.log(`${head} → записана v${next}`);
    written++;
  }
  if (apply) console.log(`Записано версий: ${written}`);
  else console.log('Ничего не записано (план). Записать: --apply');
  await client.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
