import { fillBlanks, type BlankRules } from '../../common/print/fill-text';
import { V2_FIELD_LABELS } from './passport-rules';
import { certificateLine, type PassportVariant } from './passport-variants';

/**
 * Правило печати незаполненных меток паспорта (решение пользователя 2026-11-01): в PDF не уходит «{…}».
 *  - поля, которые вписывают от руки (числа, наименование), → линия «____» нужной длины (LINES);
 *  - необязательные фразы (ограничения пользователя, нормативы) без значения не печатаются целиком (OPTIONAL);
 *  - « до {ageTo}» без значения выпадает как хвост: «от 3 до {ageTo} лет» → «от 3 лет» (TAIL).
 * Метки {std:КОД} всегда необязательны: нет нормативу в справочнике — фраза с ним не печатается.
 */
export const BLANK_LINES: Record<string, number> = {
  name: 30, serviceLifeYears: 6, warrantyMonths: 6, ageFrom: 5, ageTo: 5,
  heightMin: 8, heightMax: 8, weightMax: 8, maxUsers: 5, fallHeight: 8, siteLength: 8, siteWidth: 8,
};
/** Фразы о пределах использования: без значения вписывать нечего — предложение с меткой не печатается. */
export const BLANK_OPTIONAL: readonly string[] = ['heightMin', 'weightMax', 'maxUsers'];
export const BLANK_TAIL: readonly string[] = ['ageTo'];
export const PASSPORT_BLANKS: BlankRules = { lines: BLANK_LINES, defaultLine: 16, optional: BLANK_OPTIONAL, tail: BLANK_TAIL };

/** Метки, которые можно встретить в текстах и откуда берётся значение (поле паспорта/изделия); {std:КОД} — справочник «Нормативы»; fig/tab — PDF. */
export const LABEL_SOURCES: Record<string, string> = {
  name: 'Изделие → Название', serviceLifeYears: 'Паспорт → Срок службы', warrantyMonths: 'Паспорт → Гарантия, мес.',
  ageFrom: 'Паспорт → Возраст от', ageTo: 'Паспорт → Возраст до', heightMin: 'Паспорт → Рост пользователя от',
  weightMax: 'Паспорт → Вес пользователя до', maxUsers: 'Паспорт → Пользователей одновременно',
};

interface Item { key?: string; number?: string | null; text?: string; bullet?: boolean }
interface Section { key?: string; number?: string; title?: string; items?: Item[] }

/** Копия текста паспорта (`textSnapshot`) для печати: метки заменены линиями, лишние фразы убраны, пункты перенумерованы. Исходник не меняется. */
export function printableText<T extends { sections?: unknown[] }>(text: T, opts: { variant?: PassportVariant; certificate?: { number?: unknown } | null; category?: string } = {}): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return fillBlanks(v, PASSPORT_BLANKS);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Date) && !('_bsontype' in (v as object))) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const cert = certificateLine(opts.certificate, opts.category);
  const kept = (text.sections ?? []) as Section[];
  const first = parseInt(kept[0]?.number ?? '', 10);
  const sections = kept.map((s0, si) => {
    // журналы (таблицы хранения и неисправностей) есть в обоих вариантах; номера разделов идут подряд
    const s = Number.isFinite(first) ? { ...s0, number: String(first + si) } : s0;
    let n = 0;
    const items: Item[] = [];
    for (const it of s.items ?? []) {
      const t = fillBlanks(String(it.text ?? ''), PASSPORT_BLANKS);
      if (!t.trim()) continue; // фраза целиком необязательная и без значения
      if (!it.bullet) n += 1;
      items.push({ ...it, text: t, number: it.bullet ? it.number ?? null : `${s.number}.${n}` });
    }
    if (si === 0 && cert) items.push({ key: 'certificate', number: null, bullet: true, text: cert });
    return { ...s, title: fillBlanks(String(s.title ?? ''), PASSPORT_BLANKS), items };
  });
  return { ...(walk({ ...text, sections: undefined }) as object), sections } as T;
}

/** Незаполненные метки из `missing` сборщика → пункты «не хватает» ({label,key,hint}); нормативы — из справочника «Нормативы». */
export function blankItems(missing: string[]): Array<{ label: string; key: string; hint: string }> {
  return missing.map((m) => m.startsWith('std:')
    ? { label: `Норматив ${m.slice(4)} не найден`, key: m, hint: 'Документация → Справочники → Нормативы: добавьте запись с этим кодом' }
    : { label: V2_FIELD_LABELS[m] ?? (m === 'name' ? 'Наименование' : m === 'warrantyMonths' ? 'Гарантия, мес.' : m), key: m, hint: LABEL_SOURCES[m] ? `Карточка изделия → ${LABEL_SOURCES[m]}` : `Карточка изделия → Паспорт → «${m}»` });
}
