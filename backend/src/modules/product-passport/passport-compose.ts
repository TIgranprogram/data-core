/**
 * Сборщик текста паспорта (БЗ-6 Э2c) — чистая функция, без БД и Nest.
 * Вход: блоки текста (раздел → пункты) по категориям + поля паспорта + категория паспорта.
 * Выход: разделы с номерами (1, 1.1, 1.2 …), подстановка {переменных} и {std:КОД}, список «missing».
 *
 * Правила:
 *  - берутся блоки категории ALL и блоки своей категории;
 *  - блок своей категории с тем же (sectionKey, key), что у блока ALL, ЗАМЕНЯЕТ его (наследование с переопределением);
 *  - блок, у которого condition ложно, пропускается ДО нумерации — дыр в номерах нет; раздел без пунктов не выводится;
 *  - пустая/отсутствующая переменная даёт видимую метку «[{имя} не заполнено]» и запись в result.missing
 *    (для {std:КОД} — «[{std:КОД} не найден]», в missing — «std:КОД»); 0 и false считаются заполненными;
 *  - плейсхолдеры другого вида ({fig:…}, {tab:…}) остаются в тексте как есть — их обрабатывает PDF.
 */

export const ALL_CATEGORY = 'ALL';

/**
 * Условие показа блока. Лист: { field, op, value? }, где field — имя поля паспорта.
 *  op: 'filled' (есть значение) | 'empty' | 'eq' | 'ne' | 'in' (value — массив) | 'gt' | 'gte' | 'lt' | 'lte' (числа).
 *  Булево isKit: { field: 'isKit', op: 'eq', value: true }. Поле-массив (elements) для eq/ne/in: достаточно совпадения с одним элементом.
 * Составные: { all: [...] } (И), { any: [...] } (ИЛИ), { not: cond }.
 */
export type PassportCondition =
  | { field: string; op: 'filled' | 'empty' }
  | { field: string; op: 'eq' | 'ne'; value: unknown }
  | { field: string; op: 'in'; value: unknown[] }
  | { field: string; op: 'gt' | 'gte' | 'lt' | 'lte'; value: number }
  | { all: PassportCondition[] }
  | { any: PassportCondition[] }
  | { not: PassportCondition };

export interface PassportTextBlock {
  /** 'ALL' или код категории; пусто = ALL. */
  category?: string;
  sectionKey: string;
  /** Заголовок раздела (берётся у первого по порядку блока раздела, где он задан). */
  sectionTitle?: string;
  /** Порядок раздела среди разделов. */
  sectionOrder?: number;
  /** Ключ пункта, уникален внутри раздела; по нему категория переопределяет пункт ALL. */
  key: string;
  /** Порядок пункта внутри раздела. */
  order?: number;
  /** Текст с переменными {имя}, {std:КОД}. */
  text: string;
  /** Маркированный пункт («— …»): выводится без номера и не сбивает нумерацию. */
  bullet?: boolean;
  condition?: PassportCondition;
}

export type PassportFields = Record<string, unknown>;
/** Нормативы: код → обозначение («ГОСТ Р 52301–2013»). */
export type StandardsDict = Record<string, string>;

export interface ComposeOptions {
  standards?: StandardsDict;
  /** Номер первого раздела (по умолчанию 1). */
  startNumber?: number;
}

export interface ComposedItem { key: string; number: string | null; text: string; bullet: boolean }
export interface ComposedSection { key: string; number: string; title: string; items: ComposedItem[] }
export interface ComposeResult { sections: ComposedSection[]; missing: string[] }

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

const fmt = (v: unknown): string => {
  if (Array.isArray(v)) return v.map(fmt).join(', ');
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  return String(v).trim();
};

const same = (a: unknown, b: unknown): boolean => a === b || (a != null && b != null && String(a) === String(b));

/** Вычисляет условие по полям паспорта. */
export function evalCondition(cond: PassportCondition | undefined, passport: PassportFields): boolean {
  if (!cond) return true;
  if ('all' in cond) return cond.all.every((c) => evalCondition(c, passport));
  if ('any' in cond) return cond.any.some((c) => evalCondition(c, passport));
  if ('not' in cond) return !evalCondition(cond.not, passport);
  const v = passport?.[cond.field];
  switch (cond.op) {
    case 'filled': return !isEmpty(v);
    case 'empty': return isEmpty(v);
    case 'eq': return Array.isArray(v) ? v.some((x) => same(x, cond.value)) : same(v, cond.value);
    case 'ne': return !(Array.isArray(v) ? v.some((x) => same(x, cond.value)) : same(v, cond.value));
    case 'in': return (Array.isArray(v) ? v : [v]).some((x) => cond.value.some((y) => same(x, y)));
    case 'gt': case 'gte': case 'lt': case 'lte': {
      if (isEmpty(v)) return false;
      const n = Number(v);
      if (Number.isNaN(n)) return false;
      return cond.op === 'gt' ? n > cond.value : cond.op === 'gte' ? n >= cond.value : cond.op === 'lt' ? n < cond.value : n <= cond.value;
    }
    default: return false;
  }
}

