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

import { parseWhenParts, whenCodes } from '../../common/passport/traits';

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
  /** Условие по признакам изделия (C054): строка `when` — пробел «и», `|` «или», `!` «не»; пусто — пункт общий. Разбор — parseWhen. */
  when?: string;
}

export type PassportFields = Record<string, unknown>;
/** Нормативы: код → обозначение («ГОСТ Р 52301–2013»). */
export type StandardsDict = Record<string, string>;

export interface ComposeOptions {
  /** Внутренний сбор используемых полей до подстановки значений; в ответ/снимок не попадает. */
  usedFields?: Set<string>;
  standards?: StandardsDict;
  /** Номер первого раздела (по умолчанию 1). */
  startNumber?: number;
  /** Признаки, про которые ничего не известно (соединения не выбраны): пункт с `when` на них не выводится и просит выбор. */
  unknownTraits?: string[];
}

export interface ComposedItem { key: string; number: string | null; text: string; bullet: boolean }
export interface ComposedSection { key: string; number: string; title: string; items: ComposedItem[] }
/** Пункт, не вошедший в паспорт из-за `when`; unknown — признак не определён (не «условие ложно»). */
export interface ExcludedItem { section: string; key: string; when: string; unknown?: true }
export interface ComposeResult { sections: ComposedSection[]; missing: string[]; excluded: ExcludedItem[]; needJoints: boolean }

/** Имя поля паспорта, по которому условия `when` смотрят признаки изделия (список кодов). */
export const TRAITS_FIELD = 'traits';

/**
 * Строка `when` → условие для evalCondition над полем `traits`: пробел — И, `a|b` — ИЛИ, `!a` — НЕ.
 * Пусто — undefined (пункт общий). Ошибка в строке — WhenError (traits.ts). Вычислитель один — evalCondition.
 */
export function parseWhen(when: unknown): PassportCondition | undefined {
  const parts = parseWhenParts(when);
  if (!parts.length) return undefined;
  const leaf = (a: { code: string; not: boolean }): PassportCondition => {
    const eq: PassportCondition = { field: TRAITS_FIELD, op: 'eq', value: a.code };
    return a.not ? { not: eq } : eq;
  };
  return { all: parts.map((alts) => ({ any: alts.map(leaf) })) };
}

/** Условие из БД не должно ронять сборку: ошибочная строка читается как «условия нет» (проверка — при сохранении). */
const safeWhen = (when: unknown): PassportCondition | undefined => { try { return parseWhen(when); } catch { return undefined; } };

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

function substitute(text: string, passport: PassportFields, standards: StandardsDict, missing: Set<string>, usedFields?: Set<string>): string {
  return text.replace(VAR_RE, (_m, name: string) => {
    if (name.startsWith('std:')) {
      const val = standards[name.slice(4)];
      if (isEmpty(val)) { missing.add(name); return `[{${name}} не найден]`; }
      return val;
    }
    usedFields?.add(name);
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
  const allOrder = new Map<string, number | undefined>();
  const idOf = (b: PassportTextBlock) => `${b.sectionKey}\u0000${b.key}`;
  for (const b of blocks) { if (catOf(b) === ALL_CATEGORY && !allOrder.has(idOf(b))) allOrder.set(idOf(b), b.order); }
  blocks.forEach((b, idx) => {
    const c = catOf(b);
    const id = idOf(b);
    if (c === ALL_CATEGORY) { if (!picked.has(id)) picked.set(id, { b, idx }); }
    // пункт категории встаёт на место заменённого (его order), а не на своё по номеру: замена идёт по коду, не по позиции
    else if (cat && c === cat) picked.set(id, { b: allOrder.has(id) ? { ...b, order: allOrder.get(id) } : b, idx });
  });
  const unknown = new Set(options.unknownTraits || []);
  const excluded: ExcludedItem[] = [];
  let needJoints = false;
  const chosen = [...picked.values()].filter((x) => {
    if (!evalCondition(x.b.condition, passport)) return false;
    const when = (x.b.when || '').trim();
    if (!when) return true;
    // признак не определён (соединения не выбраны): пункт не выводим и просим выбор — иначе «нет болтов» молча станет истиной
    if (whenCodes(when).some((c) => unknown.has(c))) { excluded.push({ section: x.b.sectionKey, key: x.b.key, when, unknown: true }); needJoints = true; return false; }
    if (evalCondition(safeWhen(when), passport)) return true;
    excluded.push({ section: x.b.sectionKey, key: x.b.key, when });
    return false;
  });

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
      title: substitute(title, passport, standards, missing, options.usedFields),
      items: items.map((x) => {
        const bullet = !!x.b.bullet;
        if (!bullet) n += 1;
        return { key: x.b.key, number: bullet ? null : `${num}.${n}`, bullet, text: substitute(x.b.text, passport, standards, missing, options.usedFields) };
      }),
    };
  });

  return { sections, missing: [...missing], excluded, needJoints };
}

