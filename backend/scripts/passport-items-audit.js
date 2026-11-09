#!/usr/bin/env node
/**
 * C054 B4: аудит пунктов «Для всех» и записей справочников паспорта → признаки (traits) и условия (when).
 *
 *   node backend/scripts/passport-items-audit.js            отчёт docs/crew/C054-passport-funnel/AUDIT.md (ничего не меняет)
 *   node backend/scripts/passport-items-audit.js --apply    when в backend/scripts/passport-texts.v2.json + apply-plan.json
 *                                                            (план PATCH для прода; сам на прод не пишет)
 *   --decisions <файл.json>   решения по спорным: { "mounting/p7": "concrete" | "keep" } (keep — не трогать); без решения спорные пропускаются
 *   --data <папка>  --texts <файл>  --out <папка>   другие пути (тесты)
 *
 * Читает только локальные выгрузки (docs/crew/C054-passport-funnel/data/) и тексты из кода. Базу и прод не трогает.
 * Выданные паспорта и паспорт 597 не меняются: скрипт их только читает для проверки.
 * Признаки и условия — как в backend/src/common/passport/traits.ts (10 кодов; пробел — И, | — ИЛИ, ! — НЕ).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const TRAITS = ['bolts', 'welds', 'metal', 'wood', 'concrete', 'anchors', 'freestanding', 'moving', 'walkable', 'atTree'];
const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_DATA = path.join(ROOT, 'docs', 'crew', 'C054-passport-funnel', 'data');
const DEFAULT_OUT = path.join(ROOT, 'docs', 'crew', 'C054-passport-funnel');
const DEFAULT_TEXTS = path.join(__dirname, 'passport-texts.v2.json');
const MAX_DISPUTED = 40;

const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е');

/** Правила слов. strong — слово однозначно про признак; weak — подсказка, нужен взгляд человека. not — условие «не». */
const RULES = [
  { trait: 'concrete', strong: /бетониру|забетонир|бетонировани/, weak: /бетон|фундамент|скважин|вертикальност|стойк/ },
  { trait: 'anchors', strong: /анкер|шпильк/, weak: /закладн/ },
  { trait: 'bolts', strong: /болт|резьб/, weak: /затяж|крепеж|крепёж|гайк|винт/ },
  { trait: 'welds', strong: /сварн|\bшв[аоы]\w*/, weak: /прива/ },
  { trait: 'wood', strong: /древесин|деревян|гниен/, weak: /дерев/ },
  { trait: 'moving', strong: /подвижн|подшипн|люфт|качел|вращающ/, weak: /шарнир|качан|раскачива/ },
  { trait: 'freestanding', strong: /свободностоящ|без крепления/, weak: /проседани|просадк|уклон/ },
  { trait: 'atTree', strong: /корн\S*\s+дерев/, weak: /приствольн/, not: true },
  { trait: 'walkable', strong: /по решетк\S* можно ходить/, weak: /встава|наступа|ходить/, not: true },
];

/** Слова текста → признаки. { hits:[{trait,word,strong,not}] }. «корней деревьев» не считается деревом (wood). */
function scan(text) {
  const t = norm(text);
  const hits = [];
  for (const r of RULES) {
    let strong = false;
    let m = (r.trait === 'wood' ? t.replace(/корн\S*\s+дерев\S*/g, ' ') : t).match(r.strong);
    if (m) strong = true; else m = (r.trait === 'wood' ? t.replace(/корн\S*\s+дерев\S*/g, ' ') : t).match(r.weak);
    if (m) hits.push({ trait: r.trait, word: m[0], strong, not: !!r.not });
  }
  return hits;
}

/** hits → предложение { when, why, sure }. Нет слов — null (пункт общий). */
function suggest(text) {
  const hits = scan(text);
  if (!hits.length) return null;
  const pos = hits.filter((h) => !h.not).map((h) => h.trait);
  const neg = hits.filter((h) => h.not).map((h) => h.trait);
  // положительные признаки — «любой из», отрицательные — каждый «не»
  const when = [pos.length ? pos.join('|') : '', ...neg.map((n) => '!' + n)].filter(Boolean).join(' ');
  return { when, why: hits.map((h) => h.word + (h.strong ? '' : '?')).join(', '), sure: hits.every((h) => h.strong) && hits.length === 1 };
}

