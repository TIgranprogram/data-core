/* C063 (2026-11-10, пользователь: «Конструкция + материалы» — массово закрыть пункты паспорта).
 * Только собирает план из выгрузки прода (папка с <id>.json и <id>.from.json от datacore-access) — в базу не пишет.
 *   node scripts/c063-joints-materials-plan.js <папка-выгрузки> > docs/crew/C063-joints-materials/plan.json
 * Правила (только пустые поля; неуверенное — в «вручную», не пишется):
 *   конструкция (passportDefaults.joints): в составе болты/винты/гайки/шпильки/саморезы → bolts;
 *     металлопрокат (труба, профиль, лист, уголок, швеллер, арматура, полоса, круг) → welds;
 *     ничего из этого или состава нет → вручную.
 *   материалы (materialsSpec): таблица пустая и «Взять из состава» дал строки → берём предложение сервера.
 * Записывает deploy/synology/c063-joints-materials.sh — по «да» пользователя (кнопка пульта).
 */
const fs = require('fs');
const path = require('path');

const BOLTS = /болт|винт|гайк|шпильк|саморез|шуруп|анкер/i;
const METAL = /труб|профил|лист|уголок|швеллер|арматур|полос|круг\b|двутавр|сталь/i;

/** Чистая функция: изделие (+ предложение материалов) → { joints?, spec?, why }. */
function decide(p, from) {
  const out = { id: p.id, sku: p.sku || '', name: p.name || '', group: p.group || '', category: p.ppCategory || '' };
  const comp = p.composition || [];
  const names = comp.map((l) => `${l.name || ''} ${l.kind || ''}`);
  const hasJoints = (p.passportDefaults?.joints || []).length > 0;
  if (!hasJoints) {
    const j = [];
    if (comp.some((l) => l.kind === 'fastener') || names.some((n) => BOLTS.test(n))) j.push('bolts');
    if (comp.some((l) => l.kind === 'raw') || names.some((n) => METAL.test(n))) j.push('welds');
    if (j.length) out.joints = j;
    else out.jointsManual = comp.length ? 'в составе нет ни метизов, ни металлопроката' : 'состав не заполнен';
  }
  const specEmpty = !(p.materialsSpec?.rows || []).length;
  if (specEmpty) {
    const rows = from?.materialsSpec?.rows || [];
    if (rows.length) { out.spec = from.materialsSpec; out.unmatched = from.unmatched || []; }
    else out.specManual = comp.length ? (from?.unmatched?.length ? `в справочнике нет: ${from.unmatched.join(', ')}` : 'в составе нет материалов склада') : 'состав не заполнен';
  }
  return out;
}

function buildPlan(dir) {
  const plan = { joints: [], spec: [], jointsManual: [], specManual: [] };
  for (const f of fs.readdirSync(dir).filter((x) => /^[0-9a-f]{24}\.json$/.test(x))) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const fromF = path.join(dir, f.replace('.json', '.from.json'));
    const from = fs.existsSync(fromF) ? JSON.parse(fs.readFileSync(fromF, 'utf8')) : null;
    const d = decide(p, from);
    const row = { id: d.id, sku: d.sku, name: d.name, group: d.group, category: d.category };
    if (d.joints) plan.joints.push({ ...row, joints: d.joints });
    if (d.jointsManual) plan.jointsManual.push({ ...row, why: d.jointsManual });
    if (d.spec) plan.spec.push({ ...row, materialsSpec: d.spec, rows: d.spec.rows.length, unmatched: d.unmatched });
    if (d.specManual) plan.specManual.push({ ...row, why: d.specManual });
  }
  const bySku = (a, b) => String(a.sku).localeCompare(String(b.sku), 'ru', { numeric: true });
  for (const k of Object.keys(plan)) plan[k].sort(bySku);
  return plan;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('укажите папку выгрузки'); process.exit(2); }
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...buildPlan(dir) }, null, 2) + '\n');
}

module.exports = { decide, buildPlan };
