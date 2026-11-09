/* C057-Э0: разборщик названий номенклатуры → typeName / standardRef / materialGrade / assortment / dimensions.
 * Чистые функции, без базы. Используют c057-parse-names.js, c057-dupes-report.js, c057-profiles.js и тесты.
 *
 * Виды разбора (по категории склада): fastener (Метизы), sheet (Листовой металл, Стекло), pipe (трубы), other (не разбирается).
 * Правило: разбор только ЗАПОЛНЯЕТ пустое — решает вызывающий (fillEmpty); заполненное поле никогда не меняется. */
'use strict';

const num = (s) => Number(String(s).replace(',', '.'));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const X = '[xх×X]'; // латинская x, кириллическая х, ×
const NB = '(?<![A-Za-zА-Яа-яЁё0-9])';

/** Категория → вид разбора. */
function groupOf(categoryName, name) {
  const c = String(categoryName || '');
  if (c === 'Метизы') return 'fastener';
  if (c === 'Листовой металл' || c === 'Стекло') return 'sheet';
  if (c === 'Круглая труба' || c === 'Профильная труба') return 'pipe';
  if (!c && /(^|\s)(болт|винт|гайк|шайб|саморез|шуруп|шпильк|заклёп|заклеп|анкер)/i.test(String(name || ''))) return 'fastener';
  return 'other';
}

// ───── метизы ─────
const STD_RE = new RegExp(`${NB}(DIN|ISO|ГОСТ|ТУ|ОСТ)\\s*(?:EN\\s*)?(?:ISO\\s*)?([A-Z]?\\d{2,6}[A-Z]?)(?:-\\d{2,4})?(?![\\dA-Za-z])`, 'i');
const THREAD_RE = new RegExp(`${NB}[MМм]\\s?(\\d+(?:[.,]\\d+)?)(?:\\s*${X}\\s*\\d+[.,]\\d+(?=\\s*${X}\\s*\\d))?(?:\\s*${X}\\s*(\\d+(?:[.,]\\d+)?))?(?![\\dA-Za-zА-Яа-я])`);
const PAIR_RE = new RegExp(`${NB}(\\d+(?:[.,]\\d+)?)\\s*${X}\\s*(\\d+(?:[.,]\\d+)?)(?:/\\d+)?(?![\\d])`);
const MM_RE = /(?<![\dA-Za-zА-Яа-я])(\d+(?:[.,]\d+)?)\s*мм(?![А-Яа-яA-Za-z])/i;
const STRENGTH_RE = /(?<![A-Za-zА-Яа-я])(кп|кл\.?)\s*(\d{1,2}\.\d)/i;

/** Особые обозначения материала/покрытия в названии метиза → грамотное написание. */
const FASTENER_GRADES = [
  [/нерж[а-я.]*/i, 'нержавеющая сталь'],
  [/оцинк[а-я.]*/i, 'оцинкованная сталь'],
  [/(?<![А-Яа-я])б\.\s?ц\./i, 'белый цинк'],
  [/(?<![А-Яа-я])бел[а-я]*\s+цинк/i, 'белый цинк'],
  [/(?<![А-Яа-я])чер\.\s?металл/i, 'чёрная сталь'],
  [/(?<![А-Яа-я])(?:желт|жёлт)[а-я]*\s+цинк/i, 'жёлтый цинк'],
];

