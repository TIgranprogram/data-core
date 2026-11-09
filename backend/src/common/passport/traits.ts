/**
 * Признаки изделия для условий паспорта (C054, docs/crew/C054-passport-funnel/ADVICE.md §1, §3).
 * Пункт текста, дефект или пиктограмма с `when` попадает в паспорт, только если условие совпало с признаками изделия.
 * Признаки берутся из справочников (`traits` у видов, материалов, способов установки) и из выбора «Конструкция» (`joints`).
 * Чистые функции, без БД и Nest: словарь, разбор строки `when`, нормализация списков кодов.
 */

/** Код признака → подпись для человека (экран, ошибки, аудит). */
export const PASSPORT_TRAITS: Readonly<Record<string, string>> = {
  bolts: 'Болтовые соединения',
  welds: 'Сварные швы',
  metal: 'Металл',
  wood: 'Древесина',
  concrete: 'Опоры бетонируют',
  anchors: 'Анкеры и шпильки',
  freestanding: 'Лежит или стоит на основании, без крепления',
  moving: 'Подвижные части',
  walkable: 'По изделию можно ходить',
  atTree: 'Приствольное размещение',
};
export const PASSPORT_TRAIT_CODES: readonly string[] = Object.keys(PASSPORT_TRAITS);

/** Соединения конструкции: «Болтовые», «Сварные», «Цельное». Вместе дают признаки bolts / welds. */
export const PASSPORT_JOINTS: Readonly<Record<string, string>> = { bolts: 'Болтовые', welds: 'Сварные', solid: 'Цельное, без болтов и сварки' };
export const PASSPORT_JOINT_CODES: readonly string[] = Object.keys(PASSPORT_JOINTS);

/** Признаки, про которые пока ничего не известно, если не выбраны соединения (три состояния: да / нет / неизвестно). */
export const JOINT_TRAITS: readonly string[] = ['bolts', 'welds'];

/** Одна часть условия: «любой из» кодов; у каждого кода признак `not` (`!код`). */
export interface WhenAlt { code: string; not: boolean }
export type WhenParts = WhenAlt[][];

/** Ошибка разбора `when` — текст уже для человека. */
export class WhenError extends Error {}

const SPLIT = /\s+/;

/**
 * Разбор строки условия: пробел — И, `|` — ИЛИ, `!` перед кодом — НЕ. Пусто / null — условия нет (пустой список).
 * Неизвестный код, пустое место рядом с `|`, одинокий `!` — `WhenError`.
 */
export function parseWhenParts(when: unknown): WhenParts {
  const src = String(when ?? '').trim();
  if (!src) return [];
  return src.split(SPLIT).map((token) => token.split('|').map((raw) => {
    const not = raw.startsWith('!');
    const code = not ? raw.slice(1) : raw;
    if (!code) throw new WhenError(`Условие «${src}»: после «!» или рядом с «|» нет признака`);
    if (!PASSPORT_TRAIT_CODES.includes(code)) throw new WhenError(`Неизвестный признак: ${code}. Допустимые: ${PASSPORT_TRAIT_CODES.join(', ')}`);
    return { code, not };
  }));
}

/** Текст ошибки условия или null, если оно верное (для проверки при сохранении). */
export function whenProblem(when: unknown): string | null {
  try { parseWhenParts(when); return null; } catch (e) { if (e instanceof WhenError) return e.message; throw e; }
}

/** Все коды признаков, упомянутые в условии (для «неизвестно»). Ошибочное условие — пусто. */
export function whenCodes(when: unknown): string[] {
  try { return [...new Set(parseWhenParts(when).flat().map((a) => a.code))]; } catch { return []; }
}

/** Список кодов признаков из строки через запятую или массива; неизвестный код — `WhenError`. Порядок словаря, без повторов. */
export function parseTraits(v: unknown): string[] {
  const list = (Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/)).map((x) => String(x ?? '').trim()).filter(Boolean);
  const bad = list.find((c) => !PASSPORT_TRAIT_CODES.includes(c));
  if (bad) throw new WhenError(`Неизвестный признак: ${bad}. Допустимые: ${PASSPORT_TRAIT_CODES.join(', ')}`);
  return PASSPORT_TRAIT_CODES.filter((c) => list.includes(c));
}

/** Соединения паспорта: список кодов или null (не выбрано); неизвестный код — `WhenError`. */
export function parseJoints(v: unknown): string[] | null {
  if (v === undefined || v === null || v === '') return null;
  const list = (Array.isArray(v) ? v : String(v).split(/[,;\s]+/)).map((x) => String(x ?? '').trim()).filter(Boolean);
  const bad = list.find((c) => !PASSPORT_JOINT_CODES.includes(c));
  if (bad) throw new WhenError(`Неизвестное соединение: ${bad}. Допустимые: ${PASSPORT_JOINT_CODES.join(', ')}`);
  return list.length ? PASSPORT_JOINT_CODES.filter((c) => list.includes(c)) : null;
}
