/**
 * C057: ключ сравнения «позиция номенклатуры ↔ строка PDM». Считается на лету (не хранится: CRM пишет materials
 * и не пересчитала бы ключ) — при предпросмотре загрузки из PDM и в отчёте дублей.
 *
 * Вид ключа: `вид·тип·стандарт·размер·марка`, например
 *   `fastener·болт мебельный·din603·м8×110·`   `raw·лист·гост19903·t4·ст3`   `raw·лист··t1.5·aisi304`.
 * Лист и фанера — ключ СОРТАМЕНТА: размер = толщина, формат (1250×2500) в ключ не входит (Л13).
 * Хранимое написание названий и артикулов не меняется — приводится только ключ.
 * Пустая строка — ключ не собрать (нет типа): позицию по характеристикам не сопоставляют.
 */

const PAIRS: ReadonlyArray<readonly [string, string]> = [['a', 'а'], ['b', 'в'], ['c', 'с'], ['e', 'е'], ['h', 'н'], ['k', 'к'], ['m', 'м'], ['o', 'о'], ['p', 'р'], ['t', 'т'], ['x', 'х'], ['y', 'у']];
const LAT2CYR = new Map(PAIRS);
const CYR2LAT = new Map(PAIRS.map(([l, c]) => [c, l] as const));

/** Строка для регулярки: похожие латинские/кириллические буквы взаимозаменяемы (`гост` → `г[oо][cс][tт]`). */
const lk = (lit: string): string => [...lit].map((ch) => {
  const lat = CYR2LAT.get(ch) ?? (LAT2CYR.has(ch) ? ch : null), cyr = LAT2CYR.get(ch) ?? (CYR2LAT.has(ch) ? ch : null);
  return lat && cyr ? `[${lat}${cyr}]` : ch;
}).join('');

/** Текст ключа: нижний регистр, ё=е, похожие латинские буквы → кириллические (М8 и M8 — одно и то же). */
const fold = (s: string): string => [...String(s).toLowerCase().replace(/ё/g, 'е')].map((ch) => LAT2CYR.get(ch) ?? ch).join('');

/** Разбор: нижний регистр, пробелы, запятая в числах → точка, `х`/`x`/`*` между числами → `×`. */
const prep = (v: unknown): string => String(v ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[  ]/g, ' ')
  .replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)\s*[xх×*]\s*(?=\d)/g, '$1×').replace(/\s+/g, ' ').trim();

const num = (s: string): number => Number(s);
const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);

// ───── стандарты ─────
const FAMILY = new Map<string, string>([[fold('gost'), 'гост'], [fold('гост'), 'гост'], [fold('ту'), 'ту'], [fold('din'), 'din'], [fold('iso'), 'iso'], [fold('исо'), 'iso'],
  [fold('ост'), 'ост'], [fold('сто'), 'сто'], [fold('astm'), 'astm'], [fold('en'), 'en']]);
const STD_RE = new RegExp(`(?<![a-zа-я])(${lk('gost')}|${lk('гост')}|${lk('ту')}|din|${lk('iso')}|${lk('исо')}|${lk('ост')}|${lk('сто')}|${lk('astm')}|${lk('en')})(?:\\s*(?:${lk('р')}|din|${lk('en')}|${lk('iso')}|${lk('исо')}))*\\s*((?:[a-zа-я]\\d+|\\d+)(?:\\.\\d+)?[a-zа-я]?)(?:-\\d{2,4}(?!\\d)|[-\\s]?([a-z])(?![a-zа-я\\d]))?`, 'g');
/** Стандарты на марку материала (ГОСТ 380 «Ст3», ASTM A240 «AISI 304»): в стандарт сортамента не идут. */
const GRADE_GOST = new Set(['380', '1050', '5632', '19281', '4543', '14918', '977', '1577', '4041', '5521', '535', '1414', '10702']);

// ───── марка, размеры ─────
const AISI_RE = new RegExp(`${lk('a')}isi[\\s-]*(\\d{3}[a-zа-я]?)`);
const STEEL_RE = new RegExp(`(?<![a-zа-я])(?:${lk('ст')}|сталь)\\.?\\s*(\\d{1,2})(?:сп|пс|кп)?(?![\\d])(?!\\s*(?:мм|mm))`);
const STAINLESS_RE = /(?<![a-zа-я])нерж[а-я.]*/;
const ZINC_RE = /(?<![a-zа-я])оцинк[а-я.]*/;
const THREAD_RE = new RegExp(`(?<![a-zа-я\\d.])${lk('м')}(\\d+(?:\\.\\d+)?)(?:×(\\d+(?:\\.\\d+)?))?`);
const MM_RE = /(?<![\d.×])(\d+(?:\.\d+)?)\s*(?:мм|mm)(?![a-zа-я])/g;
const CHAIN_RE = /\d+(?:\.\d+)?(?:×\d+(?:\.\d+)?)+/;
const DIAM_RE = /(?:ø|⌀|диаметр\.?)\s*(\d+(?:\.\d+)?)/;
const LOOSE_RE = /(?<![a-zа-я\d.×])\d+(?:\.\d+)?(?![\d.×a-zа-я])/g;