function parseFastener(rawName) {
  const name = String(rawName || '').replace(/\s+/g, ' ').trim();
  const out = { typeName: '', standardRef: '', materialGrade: '', assortment: '', dims: {}, notes: [] };
  let rest = name;
  // стандарт
  let m = STD_RE.exec(rest);
  if (m) { out.standardRef = `${m[1].toUpperCase().replace('ГОСТ', 'ГОСТ')} ${m[2].toUpperCase()}`; rest = rest.replace(m[0], ' '); }
  // класс прочности и покрытие
  const grades = [];
  m = STRENGTH_RE.exec(rest);
  if (m) { grades.push(`кп ${m[2]}`); rest = rest.replace(m[0], ' '); }
  for (const [re, label] of FASTENER_GRADES) { if (re.test(rest)) { grades.push(label); rest = rest.replace(re, ' '); } }
  out.materialGrade = grades.join(', ');
  // размеры
  m = THREAD_RE.exec(rest);
  if (m) {
    out.dims.diameter = num(m[1]); if (m[2]) out.dims.length = num(m[2]);
    rest = rest.replace(m[0], ' ');
  } else if ((m = PAIR_RE.exec(rest))) {
    out.dims.diameter = num(m[1]); out.dims.length = num(m[2]);
    if (/\/\d/.test(m[0])) out.notes.push(`в «${m[0]}» взята первая длина`);
    rest = rest.replace(m[0], ' ');
  } else if ((m = MM_RE.exec(rest))) {
    out.dims.diameter = num(m[1]); rest = rest.replace(m[0], ' ');
  }
  // тип: первый сегмент до запятой, без размеров, брендов-капслока и количеств
  let seg = rest.split(',')[0];
  seg = seg.replace(/\([^)]*\)/g, ' ').replace(/\S*\d\S*/g, ' ').replace(/[A-Z][A-Z0-9-]+/g, ' ').replace(/[А-ЯЁ][А-ЯЁ]+-[А-ЯЁ]+/g, ' ')
    .replace(/^(Оцинкованный|Нержавеющий)\s+/i, '').replace(/\s+(?:шт|штук)\.?(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').replace(/[\s,;-]+$/, '').trim();
  seg = seg.replace(/(\p{L}{3,})\.$/u, (x, w) => (/^(шестигр|целиндр|внутр|полусфер|потай|цил|наруж)$/i.test(w) ? x : w)); // точка — только у сокращений
  out.typeName = cap(seg);
  const ok = !!out.typeName && !!(out.standardRef || out.dims.diameter != null);
  return { ...out, ok, reason: ok ? '' : (!out.typeName ? 'нет типа' : 'нет ни стандарта, ни размера') };
}

// ───── листы, стекло ─────
function parseSheet(rawName, categoryName) {
  const name = String(rawName || '').replace(/\s+/g, ' ').trim();
  const out = { typeName: '', standardRef: '', materialGrade: '', assortment: '', dims: {}, notes: [] };
  const isGlass = categoryName === 'Стекло' || /^Стекло/i.test(name);
  if (isGlass) {
    const g = /^Стекло\s*(\d+(?:[.,]\d+)?)\s*мм\s*(\d+)\s*[xх×]\s*(\d+)\s*мм?/i.exec(name);
    out.typeName = 'Стекло';
    if (g) {
      out.dims.thickness = num(g[1]); out.dims.length = Math.max(num(g[2]), num(g[3])); out.dims.width = Math.min(num(g[2]), num(g[3]));
      out.assortment = `Стекло ${g[1].replace('.', ',')} мм`;
    }
    const ok = !!g;
    return { ...out, ok, reason: ok ? '' : 'размеры не найдены' };
  }
  const m = /^(Лист(?:\s+рифл[её]ный)?)\s+(.+?),\s*(\d+(?:[.,]\d+)?)\s*мм(?:\s*,\s*(\d+)\s*[xх×]\s*(\d+))?(?:\s*[—-]\s*(обрезок).*)?$/i.exec(name);
  out.typeName = 'Лист';
  if (!m) return { ...out, ok: false, reason: 'название не по шаблону «Лист <марка>, <толщина> мм, <ширина>×<длина>»' };
  const kind = m[1].replace(/^Лист\s*/i, '').replace('рифленый', 'рифлёный');
  out.materialGrade = m[2].trim();
  out.assortment = `Лист${kind ? ' ' + kind.toLowerCase() : ''} ${m[3].replace('.', ',')} мм`;
  out.dims.thickness = num(m[3]);
  if (m[4] && m[5]) { out.dims.length = Math.max(+m[4], +m[5]); out.dims.width = Math.min(+m[4], +m[5]); }
  if (m[6]) out.notes.push('обрезок');
  return { ...out, ok: true, reason: '' };
}

// ───── трубы ─────
function parsePipe(rawName) {
  const name = String(rawName || '').trim();
  const ok = /^Труба/i.test(name);
  return { typeName: 'Труба', standardRef: '', materialGrade: '', assortment: '', dims: {}, notes: [], ok, reason: ok ? '' : 'название не начинается с «Труба»' };
}

/** Разобрать название. group — 'fastener'|'sheet'|'pipe'|'other'. */
function parseName(name, group, categoryName) {
  if (group === 'fastener') return parseFastener(name);
  if (group === 'sheet') return parseSheet(name, categoryName);
  if (group === 'pipe') return parsePipe(name);
  return { typeName: '', standardRef: '', materialGrade: '', assortment: '', dims: {}, notes: [], ok: false, reason: 'вид не разбирается (не метиз, лист, труба)', skipped: true };
}

const empty = (v) => v == null || (typeof v === 'string' && !v.trim());
const DIM_ORDER = ['diameter', 'length', 'width', 'thickness', 'height', 'depth'];

/** Что именно записать в позицию: только пустые поля. dimensions — только типы, которых ещё нет. */
function fillEmpty(m, parsed) {
  const set = {};
  for (const f of ['typeName', 'standardRef', 'materialGrade', 'assortment']) if (empty(m[f]) && !empty(parsed[f])) set[f] = parsed[f];
  const have = new Set((m.dimensions || []).map((d) => d.type));
  const add = DIM_ORDER.filter((t) => parsed.dims[t] != null && !have.has(t)).map((t) => ({ type: t, value: parsed.dims[t], isImmutable: false }));
  return { set, addDims: add };
}

module.exports = { groupOf, parseName, parseFastener, parseSheet, parsePipe, fillEmpty, empty };