/** Проверка строки when тем же правилом, что на сервере. */
function whenOk(w) {
  const s = String(w ?? '').trim();
  if (!s) return true;
  return s.split(/\s+/).every((tok) => tok.split('|').every((a) => { const c = a.replace(/^!/, ''); return c && TRAITS.includes(c); }));
}

function evalWhen(when, traits) {
  const s = String(when ?? '').trim();
  if (!s) return true;
  const set = new Set(traits);
  return s.split(/\s+/).every((tok) => tok.split('|').some((a) => (a.startsWith('!') ? !set.has(a.slice(1)) : set.has(a))));
}

const readJson = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const items = (dir, name) => readJson(dir, name).items;
const short = (s, n = 70) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/** Пункты текста: код + условие + текст из кода (ALL и все категории) и из активных версий БД (категории). */
function collectTextItems(textsFile, dataDir) {
  const code = JSON.parse(fs.readFileSync(textsFile, 'utf8'));
  const out = [];
  const push = (cat, source, sec) => sec.paragraphs.forEach((text, i) => out.push({
    cat, source, section: sec.key, id: (sec.ids && sec.ids[i]) || `p${i + 1}`, text, when: (sec.when && sec.when[i]) || '',
  }));
  for (const sec of code.ALL.sections) push('ALL', 'код', sec);
  const db = items(dataDir, 'passporttemplates-docs.json').filter((d) => d.isActive && d.category && d.category !== 'ALL_V2' && d.category !== 'ALL');
  for (const d of db) for (const sec of d.sections) push(d.category, 'БД', sec);
  return out;
}

function auditTexts(list) {
  return list.map((it) => ({ ...it, sug: suggest(it.text) })).map((it) => ({ ...it, state: !it.sug ? 'общий' : it.when ? 'уже есть when' : it.sug.sure ? 'уверенно' : 'спорно' }));
}

/** Явные решения по кодам дефектов (по ручной правке 597) важнее слов. */
const DEFECT_KNOWN = { LOOSE_THREADS: 'bolts', FASTENER_MISSING: 'bolts', WELD_CRACK: 'welds' };

function auditDefects(dataDir) {
  return items(dataDir, 'dict-passportDefects.json').map((d) => {
    const known = DEFECT_KNOWN[d.code];
    const sug = known ? { when: known, why: 'исключён вручную на 597', sure: true } : suggest(`${d.name}. ${d.measure || ''}`);
    return { code: d.code, name: d.name, id: d.id, when: d.when || '', sug, state: !sug ? 'общий' : d.when ? 'уже есть when' : sug.sure ? 'уверенно' : 'спорно' };
  });
}

const ELEMENT_MOVING = /качел|карусел|балансир|подшипник|подвес|каретк|маховик|педал|ось\b|твистер|подвижн|кардио|вращ|втулк|ограничитель хода/;
function auditElements(dataDir) {
  return items(dataDir, 'dict-passportElements.json').map((e) => {
    const byName = norm(e.name);
    const traits = [];
    if (ELEMENT_MOVING.test(byName)) traits.push('moving');
    else if (ELEMENT_MOVING.test(norm(`${e.inDescription || ''} ${e.inspect || ''}`))) traits.push('moving');
    if (/анкер/.test(byName)) traits.push('anchors');
    // по названию — уверенно; только по описанию или проверкам (брусья, ограждение, стенка) — спорно
    return { code: e.code, name: e.name, id: e.id, traits, have: e.traits || '', sure: traits.length === 1 && (ELEMENT_MOVING.test(byName) || /анкер/.test(byName)) };
  }).filter((e) => e.traits.length);
}

const WOOD = /дерев|древес|бревн|фанер|камыш|wood|plywood/;
const METAL = /сталь|стальн|труб|двутавр|круг|трос|цепь|нержав|оцинк|алюмин|steel|stainless|galv|zinc/;
function auditMaterials(dataDir) {
  return items(dataDir, 'dict-passportMaterials.json').map((m) => {
    const t = norm(`${m.name} ${m.code}`);
    const traits = [];
    if (WOOD.test(t)) traits.push('wood');
    if (METAL.test(t) && !/покрыти|окраск|грунт|эмал|пропитк|масло/.test(t)) traits.push('metal');
    return { code: m.code, name: m.name, id: m.id, traits, have: m.traits || '', sure: !/камыш|канат/.test(t) };
  }).filter((m) => m.traits.length);
}

