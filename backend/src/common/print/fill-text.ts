/**
 * Печать документов: метки и пустые значения (решение пользователя 2026-11-01). Чистые функции, без Nest и БД.
 * В PDF никогда не уходят «{метка}», «undefined», «null», «NaN», «[object Object]», «Invalid Date».
 *  - fillBlanks: незаполненная метка → линия «____» (заполнить ручкой) либо необязательная фраза не печатается;
 *  - printSafe: финальный предохранитель по готовой строке (с предупреждением в лог, не падает);
 *  - guardDoc (safe-doc.ts) ставит printSafe на каждый вызов doc.text().
 */

/** Линия для заполнения ручкой: число — коротко, дата/номер — средне, имя/объект — длинно. */
export const LINE_SHORT = '________';
export const LINE_MID = '________________';
export const LINE_LONG = '______________________________';
export const blankLine = (len = 16): string => '_'.repeat(Math.max(3, Math.min(60, len)));

export interface BlankRules {
  /** Длина линии по имени метки; нет в списке — `defaultLine`. */
  lines?: Record<string, number>;
  defaultLine?: number;
  /** Метки необязательных фраз: предложение с такой меткой без значения не печатается целиком. Метки «std:…» — всегда такие. */
  optional?: readonly string[];
  /** Метки «хвоста» вида « до {метка}»: без значения выпадает только хвост («от 3 лет»), предложение остаётся. */
  tail?: readonly string[];
}

/** Метка: «[{имя} не заполнено]» / «[{std:КОД} не найден]» (так её оставляет compose) или «{имя}» (не {fig:…}/{tab:…}). */
const MARK = String.raw`\[\{([^{}\s]+)\}(?: не заполнено| не найден)?\]|\{([A-Za-z][A-Za-z0-9_]*|std:[^{}\s]+)\}`;

const nameOf = (m: RegExpMatchArray): string => m[1] ?? m[2];

/** Убирает лишние пробелы и знаки, оставшиеся после вырезанной фразы. */
export function tidyText(s: string): string {
  return s
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(\s*[,;:])+/g, '$1')
    .replace(/,\s*\./g, '.')
    .replace(/\.{2,}/g, '.')
    .trim();
}

const SENTENCE = /[\s\S]*?[.!?](?=\s|$)|[\s\S]+$/g;
/** Точка после сокращения («мес.», «рис.», «табл.») — не конец предложения (C064: иначе остаётся обрывок «со дня…»). \b не видит кириллицу. */
const ABBR = /(?<![\p{L}\p{N}_])(мес|г|ул|пр|стр|корп|оф|тел|рис|табл|см)\./giu;
const splitSentences = (s: string): string[] => {
  const protected_ = s.replace(ABBR, (m) => `${m.slice(0, -1)}\uE000`);
  return (protected_.match(SENTENCE) ?? [protected_]).map((p) => p.replace(/\uE000/g, '.'));
};

/** Подставляет вместо незаполненных меток линию или убирает необязательные фразы. Текст без меток возвращается как есть. */
export function fillBlanks(text: string, rules: BlankRules = {}): string {
  if (typeof text !== 'string' || !/[{]/.test(text)) return text;
  const optional = new Set(rules.optional ?? []);
  const tail = new Set(rules.tail ?? []);
  const isOptional = (n: string) => n.startsWith('std:') || optional.has(n);
  const lineOf = (n: string) => blankLine(rules.lines?.[n] ?? rules.defaultLine ?? 16);
  let s = text;
  for (const n of tail) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(String.raw`\s+(?:до|от)\s+(?:\[\{${esc}\}(?: не заполнено| не найден)?\]|\{${esc}\})`, 'g'), '');
  }
  const out = splitSentences(s).map((sent) => {
    const marks = [...sent.matchAll(new RegExp(MARK, 'g'))];
    if (!marks.length) return sent;
    if (marks.some((m) => isOptional(nameOf(m)))) return '';
    return sent.replace(new RegExp(MARK, 'g'), (...a) => lineOf((a[1] ?? a[2]) as string));
  });
  return tidyText(out.join(''));
}

const BAD_WORD = /(?<![\wа-яё])(?:undefined|null|NaN|Invalid Date|\[object Object\])(?![\wа-яё])/g;
const LEFT_BRACES = /\{[^{}\s]{1,60}\}/g;

/** Есть ли в строке то, что в печать уходить не должно. */
export const hasLeak = (s: string): boolean => /\{[^{}\s]{1,60}\}|(?<![\wа-яё])(?:undefined|null|NaN|Invalid Date|\[object Object\])(?![\wа-яё])/.test(s);

/** Финальный предохранитель: осталось «{…}» или «undefined» — заменяется линией, `onWarn` получает найденное. Не бросает. */
export function printSafe(s: unknown, onWarn?: (found: string[]) => void): string {
  if (s === undefined || s === null) return '';
  if (typeof s === 'number') return Number.isFinite(s) ? String(s) : LINE_SHORT;
  const str = String(s);
  if (!hasLeak(str)) return str;
  onWarn?.([...(str.match(LEFT_BRACES) ?? []), ...(str.match(BAD_WORD) ?? [])]);
  return str.replace(LEFT_BRACES, LINE_MID).replace(BAD_WORD, LINE_SHORT);
}
