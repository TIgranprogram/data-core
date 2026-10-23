/**
 * Поиск по складу «как в магазине»: «м10 гайка» находит «Гайка шестигр., M10, DIN 934».
 * - регистр и «ё» не важны;
 * - латиница и кириллица одинакового вида равны (M10 латиницей = М10 кириллицей, х/x/×/* — размер);
 * - слова запроса ищутся в любом порядке, каждое должно встретиться (И), «гайк» найдёт «гайка».
 */
const LOOKALIKE: Record<string, string> = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };

export function normSearch(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[×*]/g, 'х')
    .replace(/[abcehkmoptxy]/g, (ch) => LOOKALIKE[ch])
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[«»"'(),;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Слова запроса (после нормализации); «м 10» склеивается в «м10» — так пишут резьбу. */
export function searchTokens(q: unknown): string[] {
  return normSearch(q).replace(/(^|\s)м\s+(\d)/g, '$1м$2').split(' ').filter(Boolean);
}

/** Все слова запроса есть в одном из полей (поля склеиваются). */
export function matchesAll(tokens: string[], ...fields: unknown[]): boolean {
  if (!tokens.length) return true;
  const hay = normSearch(fields.filter(Boolean).join(' '));
  return tokens.every((t) => hay.includes(t));
}

/** Регулярка для слова поиска в БД: «м10» находит и «М10», и «M10» (похожие буквы кириллицы/латиницы — оба варианта). */
const PAIRS: Record<string, string> = { а: 'aа', в: 'bв', с: 'cс', е: 'eеё', н: 'hн', к: 'kк', м: 'mм', о: 'oо', р: 'pр', т: 'tт', х: 'xх×*', у: 'yу' };
export function tokenRegex(token: string): RegExp {
  const src = [...token].map((ch) => {
    const set = PAIRS[ch];
    return set ? `[${set.replace(/[\]\\^*-]/g, '\\$&')}]` : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return new RegExp(src, 'i');
}

/** Фильтр Mongo «как на складе» для списков: каждое слово запроса (И) — в любом из полей (ИЛИ); пусто — null. */
export function tokensFilter(search: unknown, fields: string[]): { $and: Record<string, unknown>[] } | null {
  const tokens = searchTokens(search);
  if (!tokens.length) return null;
  return { $and: tokens.map((tk) => ({ $or: fields.map((f) => ({ [f]: tokenRegex(tk) })) })) };
}

/**
 * Артикул — один и тот же, если отличается только регистром, «ё», похожими буквами кириллицы/латиницы
 * (KC-01 = КС-01) и пробелами по краям / двойными пробелами. Дефисы и пробелы внутри — значимы (А-1 ≠ А1).
 */
export function skuKey(sku: unknown): string {
  return String(sku ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[×*]/g, 'х')
    .replace(/[abcehkmoptxy]/g, (ch) => LOOKALIKE[ch]).replace(/\s+/g, ' ').trim();
}
/** Регулярка «этот же артикул» для поиска дубля в БД (см. skuKey). */
export function skuRegex(sku: unknown): RegExp {
  const k = skuKey(sku);
  const body = [...k].map((ch) => {
    if (ch === ' ') return '\\s+';
    const set = PAIRS[ch];
    return set ? `[${set.replace(/[\]\\^*-]/g, '\\$&')}]` : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return new RegExp(`^\\s*${body}\\s*$`, 'i');
}