function auditInstall(dataDir) {
  return items(dataDir, 'dict-passportInstall.json').map((r) => {
    const text = `${r.name}\n${r.montage || ''}\n${r.baseRequirements || ''}`;
    const t = norm(text);
    const traits = [];
    if (/свободностоящ/.test(norm(r.name))) traits.push('freestanding');
    else {
      if (/забетонир|бетониру|ямы под опоры|стойк/.test(t) || /фундамент|закладн/.test(t)) traits.push('concrete');
      if (/анкер|шпильк/.test(t)) traits.push('anchors');
    }
    const why = scan(text).filter((h) => ['concrete', 'anchors', 'freestanding'].includes(h.trait)).map((h) => h.word).join(', ');
    return { code: r.code, name: r.name, id: r.id, traits, have: r.traits || '', why, sure: ['ANCHORS', 'CONCRETE_POSTS', 'FENCE_POSTS', 'FREESTANDING'].includes(r.code) };
  });
}

/** Новая запись способа установки для решёток, люков, плитки — на основание без крепления. */
const NEW_INSTALL = {
  name: 'Укладывается на основание (без крепления)', code: 'LAID', traits: 'freestanding',
  montage: 'Подготовить ровное плотное основание\nУложить изделие на основание в проектное положение\nПроверить устойчивость и при необходимости выровнять',
  baseRequirements: 'Основание ровное, плотное, без просадок\nПоверхность основания очищена от мусора и посторонних предметов',
};

/** Материал для листовых изделий (597 взял «трубу»): отдельная запись — данные, не код. */
const NEW_MATERIAL = { name: 'Сталь с порошковой окраской (лист)', code: 'STEEL_POWDER_SHEET', madeOf: 'стального листа с порошковым полимерным покрытием', traits: 'metal', categories: 'BLG' };

/** Фразы из паспорта 597: корень слова (устойчиво к падежам) → как ищем. */
const FORBIDDEN = [
  ['опоры бетонируют', /опор\S*\s+бетонир/], ['вертикальность стоек', /вертикальност\S*\s+стоек/], ['анкеры и шпильки', /анкер\S*\s+и\s+шпильк/],
  ['нет корней деревьев', /корн\S*\s+дерев/], ['вставать запрещается', /встава\S*[^.]{0,30}запрещ/], ['ослабление резьбовых', /ослаблен\S*\s+резьб/],
  ['трещины в сварных швах', /трещин\S*\s+в\s+сварн/], ['отсутствие крепежа', /отсутстви\S*[^.]{0,20}крепеж/], ['проседания под опорами', /проседани\S*\s+под\s+опор/],
  ['изготовлено из стальной трубы', /изготовлен\S*\s+из\s+стальн\S*\s+труб|стальн\S*\s+труб/], ['перед занятием', /перед\s+занятием/], ['спортивная обувь', /спортивн\S*\s+обув/], ['не раскачивайте', /раскачива/],
];
const RESIDENT_597 = ['metal', 'walkable', 'atTree', 'freestanding']; // joints = solid → нет bolts, welds; нет concrete, anchors

/**
 * Что останется в PDF решётки 597, если принять все предложения: пункты с when по признакам 597, дефекты, madeOf материала,
 * основание новой записи «Укладывается…», пиктограммы категории BLG. Возвращает { phrase, left:[{source,text}] }.
 */
function check597(audit, dataDir, accepted, newMaterial = false) {
  const p597 = readJson(dataDir, 'passport-597.json');
  const left = [];
  const scanText = (source, text) => { const t = norm(text); for (const [phrase, re] of FORBIDDEN) if (re.test(t)) left.push({ phrase, source, text: short(text, 90) }); };
  for (const it of audit.texts) {
    if (it.cat !== 'ALL' && it.cat !== 'BLG') continue;
    const when = it.when || (accepted(it.cat + '/' + it.section + '/' + it.id, it) ? it.sug?.when : '') || '';
    if (evalWhen(when, RESIDENT_597)) scanText(`${it.cat} ${it.section}/${it.id}${when ? ` [${when}]` : ''}`, it.text);
  }
  for (const d of audit.defects) {
    const when = d.when || (accepted('defect/' + d.code, d) ? d.sug?.when : '') || '';
    if (!(p597.excludeDefects || []).includes(d.code) && evalWhen(when, RESIDENT_597)) scanText(`дефект ${d.code}`, `${d.name} ${items(dataDir, 'dict-passportDefects.json').find((x) => x.code === d.code)?.measure || ''}`);
  }
  const mat = items(dataDir, 'dict-passportMaterials.json').find((m) => m.id === String((p597.materialIds || [])[0]));
  if (newMaterial) scanText(`новый материал ${NEW_MATERIAL.code} (madeOf)`, `Изготовлено из ${NEW_MATERIAL.madeOf}`);
  else if (mat) scanText(`материал ${mat.code} (madeOf)`, `Изготовлено из ${mat.madeOf}`);
  scanText('новый способ установки LAID', NEW_INSTALL.baseRequirements);
  for (const s of items(dataDir, 'dict-passportStyle.json')) if (s.kind === 'пиктограмма правил' && s.category === 'BLG') scanText(`пиктограмма ${s.code}`, s.text);
  return { left, material: mat ? `${mat.code}: ${mat.madeOf}` : '' };
}

