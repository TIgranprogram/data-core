/* C028: дописать в тексты паспорта 6 предложений вместо вырезанных «[уточнить]» (ответы по ГОСТ —
 * docs/crew/C028-passport-funnel/texts-numbers-ANSWERS.md, пункты 1, 3, 5, 9, 14, 16; «да» пользователя 2026-11-07).
 *
 *   Ищет в dict_values (dict 'passportPhrases') корень раздела по названию черновика и категории, у него — вариант «Текст»,
 *   и добавляет предложение новой строкой в конец. Уже есть — пропуск (повторный запуск ничего не меняет).
 *
 *   План:     MONGO_URI=… [MONGO_DB=…] node scripts/c028-texts-fill.js
 *   Записать: … --apply   (выгрузка прежних текстов для отката — в /tmp)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILL = [
  { category: 'TRN', title: 'Правила для тренажёров суставов и разминки', text: 'Упражнение выполняйте плавно, без рывков; число повторений и время занятия подбирайте по самочувствию.' },
  { category: 'WRK', title: 'Правила для колец, каната и скалодрома', text: 'Не спрыгивайте с высоты больше указанной в паспорте изделия; приземляйтесь на покрытие, предусмотренное площадкой.' },
  { category: 'WRK', title: 'Особенности осмотра стоек и сетки', text: 'Если стойки и сетка оснащены мягкими накладками, проверяйте их целостность и крепление при каждом осмотре.' },
  { category: 'BLG', title: 'Обслуживание велопарковок', text: 'Велопарковка рассчитана на число велосипедов, указанное в паспорте; садиться и вставать на неё запрещено.' },
  { category: 'DIO', title: 'Уход за песочницей', text: 'Состояние песка проверяйте при каждом осмотре; при загрязнении, уплотнении или уменьшении слоя песок заменяйте или досыпайте. Если песочница не закрывается защитным покрытием, заменяйте песок чаще.' },
  { category: 'DSP', title: 'Обслуживание детского спортивного оборудования', text: 'Визуально осматривайте ежедневно, если площадка используется интенсивно; функциональный осмотр — раз в 1–3 месяца или по инструкции изготовителя; основной осмотр — не реже одного раза в год (ГОСТ 34614.7-2019, п. 6.2).' },
];
const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Чистая функция: что поменять. rows — записи passportPhrases (корни и листья). */
function buildPlan(rows, fill = FILL) {
  const plan = { change: [], keep: [], miss: [] };
  for (const f of fill) {
    const root = rows.find((r) => !r.parentId && s(r.name) === f.title && s(r.categories) === f.category);
    if (!root) { plan.miss.push(`${f.category} «${f.title}»: нет раздела`); continue; }
    const leaf = rows.find((r) => r.parentId && String(r.parentId) === String(root._id));
    if (!leaf) { plan.miss.push(`${f.category} «${f.title}»: нет варианта текста`); continue; }
    const cur = String(leaf.text || '');
    if (cur.includes(f.text)) { plan.keep.push(`${f.category} «${f.title}»`); continue; }
    plan.change.push({ id: leaf._id, title: f.title, category: f.category, before: cur, after: cur ? `${cur}\n${f.text}` : f.text });
  }
  return plan;
}
module.exports = { buildPlan, FILL };

// запуск через stdin (remote-access/run-script.sh: node -) — require.main нет
if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.log('Нет MONGO_URI'); process.exit(2); }
  const apply = process.argv.includes('--apply');
  const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..', '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const rows = await db.collection('dict_values').find({ dict: 'passportPhrases', deletedAt: null }).toArray();
    const plan = buildPlan(rows);
    console.log(`Дописать: ${plan.change.length} · уже есть: ${plan.keep.length} · не найдено: ${plan.miss.length}`);
    for (const c of plan.change) console.log(`  + ${c.category} «${c.title}»`);
    for (const m of plan.miss) console.log(`  ! ${m}`);
    if (!apply) { console.log('\nНичего не записано. Записать: --apply'); return; }
    const out = path.join(os.tmpdir(), `c028-texts-fill-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(plan.change.map((c) => ({ id: String(c.id), text: c.before })), null, 1));
    for (const c of plan.change) await db.collection('dict_values').updateOne({ _id: c.id }, { $set: { text: c.after, updatedAt: new Date() } });
    console.log(`\nГотово: дописано ${plan.change.length}. Прежние тексты для отката: ${out}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message); process.exit(2); });
