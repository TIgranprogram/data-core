/* «МАФ» → «Благоустройство» (решение пользователя 2026-10-23, TASKS БЛГ). Код категории паспорта MAF НЕ меняется.
 * НА ПРОДЕ — только после «да» пользователя и бэкапа. Без --apply ничего не пишет (план).
 *
 *   План:                     MONGO_URI=… [MONGO_DB=…] node scripts/rename-maf.js [--passports] [--catalog]
 *   Записать:                 … --apply
 *
 * По умолчанию — справочники «Паспорта»: категория MAF (название, «Категории каталога»), оформление COLOR_MAF.
 * --passports — паспорта: категория каталога «МАФ» → «Благоустройство» (текст паспорта не трогаем — в нём слова «МАФ» нет).
 * --drop-old  — убрать «МАФ» из «Категорий каталога» категории (когда в паспортах и «Продукции» его уже нет).
 * --catalog   — раздел «Продукции» «МАФ» → «Благоустройство» (categories type product — ОБЩАЯ с CRM kppdf, там тоже переименуется).
 * Откат: до записи сохраняется JSON прежних значений рядом со скриптом (rename-maf-before-<время>.json).
 */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

const APPLY = process.argv.includes('--apply');
const WITH_PASSPORTS = process.argv.includes('--passports');
const WITH_CATALOG = process.argv.includes('--catalog');
const DROP_OLD = process.argv.includes('--drop-old');
const NEW = 'Благоустройство';
const isMaf = (s) => /^\s*маф\s*$/i.test(String(s ?? ''));

(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URI);
  const db = c.db(process.env.MONGO_DB || undefined);
  const plan = []; // { coll, _id, set, before }
  const dv = db.collection('dict_values');
  const cat = await dv.findOne({ dict: 'passportCategories', code: 'MAF', deletedAt: null });
  if (cat) {
    const names = String(cat.catalogNames || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    const catalogNames = [...new Set([NEW, ...names])].filter((n) => !(DROP_OLD && isMaf(n))).join(', '); // «МАФ» — старое название, пока оно есть в данных
    if (cat.name !== NEW || cat.catalogNames !== catalogNames) plan.push({ coll: 'dict_values', _id: cat._id, set: { name: NEW, catalogNames }, before: { name: cat.name, catalogNames: cat.catalogNames } });
  }
  const style = await dv.findOne({ dict: 'passportStyle', code: 'COLOR_MAF', deletedAt: null });
  if (style && /маф/i.test(style.name)) plan.push({ coll: 'dict_values', _id: style._id, set: { name: 'Цвет: благоустройство' }, before: { name: style.name } });
  if (WITH_PASSPORTS) {
    for (const p of await db.collection('productpassports').find({ deletedAt: null, category: { $regex: /^\s*маф\s*$/i } }, { projection: { category: 1, passportNumber: 1 } }).toArray()) {
      plan.push({ coll: 'productpassports', _id: p._id, set: { category: NEW }, before: { category: p.category }, label: `паспорт № ${p.passportNumber}` });
    }
  }
  if (WITH_CATALOG) {
    for (const k of await db.collection('categories').find({ type: 'product', deletedAt: null }).toArray()) {
      if (!isMaf(k.name)) continue;
      const clash = await db.collection('categories').findOne({ type: 'product', deletedAt: null, parentId: k.parentId ?? null, name: { $regex: new RegExp(`^\\s*${NEW}\\s*$`, 'i') } });
      if (clash) { console.log(`! раздел «${NEW}» уже есть рядом с «${k.name}» — переименование пропущено, нужно объединить вручную`); continue; }
      plan.push({ coll: 'categories', _id: k._id, set: { name: NEW }, before: { name: k.name }, label: 'раздел каталога (общий с CRM)' });
    }
  }
  console.log(`${APPLY ? 'ЗАПИСЬ' : 'ПЛАН (ничего не пишем)'}: ${plan.length}`);
  const byColl = plan.reduce((m, x) => ((m[x.coll] = (m[x.coll] || 0) + 1), m), {});
  console.log(JSON.stringify(byColl));
  for (const x of plan.filter((y) => y.coll !== 'productpassports').concat(plan.filter((y) => y.coll === 'productpassports').slice(0, 5))) console.log(` - ${x.coll} ${x.label || ''} ${JSON.stringify(x.before)} → ${JSON.stringify(x.set)}`);
  if (APPLY && plan.length) {
    const file = path.join(__dirname, `rename-maf-before-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(plan.map((x) => ({ coll: x.coll, _id: String(x._id), before: x.before })), null, 1));
    console.log('откат — ' + file);
    for (const x of plan) await db.collection(x.coll).updateOne({ _id: x._id }, { $set: { ...x.set, updatedAt: new Date() } });
    console.log('готово');
  }
  await c.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