// ───── типы ─────
/** Лист и плита: ключ без формата, размер = толщина. */
const SHEET_TYPES = new Set(['лист', 'фанера', 'плита', 'дсп', 'лдсп', 'мдф', 'осб', 'стекло', 'оргстекло', 'поликарбонат']);
const RAW_TYPES = new Set([...SHEET_TYPES, 'брус', 'труба', 'уголок', 'швеллер', 'балка', 'круг', 'пруток', 'полоса', 'профиль', 'проволока', 'лента', 'доска', 'рейка', 'арматура', 'квадрат', 'пластина']);
const STOPWORDS = new Set(['сталь', 'стальной', 'стальная', 'стальные', 'материал', 'из', 'и', 'шт']);
const ENDINGS = ['овая', 'овый', 'овое', 'овые', 'ая', 'ый', 'ой', 'ое', 'ые', 'ий', 'а', 'я', 'ь'];
/** Прилагательное и существительное одного корня («берёзовая» и «берёза») дают одно слово. */
const stem = (w: string): string => { for (const e of ENDINGS) if (w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length); return w; };

type Dim = 'length' | 'width' | 'height' | 'thickness' | 'diameter' | 'depth';

interface Parsed {
  type: string; quals: string[]; std: string; grade: string;
  thread?: number; length?: number; thick: number[]; chain: number[]; diam: number[]; loose: number[];
}
const empty = (): Parsed => ({ type: '', quals: [], std: '', grade: '', thick: [], chain: [], diam: [], loose: [] });

/** Разобрать одну строку (название, сортамент, материал…). `qualOnly` — остаток слов не тип, а уточнение (поле «Материал»). */
function parse(raw: unknown, qualOnly = false): Parsed {
  const p = empty();
  let s = prep(raw);
  if (!s) return p;
  // стандарты
  s = s.replace(STD_RE, (_m, fam: string, n: string, letter?: string) => {
    const family = FAMILY.get(fold(fam)) ?? fold(fam), number = fold(n);
    if (!p.std && !(family === 'astm' || (family === 'гост' && GRADE_GOST.has(number)))) p.std = family + number + (letter && family !== 'гост' ? fold(letter) : '');
    return ' ';
  });
  // марка
  let m = AISI_RE.exec(s);
  if (m) { p.grade = 'aisi' + m[1]; s = s.replace(AISI_RE, ' '); }
  if (STAINLESS_RE.test(s)) { if (!p.grade) p.grade = 'aisi304'; s = s.replace(STAINLESS_RE, ' '); }
  m = STEEL_RE.exec(s);
  if (m) { if (!p.grade) p.grade = 'ст' + num(m[1]); s = s.replace(STEEL_RE, ' '); }
  if (ZINC_RE.test(s)) { p.grade = p.grade ? `${p.grade} оцинк` : 'оцинк'; s = s.replace(ZINC_RE, ' '); }
  // резьба и длина метиза: M8, M8×110
  m = THREAD_RE.exec(s);
  if (m) { p.thread = num(m[1]); if (m[2]) p.length = num(m[2]); s = s.replace(THREAD_RE, ' '); }
  // толщины «4 мм»; остальные «мм» после чисел убираем
  s = s.replace(MM_RE, (_x, n: string) => { p.thick.push(num(n)); return ' '; }).replace(/(\d)\s*(?:мм|mm)(?![a-zа-я])/g, '$1');
  m = CHAIN_RE.exec(s);
  if (m) { p.chain = m[0].split('×').map(num); s = s.replace(CHAIN_RE, ' '); }
  s = s.replace(new RegExp(DIAM_RE.source, 'g'), (_x, n: string) => { p.diam.push(num(n)); return ' '; });
  s = s.replace(LOOSE_RE, (x) => { p.loose.push(num(x)); return ' '; });
  // остаток слов: сегменты по запятым
  const segs = s.split(',').map((x) => (x.match(/[a-zа-я][a-zа-я0-9-]*/g) ?? []).filter((w) => !STOPWORDS.has(w))).filter((w) => w.length);
  if (!segs.length) return p;
  if (qualOnly) { p.quals = segs.flat().map(stem); return p; }
  const [first, ...rest] = segs;
  const known = first.findIndex((w) => RAW_TYPES.has(w));
  if (known >= 0) { p.type = first[known]; p.quals = first.filter((_w, i) => i !== known).map(stem); } else p.type = first.join(' ');
  p.quals.push(...rest.flat().map(stem));
  return p;
}

