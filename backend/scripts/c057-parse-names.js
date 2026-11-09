/* C057-Э0 шаг 2: разбор названий номенклатуры в ПУСТЫЕ поля typeName / standardRef / materialGrade / assortment / dimensions.
 * ТЗ: docs/crew/C057-pdm-import/TZ-E0-DATA.md. Разборщик — scripts/lib/c057-parse.js (тесты: scripts/c057-lib.test.mjs).
 *
 *   План по выгрузке:  node scripts/c057-parse-names.js --from <папка выгрузки>
 *   План по базе:      MONGO_URI=… MONGO_DB=… node scripts/c057-parse-names.js
 *   Записать:          MONGO_URI=… MONGO_DB=… node scripts/c057-parse-names.js --apply [--out откат.json]
 *
 * Заполненное поле не меняется никогда; размеры — только те типы, которых у позиции ещё нет. Метизы (категория «Метизы»), листы и
 * стекло, трубы разбираются; покупные, оборудование и расходники — нет (нет надёжного правила) и попадают в счёт «не разбирались».
 * --apply идемпотентен: каждое поле пишется только если оно всё ещё пустое; второй запуск — 0 изменений. */
'use strict';
const C = require('./lib/c057-common');
const { groupOf, parseName, fillEmpty } = require('./lib/c057-parse');

const GROUP_RU = { fastener: 'Метизы', sheet: 'Листы и стекло', pipe: 'Трубы', other: 'Остальное (покупные, оборудование, расходники)' };
const FIELDS = ['typeName', 'standardRef', 'materialGrade', 'assortment'];

function buildPlan(materials) {
  const items = [], unparsed = [], stat = {};
  for (const m of materials) {
    const g = groupOf(m.catName, m.name);
    const st = (stat[g] ||= { total: 0, ok: 0, bad: 0, changed: 0, nothing: 0 });
    st.total++;
    const p = parseName(m.name, g, m.catName);
    if (p.skipped) continue;
    if (!p.ok) { st.bad++; unparsed.push({ id: m.id, name: m.name, group: g, reason: p.reason }); } else st.ok++;
    const { set, addDims } = fillEmpty(m, p);
    if (Object.keys(set).length || addDims.length) { st.changed++; items.push({ id: m.id, name: m.name, group: g, set, addDims, notes: p.notes, ok: p.ok }); } else st.nothing++;
  }
  return { items, unparsed, stat };
}

function render(plan, source, total) {
  const rows = Object.entries(GROUP_RU).map(([g, ru]) => {
    const s = plan.stat[g] || { total: 0, ok: 0, bad: 0, changed: 0, nothing: 0 };
    return g === 'other' ? [ru, s.total, '—', '—', 'не разбирались', ''] : [ru, s.total, s.ok, s.bad, s.changed, s.total ? Math.round((100 * s.ok) / s.total) + ' %' : ''];
  });
  const L = ['# C057-Э0 · шаг 2 · разбор названий в пустые поля', '', `Источник: ${source} · дата: ${C.today()} · позиций: ${total}`, '',
    'Что делает: из названия достаёт тип, стандарт, марку, сортамент и размеры и пишет их **только в пустые поля**. Заполненное не меняется.', '',
    C.table(['Вид', 'Позиций', 'Разобрано', 'Не разобрано', 'Позиций изменится', 'Доля разобранных'], rows), '',
    `Записей к изменению: **${plan.items.length}**. Полей: ${FIELDS.map((f) => `${f} ${plan.items.filter((i) => i.set[f]).length}`).join(', ')}; размеров добавится: ${plan.items.reduce((n, i) => n + i.addDims.length, 0)}.`, ''];
  L.push('## Не разобрано', '', plan.unparsed.length ? C.table(['Позиция', 'Вид', 'Почему'], plan.unparsed.map((u) => [u.name, GROUP_RU[u.group], u.reason])) : 'Все метизы, листы, стекло и трубы разобраны.', '');
  const notes = plan.items.filter((i) => i.notes.length);
  if (notes.length) L.push('## Примечания разборщика', '', C.table(['Позиция', 'Примечание'], notes.map((i) => [i.name, i.notes.join('; ')])), '');
  L.push('## Примеры (первые по видам)', '');
  for (const g of ['fastener', 'sheet', 'pipe']) {
    const ex = plan.items.filter((i) => i.group === g).slice(0, 8);
    if (ex.length) L.push(`### ${GROUP_RU[g]}`, '', C.table(['Название', 'Запишется'], ex.map((i) => [i.name, [...Object.entries(i.set).map(([k, v]) => `${k}: ${v}`), ...i.addDims.map((d) => `${d.type}: ${d.value}`)].join('; ')])), '');
  }
  L.push('Вес не меняется (см. отчёт веса). Тип в `typeName` для листа — «Лист» (рифлёность — в сортаменте), для трубы — «Труба»: иначе ключ сравнения не соберёт толщину листа.', '');
  return L.join('\n');
}

async function applyPlan(db, plan, { ObjectId }) {
  const before = [];
  let changed = 0;
  const col = db.collection('materials');
  for (const i of plan.items) {
    const oid = new ObjectId(i.id), done = { _id: i.id, fields: [], dims: [] };
    for (const [f, v] of Object.entries(i.set)) {
      const r = await col.updateOne({ _id: oid, [f]: { $in: [null, ''] } }, { $set: { [f]: v } });
      if (r.modifiedCount) done.fields.push(f);
    }
    for (const d of i.addDims) {
      const r = await col.updateOne({ _id: oid, dimensions: { $not: { $elemMatch: { type: d.type } } } }, { $push: { dimensions: d } });
      if (r.modifiedCount) done.dims.push(d.type);
    }
    if (done.fields.length || done.dims.length) { changed++; before.push(done); }
  }
  return { changed, before };
}

async function main() {
  const a = C.args();
  const d = await C.load(a);
  try {
    const plan = buildPlan(d.materials);
    const f = C.writePlan(a, 'parse-names-plan', { step: 'c057-parse-names', source: d.source, createdAt: new Date().toISOString(), ...plan }, render(plan, d.source, d.materials.length));
    const s = plan.stat;
    console.log(`Разбор: метизы ${s.fastener?.ok}/${s.fastener?.total}, листы ${s.sheet?.ok}/${s.sheet?.total}, трубы ${s.pipe?.ok}/${s.pipe?.total}, не разбирались ${s.other?.total}; к записи ${plan.items.length}; не разобрано ${plan.unparsed.length}\nПлан: ${f.md}`);
    if (a.apply) {
      const { ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), __dirname] })).mongo;
      const r = await applyPlan(d.db, plan, { ObjectId });
      console.log(`ЗАПИСАНО в ${d.db.databaseName}: позиций ${r.changed}. Откат (какие поля/размеры добавлены): ${C.writeRollback(a, 'c057-parse-names', r.before)}`);
    } else console.log('Только план, ничего не записано. Записать: --apply (MONGO_URI + MONGO_DB).');
  } finally { if (d.client) await d.client.close(); }
}

module.exports = { buildPlan, render, applyPlan };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });
