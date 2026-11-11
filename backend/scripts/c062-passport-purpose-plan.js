/* C062 (2026-11-10): назначение, элементы и способ установки в умолчаниях паспорта изделий (products.passportDefaults).
 * Скрипт ТОЛЬКО собирает план из выгрузки прода (чтение) — в базу не пишет.
 *   node scripts/c062-passport-purpose-plan.js <папка-выгрузки> > docs/crew/C062-passport-purpose/plan.json
 * В папке: showcase.json (GET /api/showcase), products/<id>.json (GET /api/showcase/<id>), elements.json (dicts/passportElements),
 * installs.json (dicts/passportInstall), phrases.json (dicts/passportPhrases), passports.json (GET /api/passports).
 * Правила — docs/crew/C062-passport-purpose/REVIEW.md. Пишем только в пустое; неуверенное — в «вручную».
 * Запись плана: deploy/synology/c062-passport-purpose.sh (по «да» пользователя, кнопкой пульта).
 */
const fs = require('fs');
const path = require('path');

const j = (f) => { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return v.items || v; };

// Правила названия — общий модуль сервера (C078). Скрипт только собирает план.
function loadSuggest() {
  const dist = path.join(__dirname, '../dist/src/common/passport/name-suggest.js');
  if (fs.existsSync(dist)) return require(dist);
  require('ts-node/register/transpile-only');
  return require('../src/common/passport/name-suggest.ts');
}
const { suggestElementNames, suggestPurposeName } = loadSuggest();

// Способ установки: по группе. «Как у большинства» — из выгрузки (≥ 2 заполненных, ≥ 80 % одного значения).
const INSTALL_ASK = /мобильн|подвес|калитк/i;

function build(dir) {
  const items = j(path.join(dir, 'showcase.json')).filter((x) => !x.deletedAt);
  const elements = j(path.join(dir, 'elements.json'));
  const installs = j(path.join(dir, 'installs.json'));
  const phrases = j(path.join(dir, 'phrases.json'));
  const passports = fs.existsSync(path.join(dir, 'passports.json')) ? j(path.join(dir, 'passports.json')) : [];
  const elByName = new Map(elements.map((e) => [e.name, e]));
  const insName = new Map(installs.map((i) => [i.id, i.name]));
  const purposeRoot = phrases.find((p) => p.section === 'purpose' && !p.parentId);
  const leaves = phrases.filter((p) => p.parentId === (purposeRoot || {}).id);
  const catsOf = (r) => String(r.categories || '').split(/[,\s]+/).filter(Boolean);
  const leafFor = (name, cat) => leaves.find((l) => l.name === name && (l.allCategories || catsOf(l).includes(cat)));

  const prod = (id) => JSON.parse(fs.readFileSync(path.join(dir, 'products', `${id}.json`), 'utf8'));
  const defOf = new Map(items.map((s) => [s.id, prod(s.id).passportDefaults || {}]));
  const hasEl = (d) => Array.isArray(d.elements) && d.elements.length > 0;

  // способ установки по группе: что уже выбрано у соседей
  const grp = new Map();
  for (const s of items) {
    const d = defOf.get(s.id);
    if (!d.installationTypeId) continue;
    const g = s.group || '-'; const m = grp.get(g) || new Map(); m.set(d.installationTypeId, (m.get(d.installationTypeId) || 0) + 1); grp.set(g, m);
  }
  const groupInstall = new Map(); // группа → { id, n, total }
  for (const [g, m] of grp) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [id, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (total >= 2 && n / total >= 0.8) groupInstall.set(g, { id, n, total });
  }
  // выпущенные паспорта: способ установки изделия
  const ppInstall = new Map();
  for (const p of passports) if (p.productId && p.installationTypeId && !ppInstall.has(String(p.productId))) ppInstall.set(String(p.productId), String(p.installationTypeId));

  const plan = { at: new Date().toISOString(), rules: { installByGroup: Object.fromEntries([...groupInstall].map(([g, v]) => [g, { type: insName.get(v.id), n: v.n, total: v.total }])) }, set: [], manual: [], skipped: 0 };
  const stats = { elements: 0, purpose: 0, install: 0, manualElements: 0, manualPurpose: 0, manualInstall: 0 };

  for (const s of items) {
    const d = defOf.get(s.id);
    const name = String(s.name || '');
    const cat = d.passportCategory || s.ppCategory || '';
    const row = { id: s.id, sku: s.sku || '', name, group: s.group || '', cat };
    const set = {}; const why = {}; const need = [];

    // --- Элементы ---
    if (!hasEl(d)) {
      const hit = suggestElementNames(name, cat, s.group || '');
      const names = hit ? hit.names : null;
      const how = hit ? hit.how : '';
      const els = (names || []).map((n) => elByName.get(n)).filter(Boolean);
      const badCat = els.filter((e) => cat && !catsOf(e).includes(cat));
      if (names && els.length === names.length && !badCat.length) { set.elements = els.map((e) => e.id); why.elements = `${how}: ${names.join(', ')}`; stats.elements++; }
      else { need.push('Элементы'); stats.manualElements++; if (badCat.length) why.elements = `категория паспорта ${cat} не подходит для «${badCat.map((e) => e.name).join(', ')}»`; }
    }

    // --- Назначение ---
    const choices = d.textChoices || {};
    if (purposeRoot && !choices[purposeRoot.id]) {
      const nm = suggestPurposeName(name, cat, s.group || '')?.name;
      const leaf = nm && leafFor(nm, cat);
      if (leaf) { set.textChoices = { [purposeRoot.id]: leaf.id }; why.purpose = nm; stats.purpose++; }
      else { need.push('Назначение'); stats.manualPurpose++; if (nm && !leaf) why.purpose = `вариант «${nm}» не подходит к категории ${cat || 'без категории'}`; }
    }

    // --- Способ установки ---
    if (!d.installationTypeId) {
      const fromPp = ppInstall.get(s.id);
      const g = groupInstall.get(s.group || '-');
      if (fromPp) { set.installationTypeId = fromPp; why.install = 'из выпущенного паспорта'; stats.install++; }
      else if (g && !INSTALL_ASK.test(name)) { set.installationTypeId = g.id; why.install = `как у группы (${g.n} из ${g.total}): ${insName.get(g.id)}`; stats.install++; }
      else { need.push('Способ установки'); stats.manualInstall++; }
    }

    if (Object.keys(set).length) plan.set.push({ ...row, set, why });
    if (need.length) plan.manual.push({ ...row, need, why });
    if (!Object.keys(set).length && !need.length) plan.skipped++;
  }
  plan.stats = stats;
  return plan;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('укажите папку выгрузки'); process.exit(2); }
  process.stdout.write(JSON.stringify(build(dir), null, 2) + '\n');
}

module.exports = { build };