/** Что есть в исходных ALL/категориях: сколько раз каждая фраза встречается (проверка, что корни слов попадают в реальные тексты). */
function phraseCoverage(texts) {
  return FORBIDDEN.map(([phrase, re]) => [phrase, texts.filter((it) => re.test(norm(it.text))).length]);
}

function buildAudit(opts) {
  const texts = auditTexts(collectTextItems(opts.texts, opts.data));
  const defects = auditDefects(opts.data);
  return { texts, defects, elements: auditElements(opts.data), materials: auditMaterials(opts.data), install: auditInstall(opts.data) };
}

/** Спорные — не больше MAX_DISPUTED по числу найденных слов; остальные уходят в «слабые» (оставить общими). */
function split(audit) {
  const disputed = [...audit.texts.filter((x) => x.state === 'спорно'), ...audit.defects.filter((x) => x.state === 'спорно')]
    .sort((a, b) => b.sug.why.split(',').length - a.sug.why.split(',').length);
  return { top: disputed.slice(0, MAX_DISPUTED), weak: disputed.slice(MAX_DISPUTED) };
}

const cell = (s) => String(s).replace(/\|/g, '\\|');
function renderReport(audit, dataDir) {
  const sure = [...audit.texts.filter((x) => x.state === 'уверенно'), ...audit.defects.filter((x) => x.state === 'уверенно')];
  const { top, weak } = split(audit);
  const res = check597(audit, dataDir, (_k, it) => it.state === 'уверенно');
  const all = check597(audit, dataDir, (_k, it) => !!it.sug, true);
  const cov = phraseCoverage(audit.texts);
  const key = (x) => (x.section ? `${x.cat}/${x.section}/${x.id}` : `defect/${x.code}`);
  const L = [];
  L.push('# C054 B4 — аудит пунктов «Для всех» и справочников паспорта', '');
  L.push('Сгенерировано `backend/scripts/passport-items-audit.js` (только чтение выгрузок `data/`). Решения по спорным — в `decisions.json`: `{ "mounting/p7": "concrete" | "keep" }`, затем `--apply --decisions decisions.json`.', '');
  L.push(`Пунктов текста: ${audit.texts.length} (общих без слов-признаков: ${audit.texts.filter((x) => x.state === 'общий').length}), дефектов: ${audit.defects.length}.`);
  L.push(`**Уверенно: ${sure.length}. Спорно: ${top.length}${weak.length ? ` (ещё ${weak.length} со слабыми словами — оставляем общими)` : ''}.**`, '');
  L.push('## Спорные (решает пользователь)', '', '| Код | Начало текста | Предлагаемое when | Какие слова сработали (? — слабое слово) | Решение |', '|--|--|--|--|--|');
  for (const x of top) L.push(`| ${key(x)} | ${cell(short(x.text || x.name))} | \`${x.sug.when}\` | ${cell(x.sug.why)} | |`);
  if (weak.length) L.push('', `Слабые слова, оставляем без условия: ${weak.map(key).join(', ')}.`);
  L.push('', '## Уверенно (применяются по `--apply`)', '', '<details><summary>Список</summary>', '', '| Код | Начало текста | when | Почему |', '|--|--|--|--|');
  for (const x of sure) L.push(`| ${key(x)} | ${cell(short(x.text || x.name, 60))} | \`${x.sug.when}\` | ${cell(x.sug.why)} |`);
  L.push('', '</details>', '', '## Признаки справочников (traits)', '');
  const tr = (title, arr) => { L.push(`**${title}**`, '', '| Код | Название | traits | Уверенность |', '|--|--|--|--|'); for (const r of arr) L.push(`| ${r.code} | ${cell(r.name)} | ${r.traits.join(', ')}${r.why ? ` (${cell(r.why)})` : ''} | ${r.sure ? 'уверенно' : 'спорно'} |`); L.push(''); };
  tr('Виды изделия (passportElements): подвижные части и крепёж', audit.elements);
  L.push('Новая запись вида: **Приствольная решётка** (код `TREE_GRATE`, traits: `walkable, atTree, metal`, категория BLG) — сейчас такого вида нет, у паспорта 597 `elements` пуст.', '');
  tr('Материалы (passportMaterials): металл и древесина', audit.materials);
  L.push('Новая запись материала: **' + NEW_MATERIAL.name + '** (`' + NEW_MATERIAL.code + '`, madeOf: «' + NEW_MATERIAL.madeOf + '», traits: `metal`) — у `STEEL_POWDER` «изготовлено из стальной трубы», для листа это неверно.', '');
  tr('Способы установки (passportInstall)', audit.install.filter((r) => r.traits.length));
  L.push('**Новая запись способа установки** «' + NEW_INSTALL.name + '» (код `LAID`, traits: `freestanding`), основание: ' + NEW_INSTALL.baseRequirements.split('\n').join('; ') + '.', '');
  L.push('«Свободностоящий» (`FREESTANDING`): требование «не допускает проседания под опорами» остаётся только у него — оно про опоры; решётка на земле выбирает `LAID`.', '');
  L.push('## Проверка «как 597»', '', `Признаки: ${RESIDENT_597.join(', ')}; соединения «цельное» (нет bolts, welds, concrete, anchors). Материал 597: ${res.material}.`, '');
  L.push('Все предложения «уверенно» приняты, спорные — нет. Фразы, которые остаются в PDF:', '');
  if (!res.left.length) L.push('Ни одной из 13 фраз.');
  else { L.push('| Фраза | Где остаётся |', '|--|--|'); for (const r of res.left) L.push(`| ${r.phrase} | ${cell(r.source)}: ${cell(r.text)} |`); }
  L.push('', 'Если принять и спорные предложения, а материал 597 заменить новой записью «' + NEW_MATERIAL.name + '» (`' + NEW_MATERIAL.code + '`, madeOf: «' + NEW_MATERIAL.madeOf + '»): ' + (all.left.length ? 'остаётся ' + all.left.map((l) => l.phrase + ' (' + l.source + ')').join('; ') : 'ни одной из 13 фраз.'), '');
  L.push(`Попадание корней слов в исходные тексты (число пунктов): ${cov.map(([p, n]) => `${p} — ${n}`).join('; ')}.`, '');
  return { md: L.join('\n') + '\n', sure: sure.length, disputed: top.length, left: res.left, leftAll: all.left, weak: weak.length };
}

