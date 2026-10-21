/* Поиск и фильтры склада «как в магазине» (без сервера, по уже загруженному списку).
 * Нормализация — как на сервере (backend/src/modules/stock/search-norm.ts): «м10» = «M10», х/x/× — размер.
 * Фильтры берутся из наименований: «Болт с шестигр. головкой, M10х100, DIN 933» →
 * тип «Болт с шестигр. головкой», резьба M10, длина 100, стандарт DIN 933. */
const LOOKALIKE = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };

export function normSearch(s) {
  return String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[×*]/g, 'х')
    .replace(/[abcehkmoptxy]/g, (ch) => LOOKALIKE[ch]).replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[«»"'(),;]+/g, ' ').replace(/\s+/g, ' ').trim();
}
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

export const FACETS = [['type', 'Тип'], ['thread', 'Резьба'], ['length', 'Длина, мм'], ['std', 'Стандарт']];

/** Подготовить позиции: признаки + строка для поиска (один раз после загрузки). */
export function index(items) {
  for (const it of items) {
    it._f = facetsOf(it.name);
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
  return [...m].sort((a, b) => (key === 'type' ? b[1] - a[1] || a[0].localeCompare(b[0], 'ru') : num(a[0]) - num(b[0]) || a[0].localeCompare(b[0])));
}
