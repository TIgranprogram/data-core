/* Поиск и фильтры склада «как в магазине» (без сервера, по уже загруженному списку).
 * Нормализация — как на сервере (backend/src/common/text/search-norm.ts): «м10» = «M10», х/x/× — размер.
 * Фильтры берутся из наименований: «Болт с шестигр. головкой, M10х100, DIN 933» →
 * тип «Болт с шестигр. головкой», резьба M10, длина 100, стандарт DIN 933. */
const LOOKALIKE = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };

export function normSearch(s) {
  return String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[×*]/g, 'х')
    .replace(/[abcehkmoptxy]/g, (ch) => LOOKALIKE[ch]).replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[«»"'(),;]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Артикул — тот же, если отличается регистром, «ё», похожими буквами (KC-01 = КС-01), пробелами по краям; как skuKey на сервере. */
export const skuKey = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[×*]/g, 'х')
  .replace(/[abcehkmoptxy]/g, (ch) => LOOKALIKE[ch]).replace(/\s+/g, ' ').trim();
export const searchTokens = (q) => normSearch(q).replace(/(^|\s)м\s+(\d)/g, '$1м$2').split(' ').filter(Boolean);

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Признаки позиции по наименованию. */
export function facetsOf(name) {
  const n = String(name || '');
  const thread = n.match(/(?:^|[\s,(])[MМ]\s?(\d+(?:[.,]\d+)?)(?![\d.,]*\s?мм)/);
  const len = n.match(/[MМ]\s?\d+(?:[.,]\d+)?\s?[xхX×]\s?(\d+(?:[.,]\d+)?)/);
  const std = n.match(/\b(DIN|ГОСТ|ISO)\s?(\d+)/i);
  let type = n.includes(',') ? n.slice(0, n.indexOf(',')) : n.split(/\s+/)[0];
  type = cap(type.replace(/\s+[MМ]\s?\d.*$/, '').replace(/[.\s]+$/, '').trim());
  if (type.length > 40) type = type.split(/\s+/).slice(0, 2).join(' ');
  return {
    type: type || null,
    thread: thread ? 'M' + thread[1].replace(',', '.') : null,
    length: len ? len[1].replace(',', '.') : null,
    std: std ? `${std[1].toUpperCase()} ${std[2]}` : null,
  };
}

export const FACETS = [['wash', 'Мойка'], ['pipe', 'Труба'], ['section', 'Сечение'], ['grade', 'Марка'], ['thick', 'Толщина, мм'], ['type', 'Тип'], ['thread', 'Резьба'], ['length', 'Длина, мм'], ['std', 'Стандарт']];
/** Признаки металла (СМ.1) — из полей позиции, а не из названия; в «Остатках» уходят на сервер отдельными фильтрами. */
/** Вид трубы для кнопки и цвета: профильная, круглая, нержавеющая. */
export const PIPE_KINDS = [['rect', 'Профильная'], ['round', 'Круглая'], ['steel', 'Нержавейка']];
const pipeKind = (it) => (/нерж/i.test(it.name || '') ? 'steel' : it.dims?.diameter ? 'round' : 'rect');
/** Значение кнопки трубы: вид|сортамент|длина, мм (0 — куски). У чёрной и нержавеющей сечения совпадают, поэтому вид в значении. */
export const pipeKey = (it) => `${pipeKind(it)}|${it.assortment}|${it.dims?.length || 0}`;
export const pipeParts = (v) => { const [kind, section, len] = String(v).split('|'); return { kind, section, len: Number(len) }; };
/** Подпись значения: без лишних слов — «80×80×3 6м», «Ø57×3,5 12м», лист «3 мм». */
export const facetLabel = (key, v) => {
  if (key === 'section') return String(v).replace(/^(Труба|Лист)\s+/i, '');
  if (key !== 'pipe') return v;
  const { section, len } = pipeParts(v);
  return `${section.replace(/^Труба\s+/i, '').replace(/\s*\(.*\)$/, '')} ${len ? len / 1000 + 'м' : 'куски'}`;
};
const sizes = (v) => (String(v).match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(',', '.')));
const bySize = (a, b) => { const x = sizes(a), y = sizes(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };

/** Подготовить позиции: признаки + строка для поиска (один раз после загрузки). */
export function index(items) {
  // марка и сечение — одно написание на вариант (регистр, ё, лишние пробелы не различаем; берём самое частое), иначе в фильтре дубли (SPR-1)
  const one = (field) => {
    const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
    const k = (v) => clean(v).toLowerCase().replace(/ё/g, 'е');
    const n = new Map(), best = new Map();
    for (const it of items) { const v = clean(it[field]); if (v) n.set(v, (n.get(v) || 0) + 1); }
    for (const [v, c] of n) { const b = best.get(k(v)); if (!b || c > n.get(b)) best.set(k(v), v); }
    return (v) => (clean(v) ? best.get(k(v)) : null);
  };
  const section = one('assortment'), grade = one('materialGrade');
  for (const it of items) {
    const isPipe = it.metal === 'pipe' && !!it.assortment;
    it._f = isPipe ? { pipe: pipeKey(it), wash: it.washed == null ? null : it.washed ? 'Мытая' : 'Не мытая' }
      : { ...(it.metal ? {} : facetsOf(it.name)), section: section(it.assortment), grade: grade(it.materialGrade), thick: it.dims?.thickness ? String(it.dims.thickness) : null };
    it._s = normSearch([it.name, it.article, it.sku, it.categoryName].filter(Boolean).join(' '));
  }
  return items;
}

/** Отбор по запросу, категории и выбранным признакам. */
export function pick(items, { q = '', cat = '', sel = {} } = {}) {
  const tokens = searchTokens(q);
  return items.filter((it) => (!cat || it.categoryId === cat)
    && tokens.every((t) => it._s.includes(t))
    && Object.entries(sel).every(([k, v]) => !v || it._f[k] === v));
}

/** Значения признаков среди найденного (для кнопок-фильтров), по убыванию частоты; числа — по порядку. */
export function facetValues(items, key) {
  const m = new Map();
  for (const it of items) { const v = it._f[key]; if (v) m.set(v, (m.get(v) || 0) + 1); }
  const num = (v) => parseFloat(String(v).replace(/^M/, ''));
  if (key === 'pipe' || key === 'section') return [...m].sort((a, b) => bySize(a[0].split('|')[1] ?? a[0], b[0].split('|')[1] ?? b[0]) || (pipeParts(a[0]).len || 1e9) - (pipeParts(b[0]).len || 1e9));
  return [...m].sort((a, b) => (key === 'type' ? b[1] - a[1] || a[0].localeCompare(b[0], 'ru') : num(a[0]) - num(b[0]) || a[0].localeCompare(b[0])));
}