/** Применение: when в файле passport-texts.v2.json (правка строк заголовков разделов, формат файла сохраняется) + план для прода. */
function applyToTexts(raw, audit, decide) {
  const code = JSON.parse(raw);
  const plan = [];
  for (const cat of Object.keys(code)) for (const sec of code[cat].sections) plan.push({ cat, sec });
  let i = 0;
  const changed = [];
  const out = raw.replace(/"ids": \[[^\]]*\](?:, "when": \[[^\]]*\])?, "paragraphs": \[/g, (m) => {
    const { cat, sec } = plan[i++];
    const ids = (sec.ids && sec.ids.length) ? sec.ids : null;
    if (!ids) return m;
    const when = ids.map((id, k) => {
      const it = audit.texts.find((x) => x.cat === cat && x.source === 'код' && x.section === sec.key && x.id === id);
      const v = (sec.when && sec.when[k]) || (it && decide(it)) || null;
      if (v && !(sec.when && sec.when[k])) changed.push(`${cat}/${sec.key}/${id}: ${v}`);
      return v;
    });
    const idsPart = m.slice(0, m.indexOf(', "paragraphs"')).replace(/, "when": \[[^\]]*\]$/, '');
    return when.some(Boolean) ? `${idsPart}, "when": ${JSON.stringify(when)}, "paragraphs": [` : `${idsPart}, "paragraphs": [`;
  });
  return { out, changed };
}

