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

// ---------- Элементы: слова названия → элемент справочника ----------
// Одиночные изделия: порядок важен (первое совпавшее). Значение — имя элемента в справочнике «Элементы».
const SINGLE = [
  [/навес над|помост|судейск|подъем для трибун|подъём для трибун|трибун|амфитеатр/i, null],
  [/баскетболь/i, 'Баскетбольная стойка'],
  [/стойки волейбол|волейбольн/i, 'Волейбольные стойки'],
  [/ворота мини-футбол/i, 'Ворота для мини-футбола'],
  [/скамья для пресса/i, 'Скамья для пресса'],
  [/беседка/i, 'Беседка'],
  [/пергола/i, 'Навес / пергола'],
  [/велопарковк/i, 'Велопарковка'],
  [/урна|урны/i, 'Урна'],
  [/вазон/i, 'Вазон / цветочница'],
  [/приствольн/i, 'Приствольная решётка'],
  [/^(стенд информационный|информационный стенд|стенд)$/i, 'Информационный стенд'],
  [/(?:^|\s)качел[иь]|качели/i, 'Качели'],
  [/карусел/i, 'Карусель'],
  [/балансир/i, 'Балансир'],
  [/^(секция ограждения|ограждение)/i, 'Ограждение площадки'],
  [/^(уличный стол|шахматный стол)/i, 'Стол уличный'],
  [/^(скамья|скамейка)(?!.*пресс)/i, 'Скамья'],
];
// Тренажёры (по названию; только если категория паспорта ТРН)
const TRAINER = [
  [/вело|орбитрек|эллип|степ|лыжник|скороход.*вело/i, 'Кардиотренажёр'],
  [/твист|диск/i, 'Твистер'],
  [/хипс|шейкер|маятник|скороход|покрышк/i, 'Тренажёр с подвижными узлами'],
  [/ног|присед|разгибан|сгибан|становая|отведени/i, 'Тренажёр для мышц ног и ягодиц'],
  [/жим|тяга|подтяг|бицепс|трицепс|сведение|гравитрон|мультиштанг|верхняя тяга|гребная|рычажная/i, 'Тренажёр для мышц груди и спины'],
];
// Составные воркаут-изделия: слова названия → элементы; слово без элемента (кольца, канат…) — вручную
const TOKENS = [
  [/турник|перекладин/i, 'Турник'],
  [/брусья|брусьев/i, 'Брусья'],
  [/шведск\w* стенк|стенк/i, 'Шведская стенка'],
  [/рукоход/i, 'Рукоход'],
  [/скамья для пресса|пресс/i, 'Скамья для пресса'],
  [/скамь|скамей/i, 'Скамья'],
];
const UNCOVERED = /кольц(?!ев)|канат|скалодром|разметк|прыжок|измерен|помост|информационн|столб|мишен|ворота/i;

