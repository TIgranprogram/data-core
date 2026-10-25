/* ПВ (docs/roles/tz/PASSPORT-FUNNEL.md, отчёт — PASSPORT-FUNNEL-data-steward.md): порядок в справочниках «Паспорта»
 * (dict_values: passportPhrases, passportInstall, passportElements, passportMaterials, passportParts, passportDefects,
 * passportSortament, passportCategories, passportStandards). Схему не меняет — только содержимое.
 *
 * Что делает:
 *   1. Дубли — объединяет в одну запись (лучшую): пустые поля оставшейся дописываются из дубля, ссылки изделий
 *      (products) и ЧЕРНОВИКОВ паспортов (productpassports, status: 'draft') переводятся на неё, дубль — в корзину
 *      (deletedAt + mergedInto, как «Объединить» в приложении). Выпущенные и старые паспорта НЕ трогает (у них снимок
 *      текста — решение пользователя 2026-10-25).
 *   2. «Готовые тексты»: пустые копии варианта — в корзину; один текст на несколько категорий — одна запись с галочками
 *      всех категорий; разные тексты одного варианта в одной категории — остаётся эталонный (seed-passport-phrases.js),
 *      похожие — объединяются, непохожие — в «СПОРНЫЕ».
 *   3. Дописывает ПУСТЫЕ поля по решениям ниже (DECISIONS); своё не перезаписывает, кроме явных исправлений
 *      с проверкой «текст на месте = ожидаемый».
 *   Сомнительное — только печатает блоком «СПОРНЫЕ (решает пользователь)», ничего с ним не делает. deleteMany нет.
 *
 *   План (ничего не пишет):  MONGO_URI=… [MONGO_DB=…] node scripts/passport-dicts-cleanup.js [--out plan.json]
 *   Записать:                … --apply      (НА ПРОДЕ — только координатор, после бэкапа и «да» пользователя)
 *   На VM: docker cp backend/scripts/passport-dicts-cleanup.js backend/scripts/seed-passport-phrases.js datacore-backend:/app/scripts/
 */
const path = require('path');
const fs = require('fs');