/** План PATCH для прода: справочники (traits / when), новые записи, версии категорий из БД с when. Сам ничего не пишет. */
function buildApplyPlan(audit, decide, dataDir) {
  const plan = { note: 'План для прода (C054 B4). Выполняет пользователь через пульт после проверки. Выданные паспорта и 597 не затрагиваются.', dicts: [], create: [], templates: [] };
  const trait = (dict, rows, field = 'traits') => rows.forEach((r) => { if (r.id && !r.have) plan.dicts.push({ dict, code: r.code, id: r.id, set: { [field]: Array.isArray(r.traits) ? r.traits.join(', ') : r.traits } }); });
  trait('passportElements', audit.elements.filter((r) => r.sure));
  trait('passportMaterials', audit.materials.filter((r) => r.sure));
  trait('passportInstall', audit.install.filter((r) => r.sure && r.traits.length));
  for (const d of audit.defects) { const v = decide(d); if (v && !d.when) plan.dicts.push({ dict: 'passportDefects', code: d.code, id: d.id, set: { when: v } }); }
  plan.create.push({ dict: 'passportInstall', body: NEW_INSTALL });
  plan.create.push({ dict: 'passportMaterials', body: NEW_MATERIAL });
  plan.create.push({ dict: 'passportElements', body: { name: 'Приствольная решётка', code: 'TREE_GRATE', kind: 'product', categories: 'BLG', traits: 'walkable, atTree, metal' } });
  const db = items(dataDir, 'passporttemplates-docs.json').filter((d) => d.isActive && d.category && !/^ALL/.test(d.category));
  for (const d of db) {
    const sections = d.sections.map((s) => {
      const ids = s.paragraphs.map((_, k) => `p${k + 1}`);
      const when = ids.map((id) => { const it = audit.texts.find((x) => x.cat === d.category && x.source === 'БД' && x.section === s.key && x.id === id); return (it && !it.when && decide(it)) || null; });
      return { key: s.key, title: s.title, paragraphs: s.paragraphs, ids, ...(when.some(Boolean) ? { when } : {}) };
    });
    if (sections.some((s) => s.when)) plan.templates.push({ method: 'PUT', path: '/api/passports/texts', body: { category: d.category, sections } });
  }
  return plan;
}

function parseArgs(argv) {
  const o = { apply: false, data: DEFAULT_DATA, out: DEFAULT_OUT, texts: DEFAULT_TEXTS, decisions: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') o.apply = true;
    else if (['--data', '--out', '--texts', '--decisions'].includes(a)) o[a.slice(2)] = path.resolve(argv[++i]);
  }
  return o;
}

/** Решение по пункту: уверенно — принимаем; спорно — только если пользователь дал решение (когда ≠ keep). */
function makeDecide(decisions) {
  return (x) => {
    const key = x.section ? `${x.cat}/${x.section}/${x.id}` : `defect/${x.code}`;
    const d = decisions && decisions[key];
    if (d === 'keep') return null;
    if (d) { if (!whenOk(d)) throw new Error(`Решение ${key}: неверное условие «${d}»`); return d; }
    return x.state === 'уверенно' ? x.sug.when : null;
  };
}

function main(argv) {
  const o = parseArgs(argv);
  const audit = buildAudit(o);
  const rep = renderReport(audit, o.data);
  fs.mkdirSync(o.out, { recursive: true });
  fs.writeFileSync(path.join(o.out, 'AUDIT.md'), rep.md);
  console.log(`Уверенно: ${rep.sure}; спорно: ${rep.disputed}${rep.weak ? ` (+${rep.weak} слабых)` : ''}; фраз 597 осталось: ${new Set(rep.left.map((l) => l.phrase)).size} (при принятии всех предложений и новом материале: ${new Set(rep.leftAll.map((l) => l.phrase)).size})`);
  console.log(`Отчёт: ${path.join(o.out, 'AUDIT.md')}`);
  if (!o.apply) return;
  const decide = makeDecide(o.decisions ? JSON.parse(fs.readFileSync(o.decisions, 'utf8')) : null);
  const raw = fs.readFileSync(o.texts, 'utf8');
  const { out, changed } = applyToTexts(raw, audit, decide);
  fs.writeFileSync(o.texts, out);
  fs.writeFileSync(path.join(o.out, 'apply-plan.json'), JSON.stringify(buildApplyPlan(audit, decide, o.data), null, 2));
  console.log(`when в ${path.basename(o.texts)}: ${changed.length} пунктов; план для прода: apply-plan.json`);
}

module.exports = { NEW_MATERIAL, scan, suggest, whenOk, evalWhen, buildAudit, renderReport, applyToTexts, buildApplyPlan, makeDecide, check597, RESIDENT_597, FORBIDDEN, NEW_INSTALL, auditInstall };
if (require.main === module) main(process.argv.slice(2));