/** Первое непустое значение по каждому полю (структурные поля позиции важнее названия). */
function merge(list: Parsed[]): Parsed {
  const out = empty();
  for (const p of list) {
    out.type ||= p.type; out.std ||= p.std;
    out.thread ??= p.thread; out.length ??= p.length;
    if (p.grade) out.grade = out.grade ? (out.grade.includes(p.grade) ? out.grade : `${out.grade} ${p.grade}`) : p.grade;
    if (!out.thick.length) out.thick = p.thick;
    if (!out.chain.length) out.chain = p.chain;
    if (!out.diam.length) out.diam = p.diam;
    if (!out.loose.length) out.loose = p.loose;
    for (const q of p.quals) if (!out.quals.includes(q)) out.quals.push(q);
  }
  return out;
}

export interface MatchDimension { type: string; value: number }

/** Позиция номенклатуры (materials): структурные поля + название на случай, когда они пусты. */
export interface MatchInput {
  kind?: string | null; typeName?: string | null; standardRef?: string | null; materialGrade?: string | null;
  assortment?: string | null; dimensions?: ReadonlyArray<MatchDimension> | null; name?: string | null;
}

/** Строка PDM: «Сортамент», «Материал» и габарит из карточки (для метизов — длина). */
export interface PdmMatchInput {
  kind?: string | null; assortment?: string | null; material?: string | null;
  size?: { length?: number | null; width?: number | null; thickness?: number | null } | null;
}

const KINDS = new Set(['raw', 'part', 'fastener', 'purchased']);

function build(kindIn: string | null | undefined, p: Parsed, dims: Partial<Record<Dim, number>>): string {
  const type = fold(p.type);
  if (!type) return '';
  const given = String(kindIn ?? '');
  const kind = KINDS.has(given) ? given : RAW_TYPES.has(p.type) ? 'raw' : p.thread != null ? 'fastener' : '';
  let size = '';
  if (SHEET_TYPES.has(p.type)) {
    const t = p.thick[0] ?? dims.thickness ?? (p.chain.length === 3 ? Math.min(...p.chain) : undefined) ?? p.loose[0];
    size = t != null ? `t${fmt(t)}` : '';
  } else if (kind === 'fastener' || p.thread != null) {
    const d = p.thread ?? dims.diameter ?? p.loose[0], l = p.length ?? dims.length ?? p.chain[0];
    size = d != null ? `м${fmt(d)}${l != null ? `×${fmt(l)}` : ''}` : '';
  } else {
    const all = [...p.chain, ...p.diam, ...p.thick];
    if (!all.length) all.push(...Object.values(dims).filter((v): v is number => typeof v === 'number' && v > 0));
    size = all.sort((a, b) => b - a).map(fmt).join('×');
  }
  const grade = [...new Set([...p.grade.split(' ').filter(Boolean), ...p.quals])].sort().join(' ');
  return [kind, type, p.std, size, grade].join('·');
}

/** Ключ позиции номенклатуры (materials). */
export function matchKey(input: MatchInput): string {
  const dims: Partial<Record<Dim, number>> = {};
  for (const d of input.dimensions ?? []) if (d && typeof d.value === 'number' && d.value > 0 && dims[d.type as Dim] == null) dims[d.type as Dim] = d.value;
  const typeName = String(input.typeName ?? '').trim();
  const p = merge([
    typeName ? { ...empty(), type: prep(typeName) } : empty(),
    parse(input.assortment), parse(input.standardRef, true), parse(input.materialGrade, true), parse(input.name),
  ]);
  return build(input.kind, p, dims);
}

/** Ключ строки PDM: «Сортамент» (+ «Материал») тем же правилом. */
export function matchKeyPdm(input: PdmMatchInput): string {
  const dims: Partial<Record<Dim, number>> = {};
  if (input.kind === 'fastener' || input.kind === 'purchased') { const l = Number(input.size?.length); if (l > 0) dims.length = l; }
  return build(input.kind, merge([parse(input.assortment), parse(input.material, true)]), dims);
}

// ───── обозначения (код из имени файла PDM) ─────
const DESIGNATION: Record<string, string> = {
  а: 'A', б: 'B', в: 'B', г: 'G', д: 'D', е: 'E', ё: 'E', ж: 'ZH', з: 'Z', и: 'I', й: 'I', к: 'K', л: 'L', м: 'M', н: 'H', о: 'O', п: 'P', р: 'P', с: 'S', т: 'T',
  у: 'Y', ф: 'F', х: 'X', ц: 'TS', ч: 'CH', ш: 'SH', щ: 'SH', ъ: '', ы: 'Y', ь: '', э: 'E', ю: 'YU', я: 'YA',
  c: 'S', r: 'P', n: 'H', v: 'B', u: 'Y', j: 'I',
};

/**
 * Ключ обозначения: латиница и кириллица в одном написании (`SHP08.D125` = `ШП08.D125`, `SK08.080.PRSH` = `СК08.080.ПРШ`).
 * Только для сравнения — хранимое написание не меняется.
 */
export function designationKey(code: unknown): string {
  return [...String(code ?? '').toLowerCase().replace(/\s+/g, '')].map((ch) => DESIGNATION[ch] ?? ch.toUpperCase()).join('');
}