const VAR_RE = /\{(std:[^}\s]+|[A-Za-z][A-Za-z0-9_]*)\}/g;

function substitute(text: string, passport: PassportFields, standards: StandardsDict, missing: Set<string>): string {
  return text.replace(VAR_RE, (_m, name: string) => {
    if (name.startsWith('std:')) {
      const val = standards[name.slice(4)];
      if (isEmpty(val)) { missing.add(name); return `[{${name}} не найден]`; }
      return val;
    }
    const v = passport?.[name];
    if (isEmpty(v)) { missing.add(name); return `[{${name}} не заполнено]`; }
    return fmt(v);
  });
}

/** Собирает текст паспорта для категории. */
export function compose(
  blocks: PassportTextBlock[],
  passport: PassportFields,
  category: string | undefined | null,
  options: ComposeOptions = {},
): ComposeResult {
  const cat = (category || '').trim();
  const standards = options.standards || {};
  const missing = new Set<string>();
  const catOf = (b: PassportTextBlock) => (b.category || ALL_CATEGORY).trim() || ALL_CATEGORY;

  // 1) наследование: блок категории заменяет блок ALL с тем же (sectionKey, key) независимо от порядка входа
  const picked = new Map<string, { b: PassportTextBlock; idx: number }>();
  blocks.forEach((b, idx) => {
    const c = catOf(b);
    const id = `${b.sectionKey}\u0000${b.key}`;
    if (c === ALL_CATEGORY) { if (!picked.has(id)) picked.set(id, { b, idx }); }
    else if (cat && c === cat) picked.set(id, { b, idx });
  });
  const chosen = [...picked.values()].filter((x) => evalCondition(x.b.condition, passport));

  // 2) группировка в разделы
  const secs = new Map<string, { key: string; order: number; idx: number; items: typeof chosen }>();
  for (const x of chosen) {
    let s = secs.get(x.b.sectionKey);
    if (!s) { s = { key: x.b.sectionKey, order: Number.POSITIVE_INFINITY, idx: x.idx, items: [] }; secs.set(x.b.sectionKey, s); }
    s.items.push(x);
    s.idx = Math.min(s.idx, x.idx);
    if (x.b.sectionOrder != null) s.order = Math.min(s.order, x.b.sectionOrder);
  }
  const ordered = [...secs.values()].sort((a, b) => (a.order - b.order) || (a.idx - b.idx));

  // 3) нумерация без дыр + подстановка
  const start = options.startNumber ?? 1;
  const sections: ComposedSection[] = ordered.map((s, i) => {
    const num = String(start + i);
    const items = s.items.slice().sort((a, b) => ((a.b.order ?? 0) - (b.b.order ?? 0)) || (a.idx - b.idx));
    const title = items.map((x) => x.b.sectionTitle).find((t) => !!t) || '';
    let n = 0;
    return {
      key: s.key,
      number: num,
      title: substitute(title, passport, standards, missing),
      items: items.map((x) => {
        const bullet = !!x.b.bullet;
        if (!bullet) n += 1;
        return { key: x.b.key, number: bullet ? null : `${num}.${n}`, bullet, text: substitute(x.b.text, passport, standards, missing) };
      }),
    };
  });

  return { sections, missing: [...missing] };
}

/** Структура старого шаблона (без импорта, чтобы модуль оставался независимым). */
export interface LegacyTemplateLike { sections: Array<{ key: string; title: string; paragraphs: string[] }> }

const LEAD_NUM = /^\s*\d+(?:\.\d+)*\.?\s+/;
const BULLET = /^\s*[—–-]\s+/;

/**
 * Адаптер: старый PassportTemplateContent → блоки ALL.
 * Ведущие номера в заголовках и пунктах («3 Инструкция…», «3.1. …») срезаются — их проставляет compose;
 * строки «— …» становятся маркированными (bullet). Чтобы нумерация осталась 3…7, вызывать compose
 * с startNumber: legacyStartNumber(tpl).
 */
export function legacyTemplateToBlocks(tpl: LegacyTemplateLike): PassportTextBlock[] {
  const out: PassportTextBlock[] = [];
  tpl.sections.forEach((s, si) => {
    s.paragraphs.forEach((p, pi) => {
      const bullet = BULLET.test(p);
      out.push({
        category: ALL_CATEGORY,
        sectionKey: s.key,
        sectionTitle: s.title.replace(LEAD_NUM, ''),
        sectionOrder: si,
        key: `p${pi + 1}`,
        order: pi,
        bullet,
        text: bullet ? p : p.replace(LEAD_NUM, ''),
      });
    });
  });
  return out;
}

/** Номер первого раздела старого шаблона из его заголовка («3 Инструкция…» → 3); по умолчанию 1. */
export function legacyStartNumber(tpl: LegacyTemplateLike): number {
  const m = /^\s*(\d+)\b/.exec(tpl.sections[0]?.title || '');
  return m ? Number(m[1]) : 1;
}