// ───────── нормализация и похожесть ─────────
const s = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (v) => s(v).toLowerCase().replace(/ё/g, 'е').replace(/[«»"'„“”]/g, '').replace(/[\s.,;:!]+$/, '');
const code = (v) => s(v).toUpperCase();
const csv = (v) => s(v).split(/[,;\n]/).map((x) => x.trim().toUpperCase()).filter(Boolean);
const normSize = (v) => s(v).replace(/\s*мм\.?$/i, '').replace(/^[∅Ø⌀ø]\s*/, '∅').replace(/(\d)\s*[xхXХ*×]\s*(?=\d)/g, '$1×').replace(/(\d)\.(?=\d)/g, '$1,'); // как common/catalog/materials-text.ts
// общие для всех текстов раздела слова («Предназначено для», «Изделие устанавливается») смысла не различают
const STOP = new Set(['пред', 'изде', 'уста', 'для', 'мест', 'обще', 'поль', 'терр', 'площ']);
const stems = (t) => new Set(norm(t).split(/[^a-zа-я0-9]+/).filter((w) => w.length > 2).map((w) => w.slice(0, 4)).filter((w) => !STOP.has(w)));
/** Похожесть по смыслу (грубо), 0…1: Дайс по основам слов; overlap — доля слов короткого текста, которые есть в длинном
 *  (короткий текст ничего не добавляет к длинному → 1). */
function similarity(a, b, overlap = false) {
  const A = stems(a), B = stems(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return overlap ? n / Math.min(A.size, B.size) : (2 * n) / (A.size + B.size);
}
const SIM_MERGE = 0.7; // тот же вариант и категория: от 0,7 слов короткого текста есть в длинном — один смысл, ниже — «спорные»
const SIM_HINT = 0.8; // разные варианты: от 0,8 — показать как возможный дубль (не объединять)

// ───────── эталоны «Готовых текстов» — из seed-passport-phrases.js (один источник) ─────────
function loadEtalon() {
  const src = fs.readFileSync(path.join(__dirname, 'seed-passport-phrases.js'), 'utf8');
  const m = src.match(/const ROWS = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error('Не нашёл ROWS в seed-passport-phrases.js');
  return JSON.parse(m[1]);
}

// ───────── решения хранителя данных (проверка по тексту на месте) ─────────
const L = (...a) => a.join('\n');
const DECISIONS = {
  // Назначение элемента идёт после «Предназначено для:» (passport-compose-parts.ts purposeText) — у 10 элементов из
  // passport-texts-transfer.js оно само начинается с «Предназначено для…» → в паспорте «Предназначено для: Предназначено для…».
  elementPurpose: {
    BASKETBALL_STAND: ['Предназначено для игры в баскетбол.', 'Игра в баскетбол.'],
    VOLLEYBALL_POSTS: ['Предназначено для игры в волейбол.', 'Игра в волейбол.'],
    MINI_FOOTBALL_GOAL: ['Предназначено для игры в мини-футбол.', 'Игра в мини-футбол.'],
    FENCE: ['Предназначено для ограждения территории спортивных и игровых площадок.', 'Ограждение территории спортивных и игровых площадок.'],
    LITTER_BIN: ['Предназначено для сбора мелкого мусора в общественных зонах.', 'Сбор мелкого мусора в общественных зонах.'],
    PERGOLA: ['Предназначено для создания тени, зонирования пространства и организации зон отдыха.', 'Защита от солнца, зонирование пространства и организация зон отдыха.'],
    LEG_TRAINER: ['Предназначено для тренировки мышц ног и ягодиц.', 'Тренировка мышц ног и ягодиц.'],
    CARDIO_TRAINER: ['Предназначено для кардиотренировок и укрепления мышц ног.', 'Кардиотренировки и укрепление мышц ног.'],
    CHEST_BACK_TRAINER: ['Предназначено для тренировки мышц груди и спины.', 'Тренировка мышц груди и спины.'],
    TWISTER: ['Предназначено для тренировки мышц бёдер и талии.', 'Тренировка мышц бёдер и талии.'],
  },
  // Пустые «Правила пользования» и «Что проверять при ТО» — универсальные для любого изделия с этим элементом.
  elementFill: {
    BASKETBALL_STAND: { usageRules: L('Не висеть на кольце и щите', 'Не забираться на стойку и щит', 'Не пользоваться при повреждённом щите или кольце'),
      inspect: L('Прочность крепления стойки в основании', 'Крепление щита и кольца', 'Отсутствие трещин и коррозии на стойке', 'Затяжка резьбовых соединений') },
    VOLLEYBALL_POSTS: { usageRules: L('Натягивать сетку только штатным натяжным устройством', 'Не висеть на сетке и стойках', 'Не забираться на стойки'),
      inspect: L('Прочность крепления стоек в основании', 'Исправность натяжного устройства и крючков', 'Целостность сетки и её крепления', 'Отсутствие коррозии и острых кромок') },
    MINI_FOOTBALL_GOAL: { usageRules: L('Не висеть на перекладине ворот', 'Не забираться на ворота и не раскачивать их', 'Не пользоваться незакреплёнными воротами'),
      inspect: L('Надёжность крепления ворот к основанию: ворота не опрокидываются', 'Целостность сетки и её крепления', 'Отсутствие трещин и коррозии на раме', 'Затяжка крепежа') },
    FENCE: { usageRules: L('Не перелезать через ограждение', 'Не висеть на секциях и не раскачивать их'),
      inspect: L('Неподвижность опорных стоек', 'Целостность секций и их крепления к стойкам', 'Отсутствие острых кромок и выступающих концов', 'Состояние покрытия') },
    LITTER_BIN: { usageRules: L('Не бросать в урну горящие и тлеющие предметы', 'Своевременно освобождать урну от мусора'),
      inspect: L('Прочность крепления урны к основанию', 'Целостность корпуса и вставки', 'Отсутствие острых кромок', 'Состояние покрытия') },
    PERGOLA: { usageRules: L('Не забираться на крышу и конструкции навеса', 'Не подвешивать к конструкции грузы и качели', 'Не находиться под навесом при скоплении снега на крыше'),
      inspect: L('Крепление опор к основанию', 'Целостность кровли и её крепления', 'Отсутствие прогибов и трещин несущих элементов', 'Снег на крыше зимой — счищать своевременно') },
    LEG_TRAINER: { copyFrom: 'MOVING_TRAINER' },
    CARDIO_TRAINER: { copyFrom: 'MOVING_TRAINER' },
    CHEST_BACK_TRAINER: { copyFrom: 'MOVING_TRAINER' },
    TWISTER: { usageRules: L('Вставать на платформу и сходить с неё только при полной остановке', 'Держаться за поручень во время вращения', 'Вращаться плавно, без рывков'),
      inspect: L('Лёгкость и равномерность вращения платформы', 'Состояние подшипникового узла', 'Крепление поручня', 'Затяжка крепежа') },
  },
  // Пустые «Уход и ремонт» и «Типичные дефекты» у материалов (МИ) — как у материала-аналога из seed-passport-dicts.js.
  materialFill: {
    PIPE_STEEL: 'STEEL_GALV*', PIPE_STEEL_PROFILE: 'STEEL_GALV*', SHEET_STEEL: 'STEEL_GALV*', BEAM_STEEL: 'STEEL_GALV*', ROD_STEEL: 'STEEL_GALV*',
    CHAIN_STEEL: 'STEEL_GALV*', CABLE_STEEL: 'STEEL_GALV*', STEEL: 'STEEL_GALV*',
    PIPE_STAINLESS: 'STEEL_STAINLESS', SHEET_STAINLESS: 'STEEL_STAINLESS', CHAIN_STAINLESS: 'STEEL_STAINLESS',
    WOOD_SOFT: 'WOOD_GLUED', WOOD_LARCH: 'WOOD_GLUED', WOOD_LOG: 'WOOD_GLUED',
    PLYWOOD: 'PLYWOOD_LAM', PLYWOOD_FSF: 'PLYWOOD_LAM', PE_HD: 'PE_ROTO', PLASTIC: 'PE_ROTO',
  },
  // «*» — сталь без покрытия: уход общий, без строки про цинк
  steelCare: L('Мыть тёплой водой с мягким моющим средством, без абразивов', 'Сколы покрытия зачищать и подкрашивать ремонтной эмалью по металлу', 'Следить за появлением очагов ржавчины'),
  steelDefects: 'CORROSION, WELD_CRACK, DEFORMATION, LOOSE_THREADS',
};
// Спорные по смыслу — печатаются всегда, если запись есть (решает пользователь)
const WITH_DISPUTED = process.argv.includes('--with-disputed');
const DISPUTED_RULES = [
  { dict: 'passportPhrases', test: (d) => d.section === 'installation' && norm(d.name) === 'ограждение на опорных стойках' && csv(d.categories).some((c) => c === 'TRN' || c === 'DIO'),
    act: () => ({ del: true }), why: 'вариант «Ограждение на опорных стойках» у тренажёров / детского игрового — ограждение относится к благоустройству; предлагаю в корзину' },
  { dict: 'passportInstall', test: (d) => /устанавливается/i.test(s(d.montage).split('\n')[0]),
    act: (d) => ({ set: { montage: String(d.montage ?? '').split(/\r?\n/).slice(1).join('\n').trim() } }), why: 'первая строка «Текста монтажа» — «где ставится» (дублирует «Готовые тексты → Установка» и привязана к виду площадок); предлагаю убрать строку' },
  { dict: 'passportCategories', test: (d) => code(d.code) !== 'ALL' && csv(d.standards).includes('GOST_R_2_610'),
    act: (d) => ({ set: { standards: csv(d.standards).filter((c) => c !== 'GOST_R_2_610').join(', ') } }), why: 'норматив GOST_R_2_610 уже есть у «Для всех» — у категории лишний (предлагаю убрать из списка)' },
];

// ───────── ссылки (по id и по строке) ─────────
const DRAFT = { status: 'draft' };
/** Поля-ссылки по справочнику: [коллекция, фильтр, путь]; путь массива — с [] */
const ID_REFS = {
  passportElements: [['products', {}, 'passportDefaults.elements[]'], ['productpassports', DRAFT, 'elements[]']],
  passportMaterials: [['products', {}, 'passportDefaults.materialIds[]'], ['products', {}, 'materialsSpec.rows[].materialId'], ['products', {}, 'materialsSpec.coatingIds[]'],
    ['productpassports', DRAFT, 'materialIds[]'], ['productpassports', DRAFT, 'materialsSpec.rows[].materialId'], ['productpassports', DRAFT, 'materialsSpec.coatingIds[]']],
  passportInstall: [['products', {}, 'passportDefaults.installationTypeId'], ['productpassports', DRAFT, 'installationTypeId']],
  passportParts: [['products', {}, 'materialsSpec.rows[].partIds[]'], ['productpassports', DRAFT, 'materialsSpec.rows[].partIds[]']],
};
/** Заменить в документе значение по пути (с [] — по всем элементам массива). Возвращает число замен. */
function replaceAt(doc, pathStr, from, to) {
  const parts = pathStr.split('.');
  let n = 0;
  const walk = (obj, i) => {
    if (obj == null || typeof obj !== 'object') return;
    const raw = parts[i]; const arr = raw.endsWith('[]'); const k = arr ? raw.slice(0, -2) : raw; const last = i === parts.length - 1;
    const v = obj[k];
    if (last) {
      if (arr && Array.isArray(v)) {
        const had = v.some((x) => String(x) === String(from));
        if (!had) return;
        const next = []; for (const x of v) { const y = String(x) === String(from) ? to : x; if (!next.some((z) => String(z) === String(y))) next.push(y); }
        obj[k] = next; n++;
      } else if (!arr && v != null && String(v) === String(from)) { obj[k] = to; n++; }
      return;
    }
    if (arr && Array.isArray(v)) v.forEach((x) => walk(x, i + 1)); else walk(v, i + 1);
  };
  walk(doc, 0);
  return n;
}
const topField = (p) => p.split('.')[0].replace('[]', '');

// ───────── план ─────────
const FILLED = (d, skip = []) => Object.entries(d).filter(([k, v]) => !['_id', 'dict', 'createdAt', 'updatedAt', 'deletedAt', ...skip].includes(k) && s(v)).length;
const byOld = (a, b) => (String(a._id) < String(b._id) ? -1 : 1);
const label = (d) => `${d.dict.replace('passport', '')} «${s(d.name) || '(без названия)'}»${d.code ? ' ' + d.code : ''}${d.categories ? ' [' + csv(d.categories).join(', ') + ']' : ''}`;
const clip = (t, n = 80) => { t = s(t); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

async function buildPlan(db) {
  const dv = db.collection('dict_values');
  const all = await dv.find({ dict: { $in: ['passportPhrases', 'passportInstall', 'passportElements', 'passportMaterials', 'passportParts', 'passportDefects', 'passportSortament', 'passportCategories', 'passportStandards'] }, deletedAt: null }).toArray();
  const plan = { merges: [], deletes: [], sets: [], disputed: [], hints: [], empty: [] };
  const gone = new Set();
  const merge = (keep, drop, why, extra = {}) => { gone.add(String(drop._id)); plan.merges.push({ dict: keep.dict, keepId: String(keep._id), dropId: String(drop._id), keep: label(keep), drop: label(drop), why, ...extra }); };
  const setOn = (d, set, why) => { if (Object.keys(set).length) plan.sets.push({ dict: d.dict, id: String(d._id), label: label(d), set, why }); };
  const of = (dict) => all.filter((d) => d.dict === dict && !gone.has(String(d._id)));

  // 1) справочники с кодом / ключом: одинаковый код (или ключ) — одна запись
  const KEY = {
    passportElements: (d) => code(d.code), passportMaterials: (d) => code(d.code), passportDefects: (d) => code(d.code), passportInstall: (d) => code(d.code),
    passportStandards: (d) => code(d.code), passportCategories: (d) => code(d.code), passportParts: (d) => norm(d.name), passportSortament: (d) => `${code(d.material)}|${norm(normSize(d.name))}`,
  };
  for (const [dict, key] of Object.entries(KEY)) {
    const groups = new Map();
    for (const d of of(dict)) {
      const k = key(d);
      if (!k || k === '|') { if (!s(d.name) && !s(d.code)) { plan.deletes.push({ dict, id: String(d._id), label: label(d), why: 'пустая запись (нет ни названия, ни кода)' }); gone.add(String(d._id)); } else plan.disputed.push({ label: label(d), why: 'нет кода — не к чему привязать' }); continue; }
      if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d);
    }
    for (const [k, list] of groups) {
      if (list.length < 2) continue;
      const [keep, ...rest] = [...list].sort((a, b) => FILLED(b) - FILLED(a) || byOld(a, b));
      const fill = {};
      for (const r of rest) {
        merge(keep, r, `тот же ${dict === 'passportParts' ? 'название' : dict === 'passportSortament' ? 'размер' : 'код'} ${k}`, dict === 'passportSortament' ? { sizeFrom: s(r.name), sizeTo: s(keep.name), material: code(keep.material) } : {});
        for (const [f, v] of Object.entries(r)) if (!['_id', 'createdAt', 'updatedAt', 'deletedAt', 'mergedInto'].includes(f) && s(v) && !s(keep[f]) && !(f in fill)) fill[f] = v;
      }
      setOn(keep, fill, 'дописать пустые поля из объединённых дублей');
    }
    // одинаковое название при разных кодах — не угадываем
    if (dict !== 'passportParts' && dict !== 'passportSortament') {
      const byName = new Map();
      for (const d of of(dict)) { const n = norm(d.name); if (!n) continue; if (!byName.has(n)) byName.set(n, []); byName.get(n).push(d); }
      for (const list of byName.values()) if (list.length > 1) plan.disputed.push({ label: list.map(label).join(' / '), why: 'одно название — разные коды: один смысл или разные записи?' });
    }
  }

  // 2) «Готовые тексты паспорта»
  const etalon = loadEtalon();
  const etText = (section, cat, name) => etalon.find((r) => r.section === section && r.categories === cat && norm(r.name) === norm(name))?.text;
  const isEtalon = (d) => csv(d.categories).some((c) => norm(etText(d.section, c, d.name)) === norm(d.text));
  const phrases = () => of('passportPhrases');
  // 2а) пустые
  for (const d of phrases().filter((x) => !s(x.text))) {
    const cats = csv(d.categories);
    const full = phrases().find((x) => x !== d && s(x.text) && x.section === d.section && norm(x.name) === norm(d.name) && cats.every((c) => csv(x.categories).includes(c)));
    if (!s(d.name)) { plan.deletes.push({ dict: d.dict, id: String(d._id), label: label(d), why: 'пустая запись: нет ни названия, ни текста' }); gone.add(String(d._id)); continue; }
    if (full) { merge(full, d, 'пустая копия варианта — текст есть в другой записи'); continue; }
    const texts = [...new Set(cats.map((c) => etText(d.section, c, d.name)).filter(Boolean))];
    if (cats.length && texts.length === 1 && cats.every((c) => etText(d.section, c, d.name))) { setOn(d, { text: texts[0] }, 'пустой текст — вписать эталон'); d.text = texts[0]; continue; }
    plan.empty.push({ label: label(d), why: 'пустой текст, эталона нет — вписать или в корзину' });
  }
  // 2б) один текст — одна запись (галочки всех категорий)
  const exact = new Map();
  for (const d of phrases().filter((x) => s(x.text))) { const k = `${d.section}|${norm(d.text)}`; if (!exact.has(k)) exact.set(k, []); exact.get(k).push(d); }
  for (const list of exact.values()) {
    if (list.length < 2) continue;
    if (new Set(list.map((d) => norm(d.name))).size > 1) { plan.disputed.push({ label: list.map(label).join(' / '), why: `один текст под разными названиями варианта: «${clip(list[0].text)}»` }); continue; }
    const [keep, ...rest] = [...list].sort(byOld);
    const cats = [...new Set(list.flatMap((d) => csv(d.categories)))];
    for (const r of rest) merge(keep, r, 'тот же текст в другой категории — одна запись, галочки обеих категорий', { textFrom: s(r.text), textTo: s(keep.text), section: r.section, cats: csv(r.categories) });
    if (cats.join(', ') !== csv(keep.categories).join(', ')) { setOn(keep, { categories: cats.join(', ') }, 'категории объединённых записей'); keep.categories = cats.join(', '); }
  }
  // 2в) один вариант и категория — один текст
  const live = phrases().filter((x) => s(x.text));
  const seen = new Set();
  for (const a of live) {
    if (gone.has(String(a._id)) || seen.has(a)) continue;
    const rivals = live.filter((b) => b !== a && !gone.has(String(b._id)) && b.section === a.section && norm(b.name) === norm(a.name) && csv(b.categories).some((c) => csv(a.categories).includes(c)));
    if (!rivals.length) continue;
    const group = [a, ...rivals].sort((x, y) => Number(isEtalon(y)) - Number(isEtalon(x)) || s(y.text).length - s(x.text).length || byOld(x, y));
    group.forEach((x) => seen.add(x));
    const keep = group[0];
    for (const r of group.slice(1)) {
      const sim = similarity(keep.text, r.text, true);
      const sub = csv(r.categories).every((c) => csv(keep.categories).includes(c));
      if (sim >= SIM_MERGE && sub) merge(keep, r, `тот же смысл (похожесть ${sim.toFixed(2)}), остаётся ${isEtalon(keep) ? 'эталон' : 'более полный'}`, { textFrom: s(r.text), textTo: s(keep.text), section: r.section, cats: csv(r.categories) });
      else plan.disputed.push({ label: `${label(keep)} / ${label(r)}`, why: `разные тексты одного варианта (похожесть ${sim.toFixed(2)}${sub ? '' : ', у второго другие категории'}): «${clip(keep.text, 60)}» / «${clip(r.text, 60)}»` });
    }
  }
  // 2г) похожие тексты под разными вариантами — только подсказка
  const rest2 = phrases().filter((x) => s(x.text));
  for (let i = 0; i < rest2.length; i++) for (let j = i + 1; j < rest2.length; j++) {
    const a = rest2[i], b = rest2[j];
    if (a.section !== b.section || norm(a.name) === norm(b.name) || !csv(a.categories).some((c) => csv(b.categories).includes(c))) continue;
    const sim = similarity(a.text, b.text);
    if (sim >= SIM_HINT) plan.hints.push({ label: `${label(a)} / ${label(b)}`, why: `похожие тексты (${sim.toFixed(2)}) у разных вариантов` });
  }

  // 3) решения: исправления и дописывание пустого
  const byCode = (dict, c) => of(dict).find((d) => code(d.code) === c);
  for (const d of of('passportElements')) {
    const c = code(d.code); const set = {};
    const fix = DECISIONS.elementPurpose[c];
    if (fix && norm(d.purpose) === norm(fix[0])) set.purpose = fix[1];
    else if (/^предназначен/i.test(s(d.purpose))) plan.disputed.push({ label: label(d), why: `«Назначение» начинается с «Предназначено…» — в паспорте выйдет «Предназначено для: Предназначено…»: «${clip(d.purpose)}»` });
    const f = DECISIONS.elementFill[c];
    const src = f?.copyFrom ? byCode('passportElements', f.copyFrom) : f;
    for (const k of ['usageRules', 'inspect']) if (src && s(src[k]) && !s(d[k])) set[k] = src[k];
    setOn(d, set, f?.copyFrom ? `исправить назначение / дописать правила и ТО как у ${f.copyFrom}` : 'исправить назначение / дописать правила и ТО');
    if (!s(d.inDescription) && !s(d.purpose) && !s(d.usageRules) && !s(d.inspect) && !set.usageRules) plan.empty.push({ label: label(d), why: 'элемент без текстов (описание, назначение, правила, ТО)' });
  }
  for (const d of of('passportMaterials')) {
    const a = DECISIONS.materialFill[code(d.code)]; if (!a || s(d.kind) === 'coating') continue;
    const plain = a.endsWith('*'); const src = byCode('passportMaterials', a.replace('*', ''));
    const set = {};
    const care = plain ? DECISIONS.steelCare : src?.care; const defects = plain ? DECISIONS.steelDefects : src?.defects;
    if (s(care) && !s(d.care)) set.care = care;
    if (s(defects) && !s(d.defects)) set.defects = defects;
    setOn(d, set, `уход и дефекты — как у ${plain ? 'стали' : a}`);
  }
  for (const d of of('passportInstall')) if (!s(d.montage)) plan.empty.push({ label: label(d), why: 'способ установки без текста монтажа' });
  for (const d of of('passportDefects')) if (!s(d.measure)) plan.empty.push({ label: label(d), why: 'дефект без меры' });
  // --with-disputed: решение пользователя 2026-10-25 по спорным — применить предложенное (в корзину / убрать строку / норматив)
  for (const r of DISPUTED_RULES) for (const d of of(r.dict).filter(r.test)) {
    if (!WITH_DISPUTED) { plan.disputed.push({ label: label(d), why: r.why }); continue; }
    const a = r.act(d);
    if (a.del) plan.deletes.push({ dict: r.dict, id: String(d._id), label: label(d), why: 'спорное, решение пользователя: ' + r.why });
    else plan.sets.push({ dict: r.dict, id: String(d._id), label: label(d), set: a.set, why: 'спорное, решение пользователя: ' + r.why });
  }
  return plan;
}

// ───────── запись ─────────
async function applyPlan(db, plan, { ObjectId, now = new Date() }) {
  const dv = db.collection('dict_values');
  const oid = (x) => new ObjectId(String(x));
  const out = { sets: 0, merged: 0, deleted: 0, products: 0, drafts: 0 };
  for (const x of plan.sets) out.sets += (await dv.updateOne({ _id: oid(x.id), deletedAt: null }, { $set: { ...x.set, updatedAt: now } })).modifiedCount;
  for (const m of plan.merges) {
    const from = oid(m.dropId), to = oid(m.keepId);
    for (const [coll, filter, p] of ID_REFS[m.dict] || []) {
      const top = topField(p);
      const docs = await db.collection(coll).find({ ...filter, [p.replace(/\[\]/g, '')]: from }).toArray();
      for (const doc of docs) if (replaceAt(doc, p, from, to)) { await db.collection(coll).updateOne({ _id: doc._id }, { $set: { [top]: doc[top], updatedAt: now } }); out[coll === 'products' ? 'products' : 'drafts']++; }
    }
    if (m.dict === 'passportSortament' && m.sizeFrom !== m.sizeTo) { // размер — строкой в таблице материалов
      const mats = (await dv.find({ dict: 'passportMaterials', code: m.material }).toArray()).map((d) => String(d._id));
      for (const [coll, filter] of [['products', {}], ['productpassports', DRAFT]]) {
        for (const doc of await db.collection(coll).find({ ...filter, 'materialsSpec.rows.sizes': m.sizeFrom }).toArray()) {
          let n = 0;
          for (const row of doc.materialsSpec?.rows || []) if (mats.includes(String(row.materialId)) && Array.isArray(row.sizes) && row.sizes.includes(m.sizeFrom)) { row.sizes = [...new Set(row.sizes.map((z) => (z === m.sizeFrom ? m.sizeTo : z)))]; n++; }
          if (n) { await db.collection(coll).updateOne({ _id: doc._id }, { $set: { materialsSpec: doc.materialsSpec, updatedAt: now } }); out[coll === 'products' ? 'products' : 'drafts']++; }
        }
      }
    }
    if (m.dict === 'passportPhrases' && m.textFrom && m.textFrom !== m.textTo) { // черновики хранят сам текст
      const f = m.section === 'installation' ? 'installationMethod' : 'purpose';
      const q = { ...DRAFT, deletedAt: null, [f]: m.textFrom, ...(m.cats?.length ? { passportCategory: { $in: m.cats } } : {}) };
      out.drafts += (await db.collection('productpassports').updateMany(q, { $set: { [f]: m.textTo, updatedAt: now } })).modifiedCount;
    }
    out.merged += (await dv.updateOne({ _id: from, deletedAt: null }, { $set: { deletedAt: now, mergedInto: to, updatedAt: now } })).modifiedCount;
  }
  for (const d of plan.deletes) out.deleted += (await dv.updateOne({ _id: oid(d.id), deletedAt: null }, { $set: { deletedAt: now, updatedAt: now } })).modifiedCount;
  return out;
}

function printPlan(plan, log = console.log) {
  log(`Объединить: ${plan.merges.length} · в корзину (пустые): ${plan.deletes.length} · дописать / исправить: ${plan.sets.length} · спорные: ${plan.disputed.length}`);
  if (plan.merges.length) { log('\nОБЪЕДИНИТЬ (дубль → остаётся):'); for (const m of plan.merges) log(`  ${m.drop}  →  ${m.keep}   · ${m.why}`); }
  if (plan.deletes.length) { log('\nВ КОРЗИНУ:'); for (const d of plan.deletes) log(`  ${d.label} · ${d.why}`); }
  if (plan.sets.length) { log('\nДОПИСАТЬ / ИСПРАВИТЬ:'); for (const x of plan.sets) log(`  ${x.label}: ${Object.entries(x.set).map(([k, v]) => `${k} = «${clip(v, 60)}»`).join('; ')} · ${x.why}`); }
  if (plan.empty.length) { log('\nПУСТЫЕ — дописать вручную:'); for (const x of plan.empty) log(`  ${x.label} · ${x.why}`); }
  if (plan.disputed.length) { log('\nСПОРНЫЕ (решает пользователь, скрипт не трогает):'); for (const x of plan.disputed) log(`  ${x.label} · ${x.why}`); }
  if (plan.hints.length) { log('\nПОХОЖИЕ ТЕКСТЫ РАЗНЫХ ВАРИАНТОВ (для сведения):'); for (const x of plan.hints) log(`  ${x.label} · ${x.why}`); }
}

module.exports = { buildPlan, applyPlan, printPlan, similarity, norm, replaceAt, DECISIONS };

if (require.main === module) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); const outFile = i > 0 ? process.argv[i + 1] : null;
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const plan = await buildPlan(db);
    printPlan(plan);
    if (outFile) { fs.writeFileSync(outFile, JSON.stringify(plan, null, 2)); console.log(`\nПлан записан: ${outFile}`); }
    if (!apply) { console.log('\nНичего не записано. Записать: --apply'); return; }
    const r = await applyPlan(db, plan, { ObjectId });
    console.log(`\nГотово: дописано ${r.sets}, объединено ${r.merged}, в корзину ${r.deleted}; ссылки переведены — изделий ${r.products}, черновиков ${r.drafts}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
