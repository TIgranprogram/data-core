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