// ---------- Назначение: название → вариант раздела «Назначение» (по имени варианта) ----------
const PURPOSE = [
  [/навес/i, 'Навес, беседка'],
  [/баскетболь/i, 'Баскетбол'],
  [/волейбол/i, 'Волейбол'],
  [/ворота мини-футбол|футбол/i, 'Футбол'],
  [/комплекс воркаут|воркаут площадка|спорткомплекс воркаут|спортивный комплекс|гексагон/i, 'Комплекс с собственным весом'],
  [/гто|испытан/i, 'Испытания ГТО'],
  [/единоборств|боксерск|набивания/i, 'Единоборства'],
  [/скамья для пресса|гимнастическ\w* скамь|горизонтальн\w* скамь|скамья горизонтальн/i, 'Гимнастика, пресс'],
  [/шведск\w* стенк/i, 'Шведская стенка'],
  [/кольц|канат|скалодром/i, 'Кольца, канат, скалодром'],
  [/турник|перекладин|рукоход/i, 'Турник, рукоход'],
  [/брусья/i, 'Брусья'],
  [/элемент|полоса препятств/i, 'Полоса препятствий'],
  [/трибун|амфитеатр|судейск/i, 'Зрительские места'],
];
const PURPOSE_TRN = [
  [/вело|орбитрек|эллип|степ|лыжник|скороход/i, 'Кардио'],
  [/твист|диск|хипс|шейкер|маятник|покрышк/i, 'Разминка суставов'],
  [/пресс|гиперэкстенз/i, 'Пресс'],
  [/жим\+подтяг|подтягивание\+жим|жим\+подтягив|мультиштанг|гравитрон/i, 'Комплексный'],
  [/ног|присед|разгибан|сгибан|становая|отведени/i, 'Ноги'],
  [/подтяг|тяга|гребная|рычажная|верхняя/i, 'Спина'],
  [/жим|бицепс|трицепс|сведение/i, 'Грудь, плечи, руки'],
];
const PURPOSE_BLG = [
  [/навес|беседк|пергол/i, 'Навес, беседка'],
  [/урна|урны/i, 'Сбор мусора'],
  [/секция огражд|ограждени|калитк|опорный столб|столбик|стойка со-|модульн\w* оград/i, 'Ограждение'],
  [/стенд|стела|указател|табличк|навигац/i, 'Информирование'],
  [/вазон|приствольн|озелен/i, 'Озеленение'],
  [/фонарь|освещ/i, 'Освещение'],
  [/скамь|скамейк|пуфик|пенёк|пенек|кресло|шезлонг|гамак|стол/i, 'Отдых'],
  [/трибун|амфитеатр/i, 'Зрительские места'],
];
const PURPOSE_DIO = [
  [/качел|карусел|качалк|балансир|песочниц|игров|горка|сетка/i, 'Игровое'],
];

// ---------- Способ установки: по группе ----------
// Правило «как у большинства изделий группы»: берётся из выгрузки (≥ 2 заполненных, ≥ 80 % одного значения).
const INSTALL_ASK = /мобильн|подвес|калитк/i;

const first = (rules, s) => { for (const [re, v] of rules) if (re.test(s)) return v; return undefined; };

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
      let names; let how = '';
      const one = first(SINGLE, name);
      if (one === null) names = null;
      else if (one) { names = [one]; how = 'по названию'; }
      else if (cat === 'TRN' && /тренаж|жим|тяга|присед|подтяг|вело|степ|орбитрек|эллип|твист|диск|хипс|шейкер|маятник|скороход|гравитрон|мультиштанг|гребная|бицепс|трицепс|сведен|лыжник|покрышк|разгибан|сгибан|ног/i.test(name) && !/пресс|гиперэкстенз/i.test(name)) {
        const t = first(TRAINER, name); if (t) { names = [t]; how = 'тренажёр по названию'; }
      } else if (s.group === 'Воркаут' || /турник|брусья|рукоход|шведск/i.test(name)) {
        if (!UNCOVERED.test(name.replace(/комплекс воркаут/i, ''))) {
          const got = []; for (const [re, el] of TOKENS) if (re.test(name) && !got.includes(el)) got.push(el);
          if (got.includes('Скамья для пресса')) { const i = got.indexOf('Скамья'); if (i >= 0) got.splice(i, 1); }
          if (got.length) { names = got; how = 'состав по названию'; }
        }
      }
      const els = (names || []).map((n) => elByName.get(n)).filter(Boolean);
      const badCat = els.filter((e) => cat && !catsOf(e).includes(cat));
      if (names && els.length === names.length && !badCat.length) { set.elements = els.map((e) => e.id); why.elements = `${how}: ${names.join(', ')}`; stats.elements++; }
      else { need.push('Элементы'); stats.manualElements++; if (badCat.length) why.elements = `категория паспорта ${cat} не подходит для «${badCat.map((e) => e.name).join(', ')}»`; }
    }

    // --- Назначение ---
    const choices = d.textChoices || {};
    if (purposeRoot && !choices[purposeRoot.id]) {
      let nm;
      if (cat === 'TRN') nm = first(PURPOSE_TRN, name);
      else if (cat === 'BLG') nm = first(PURPOSE_BLG, name) || (s.group && /^Благоустройство/.test(s.group) ? 'Прочее благоустройство' : undefined);
      else if (cat === 'DIO') nm = first(PURPOSE_DIO, name);
      else if (cat === 'WRK') nm = first(PURPOSE, name) || first(PURPOSE_BLG, name);
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
