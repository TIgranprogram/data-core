/* C061 (2026-11-10, решение пользователя: тренажёры — «Грузоблочные» и «Суставные» = все без грузов).
 * Делим не новыми группами (группа даёт первые цифры артикула, подгрупп в каталоге нет), а признаком «Нагрузка» (trn.load):
 *   «Изменяемая (грузы)» — грузоблочные; «Собственный вес» — суставные. Тексты паспорта привязываются к значению признака.
 * Скрипт ТОЛЬКО собирает план из выгрузки GET /api/showcase (JSON с items) — в базу не пишет.
 *   node scripts/c061-trainers-load-plan.js <showcase.json> [<facetvals.json>] > docs/crew/C061-trainers-load/plan.json
 * Записывает план deploy/synology/c061-trainers-load.sh (PATCH /api/showcase/:id) — по «да» пользователя.
 */
const fs = require('fs');

// гравитрон, мультиштанга, комбинированный станок — грузоблочные (решение пользователя 2026-11-10)
const WEIGHT = /изменяем\w* нагруз|нагрузочн|груз|блок\b|блочн|гравитрон|мультиштанг|станок/i;
const IS_TRAINER = /тренаж|эллипс/i;
// по названию не понять, есть ли грузы — в план не идут, решает пользователь
const ASK = /гравитрон|мультиштанг|станок|штанг/i;

/** Чистая функция: изделия витрины + id двух значений признака → план. */
function buildPlan(items, ids) {
  const plan = { weights: [], body: [], keep: [], ask: [], moveGroup: [], wrongCategory: [] };
  for (const p of items) {
    if (p.deletedAt) continue;
    const trainer = p.group === 'Тренажеры' || IS_TRAINER.test(p.name || '');
    // категория паспорта «Уличный тренажёр» у не-тренажёра — только в отчёт (воркаут, стойки, павильон…)
    if (!trainer) { if (p.ppCategory === 'TRN') plan.wrongCategory.push({ id: p.id, sku: p.sku || '', name: p.name || '', group: p.group || '' }); continue; }
    const has = (p.facetValueIds || []).map(String);
    const want = WEIGHT.test(`${p.name || ''} ${p.fullName || ''}`) ? ids.weights : ids.body;
    const row = { id: p.id, sku: p.sku || '', name: p.name || '', group: p.group || '' };
    if (p.group !== 'Тренажеры') plan.moveGroup.push({ ...row, type: 'Спортивное оборудование', to: 'Тренажеры' });
    if (ASK.test(p.name || '') && !WEIGHT.test(p.name || '')) { plan.ask.push(row); continue; }
    if (has.includes(ids.weights) || has.includes(ids.body)) plan.keep.push({ ...row, has: has.includes(ids.weights) ? 'грузы' : 'собственный вес' });
    else (want === ids.weights ? plan.weights : plan.body).push({ ...row, facetValueIds: [...has, want] });
  }
  return plan;
}

if (require.main === module) {
  const [src, valsFile] = process.argv.slice(2);
  const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
  const items = raw.items || raw;
  let ids = { weights: '6aeea9373b8b9255839ab43a', body: '6aeea9373b8b9255839ab43b' }; // значения trn.load на проде (выгрузка 2026-11-10)
  if (valsFile) {
    const v = JSON.parse(fs.readFileSync(valsFile, 'utf8')); const vl = v.items || v;
    const find = (re) => String((vl.find((x) => re.test(x.name || '')) || {}).id || '');
    ids = { weights: find(/^Изменяемая \(грузы\)$/) || ids.weights, body: find(/^Собственный вес$/) || ids.body };
  }
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ids, ...buildPlan(items, ids) }, null, 2) + '\n');
}

module.exports = { buildPlan };
