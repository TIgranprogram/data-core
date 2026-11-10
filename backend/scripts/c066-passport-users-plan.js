/* C066 (2026-11-10): maxUsers / age* / height* / weightMax в products.passportDefaults.
 * Только собирает план из выгрузки (чтение) — в базу не пишет.
 *   node scripts/c066-passport-users-plan.js <папка-выгрузки> > docs/crew/C066-passport-users/plan.json
 * В папке: showcase.json, products/<id>.json, passports.json (выпущенные с числами).
 * Правила — docs/crew/C066-passport-users/REVIEW.md.
 * Запись: deploy/synology/c066-passport-users.sh (кнопка пульта, по «да»).
 */
const fs = require('fs');
const path = require('path');

const FIELDS = ['maxUsers', 'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax'];
/** Какие из полей C066 обязательны для выпуска по категории (passport-rules V2_REQUIRED_FIELDS). Остальные — только если есть надёжный источник. */
const NEED = {
  DIO: ['ageFrom', 'ageTo', 'maxUsers'],
  DSP: ['ageFrom', 'maxUsers'],
  TRN: ['heightMin', 'weightMax', 'maxUsers'],
  WRK: ['maxUsers'],
  BLG: [],
};
const empty = (v) => v === undefined || v === null || v === '';
const num = (v) => {
  if (empty(v)) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const j = (f) => { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return v.items || v; };

/** Значение поля у большинства в группе: ≥2 заполненных и ≥80 % одного числа. */
function groupMajority(items, defOf, field) {
  const by = new Map(); // group → Map(value → count)
  for (const s of items) {
    const g = s.group || '-';
    const v = num((defOf.get(s.id) || {})[field]);
    if (v == null) continue;
    const m = by.get(g) || new Map();
    m.set(v, (m.get(v) || 0) + 1);
    by.set(g, m);
  }
  const out = new Map();
  for (const [g, m] of by) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [val, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (total >= 2 && n / total >= 0.8) out.set(g, { value: val, n, total });
  }
  return out;
}

function build(dir) {
  const items = j(path.join(dir, 'showcase.json')).filter((x) => !x.deletedAt);
  const passports = fs.existsSync(path.join(dir, 'passports.json')) ? j(path.join(dir, 'passports.json')) : [];
  const prodPath = (id) => path.join(dir, 'products', `${id}.json`);
  const prod = (id) => (fs.existsSync(prodPath(id)) ? JSON.parse(fs.readFileSync(prodPath(id), 'utf8')) : {});
  const defOf = new Map(items.map((s) => [s.id, (prod(s.id).passportDefaults || {})]));

  // выпущенный паспорт → числа по productId (первый с любым числом; позже заполненные важнее пустых)
  const ppBy = new Map();
  for (const p of passports) {
    const pid = String(p.productId || '');
    if (!pid || (p.status && p.status !== 'issued')) continue;
    const cur = ppBy.get(pid) || {};
    for (const f of FIELDS) {
      const v = num(p[f]);
      if (v != null && cur[f] == null) cur[f] = v;
    }
    ppBy.set(pid, cur);
  }

  const maj = Object.fromEntries(FIELDS.map((f) => [f, groupMajority(items, defOf, f)]));
  const plan = {
    at: new Date().toISOString(),
    rules: {
      group: Object.fromEntries(FIELDS.map((f) => [f, Object.fromEntries([...maj[f]].map(([g, v]) => [g, v]))])),
      trainersMaxUsers: 1,
    },
    set: [],
    manual: [],
    skipped: 0,
    stats: Object.fromEntries(FIELDS.flatMap((f) => [[f, 0], [`manual_${f}`, 0]])),
  };

  for (const s of items) {
    const d = defOf.get(s.id) || {};
    const cat = d.passportCategory || s.ppCategory || '';
    const isTrn = cat === 'TRN' || /тренаж/i.test(String(s.group || '')) || /тренаж/i.test(String(s.name || ''));
    const required = new Set(NEED[cat] || []);
    const row = { id: s.id, sku: s.sku || '', name: s.name || '', group: s.group || '', cat };
    const set = {}; const why = {}; const need = [];
    const fromPp = ppBy.get(s.id) || {};

    for (const f of FIELDS) {
      if (!empty(d[f])) continue;
      const pp = fromPp[f];
      const g = maj[f].get(s.group || '-');
      let got = null; let how = '';
      if (pp != null) { got = pp; how = 'из выпущенного паспорта'; }
      else if (f === 'maxUsers' && isTrn) { got = 1; how = 'тренажёр → 1'; }
      else if (g) { got = g.value; how = `как у группы (${g.n} из ${g.total})`; }
      if (got != null) { set[f] = got; why[f] = how; plan.stats[f]++; }
      else if (required.has(f)) { need.push(f); plan.stats[`manual_${f}`]++; }
      // необязательное для категории и без источника — пропускаем (не «вручную»)
    }

    if (Object.keys(set).length) plan.set.push({ ...row, set, why });
    if (need.length) plan.manual.push({ ...row, need, why });
    if (!Object.keys(set).length && !need.length) plan.skipped++;
  }
  return plan;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('укажите папку выгрузки'); process.exit(2); }
  process.stdout.write(`${JSON.stringify(build(dir), null, 2)}\n`);
}
module.exports = { build, FIELDS };
