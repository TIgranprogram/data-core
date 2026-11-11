/* C028 «Элементы»: разметка справочника passportElements и связь «значение признака → элементы изделия».
 * Решение — docs/crew/C028-passport-funnel/ELEMENTS-AUDIT.md §3–4; тот же состав в facets-seed.json (поле elements у значений).
 *
 *   1. passportElements.kind (product / part / fastener) — всем 56; categories — 11 пустым.
 *   2. productFacetValues.elementIds — по code значения, из названий элементов.
 *   Правки директора не затираются: kind и categories ставятся только пустым, elementIds — только значениям без элементов.
 *
 *   План:     MONGO_URI=… [MONGO_DB=…] node scripts/c028-elements.js
 *   Записать: … --apply   (выгрузка прежнего состояния для отката — в папке временных файлов)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const PART = ['BUSHING', 'AXLE', 'FLYWHEEL', 'PEDAL', 'FRAME_BODY', 'CARRIAGE', 'GUSSET', 'COVER_PLATE', 'BASE_PLATE', 'BEARING_UNIT', 'STOP_LIMITER', 'BASE', 'INFO_PLATE', 'HANDRAIL'];
const FASTENER = ['ANCHOR', 'EMBED_PART', 'FASTENERS', 'END_CAP', 'BRACKET'];
/** Детали и крепёж без категорий — применимы ко всем категориям паспорта. */
const ALL_CATEGORIES = 'TRN, WRK, DIO, DSP, BLG';
/** Код значения признака → названия элементов-изделий (справочник passportElements, поле name). */
const ELEMENTS = {
  'trn.kind.cardio': ['Кардиотренажёр'],
  'trn.kind.joint': ['Тренажёр с подвижными узлами'],
  'trn.muscles.legs': ['Тренажёр для мышц ног и ягодиц'],
  'trn.muscles.chest': ['Тренажёр для мышц груди и спины'],
  'trn.muscles.back': ['Тренажёр для мышц груди и спины'],
  'trn.muscles.core': ['Скамья для пресса'],
  'wrk.kind.bar': ['Турник'],
  'wrk.kind.parallel': ['Брусья'],
  'wrk.kind.monkey': ['Рукоход'],
  'wrk.kind.bench': ['Скамья для пресса'],
  'wrk.kind.wall': ['Шведская стенка'],
  'wrk.kind.basket': ['Баскетбольная стойка'],
  'wrk.kind.goal': ['Ворота для мини-футбола'],
  'wrk.kind.net': ['Волейбольные стойки'],
  'dsp.kind.bar': ['Турник', 'Рукоход', 'Брусья'],
  'dsp.kind.wall': ['Шведская стенка', 'Лестница'],
};
const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const kindOf = (code) => (PART.includes(code) ? 'part' : FASTENER.includes(code) ? 'fastener' : 'product');

/** Чистая функция: что поменять. elements — записи passportElements, values — productFacetValues. */
function buildPlan(elements, values) {
  const plan = { kinds: [], cats: [], links: [], miss: [] };
  const byName = new Map(elements.map((e) => [s(e.name), e]));
  for (const e of elements) {
    const kind = kindOf(s(e.code));
    if (!s(e.kind)) plan.kinds.push({ id: e._id, name: s(e.name), kind });
    if (!s(e.categories)) plan.cats.push({ id: e._id, name: s(e.name), categories: ALL_CATEGORIES });
  }
  const vByCode = new Map(values.map((v) => [s(v.code), v]));
  for (const [code, names] of Object.entries(ELEMENTS)) {
    const v = vByCode.get(code);
    if (!v) { plan.miss.push(`значение ${code}: нет в справочнике`); continue; }
    const found = names.map((n) => byName.get(n));
    const lost = names.filter((n, i) => !found[i]);
    if (lost.length) { plan.miss.push(`${code}: нет элементов ${lost.join(', ')}`); continue; }
    if (Array.isArray(v.elementIds) && v.elementIds.length) continue; // правка директора
    plan.links.push({ id: v._id, code, names, elementIds: found.map((e) => String(e._id)) });
  }
  return plan;
}
module.exports = { buildPlan, ELEMENTS, kindOf };

// запуск через stdin (remote-access/run-script.sh: node -) — require.main нет
if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.log('Нет MONGO_URI'); process.exit(2); }
  const apply = process.argv.includes('--apply');
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..', '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const col = db.collection('dict_values');
    const [elements, values] = await Promise.all([
      col.find({ dict: 'passportElements', deletedAt: null }).toArray(),
      col.find({ dict: 'productFacetValues', deletedAt: null }).toArray(),
    ]);
    const plan = buildPlan(elements, values);
    console.log(`Тип (kind): ${plan.kinds.length} · категории: ${plan.cats.length} · значения → элементы: ${plan.links.length} · не найдено: ${plan.miss.length}`);
    for (const k of plan.kinds) console.log(`  kind ${k.kind.padEnd(8)} ${k.name}`);
    for (const c of plan.cats) console.log(`  категории «${c.name}» → ${c.categories}`);
    for (const l of plan.links) console.log(`  ${l.code} → ${l.names.join(', ')}`);
    for (const m of plan.miss) console.log(`  ! ${m}`);
    if (!apply) { console.log('\nНичего не записано. Записать: --apply'); return; }
    const byId = new Map([...elements, ...values].map((d) => [String(d._id), d]));
    const out = path.join(os.tmpdir(), `c028-elements-${Date.now()}.json`);
    const undo = [...plan.kinds, ...plan.cats, ...plan.links].map((c) => String(c.id));
    fs.writeFileSync(out, JSON.stringify([...new Set(undo)].map((id) => { const d = byId.get(id); return { id, kind: d.kind ?? null, categories: d.categories ?? null, elementIds: d.elementIds ?? null }; }), null, 1));
    const now = new Date();
    for (const k of plan.kinds) await col.updateOne({ _id: k.id }, { $set: { kind: k.kind, updatedAt: now } });
    for (const c of plan.cats) await col.updateOne({ _id: c.id }, { $set: { categories: c.categories, updatedAt: now } });
    for (const l of plan.links) await col.updateOne({ _id: l.id }, { $set: { elementIds: l.elementIds.map((x) => new ObjectId(x)), updatedAt: now } });
    console.log(`\nГотово. Прежнее состояние для отката: ${out}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message); process.exit(2); });