/**
 * Структура старого шаблона (без импорта, чтобы модуль оставался независимым).
 * ids — устойчивые коды пунктов (параллельно paragraphs): по ним категория заменяет пункт «Для всех», правка снимка и воронка
 * находят пункт; нет ids — прежние p1…pN по позиции. when — условие пункта (строка или null), тоже параллельно paragraphs.
 * kppdf и PDF v1 читают только paragraphs.
 */
export interface LegacyTemplateLike { sections: Array<{ key: string; title: string; paragraphs: string[]; ids?: string[]; when?: Array<string | null> }> }

export interface SectionItem { id: string; text: string; when: string | null }

/**
 * Пункты раздела: текст + код + условие. strict (сохранение, тесты): длины массивов ids / when должны совпадать с paragraphs,
 * коды не повторяются — иначе ошибка. Не strict (сборка паспорта): повреждённые массивы читаются как «нет», чтобы одна
 * плохая запись не роняла чужие паспорта.
 */
export function sectionItems(sec: { key?: string; paragraphs: string[]; ids?: string[]; when?: Array<string | null> }, strict = true): SectionItem[] {
  const n = sec.paragraphs.length;
  const okLen = (a: unknown[] | undefined) => !Array.isArray(a) || a.length === n;
  if (strict) {
    if (!okLen(sec.ids)) throw new Error(`Раздел ${sec.key ?? ''}: ids (${sec.ids?.length}) не совпадает по длине с paragraphs (${n})`);
    if (!okLen(sec.when)) throw new Error(`Раздел ${sec.key ?? ''}: when (${sec.when?.length}) не совпадает по длине с paragraphs (${n})`);
    const ids = (sec.ids ?? []).map(String);
    if (new Set(ids).size !== ids.length || ids.some((x) => !x.trim())) throw new Error(`Раздел ${sec.key ?? ''}: коды пунктов ids пустые или повторяются`);
  }
  const ids = Array.isArray(sec.ids) && sec.ids.length === n ? sec.ids : null;
  const when = Array.isArray(sec.when) && sec.when.length === n ? sec.when : null;
  return sec.paragraphs.map((text, i) => ({ id: String(ids?.[i] ?? '').trim() || `p${i + 1}`, text, when: String(when?.[i] ?? '').trim() || null }));
}

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
    sectionItems(s, false).forEach((it, pi) => {
      const p = it.text;
      const bullet = BULLET.test(p);
      out.push({
        category: ALL_CATEGORY,
        sectionKey: s.key,
        sectionTitle: s.title.replace(LEAD_NUM, ''),
        sectionOrder: si,
        key: it.id,
        order: pi,
        bullet,
        text: bullet ? p : p.replace(LEAD_NUM, ''),
        ...(it.when ? { when: it.when } : {}),
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

/** Запись справочника «Нормативы» (dict_values, dict: passportStandards) — нужные сборщику поля. */
export interface StandardDoc { code?: string; name?: string; status?: string; checkedAt?: string }

/** Справочник нормативов → словарь для {std:КОД} (код → обозначение). Записи без кода или названия пропускаются. */
export function standardsDict(docs: StandardDoc[]): StandardsDict {
  return Object.fromEntries(docs.filter((d) => d.code && d.name).map((d) => [String(d.code), String(d.name)]));
}

/** Коды нормативов, на которые ссылаются блоки ({std:КОД}). */
export function usedStandards(blocks: Array<{ text: string; sectionTitle?: string }>): string[] {
  const out = new Set<string>();
  for (const b of blocks) for (const m of `${b.sectionTitle ?? ''} ${b.text}`.matchAll(/\{std:([A-Za-z0-9_]+)\}/g)) out.add(m[1]);
  return [...out];
}

/**
 * Предупреждения по нормативам (§2): ссылка на документ со статусом не «действует» или проверенный больше 12 мес. назад.
 * Возвращает строки для показа человеку; неизвестный код сюда не попадает — он уже в compose().missing.
 */
export function standardWarnings(codes: string[], docs: StandardDoc[], now = new Date()): string[] {
  const byCode = new Map(docs.filter((d) => d.code).map((d) => [String(d.code), d]));
  const out: string[] = [];
  const yearAgo = new Date(now); yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  for (const c of codes) {
    const d = byCode.get(c);
    if (!d) continue;
    const name = d.name || c;
    if (d.status && d.status !== 'действует') out.push(`${name}: статус «${d.status}»`);
    const checked = d.checkedAt ? new Date(d.checkedAt) : null;
    if (!checked || Number.isNaN(checked.getTime())) out.push(`${name}: не указано, когда проверяли`);
    else if (checked < yearAgo) out.push(`${name}: проверяли больше года назад (${d.checkedAt})`);
  }
  return out;
}
