import { fillBlanks, type BlankRules } from '../../common/print/fill-text';
import { V2_FIELD_LABELS } from './passport-rules';
import { certificateLine, type PassportVariant } from './passport-variants';

/**
 * Правило печати незаполненных меток паспорта (C064 / 2026-11-01):
 *  - ВЫПУЩЕННЫЙ: предложение с пустой переменной не печатается целиком; {std:…} без значения — тоже;
 *  - ЧЕРНОВИК / предпросмотр: метка «[{имя} не заполнено]» остаётся заметной (менеджер видит дыры);
 *  - « до {ageTo}» без значения выпадает хвостом: «от 3 до {ageTo} лет» → «от 3 лет» (TAIL).
 * Пустой раздел после вычищения пунктов — без заголовка. Линии «____» — запасной путь (LINES), в выпуске не используются.
 */
export const BLANK_LINES: Record<string, number> = {
  name: 30, serviceLifeYears: 6, warrantyMonths: 6, ageFrom: 5, ageTo: 5,
  heightMin: 8, heightMax: 8, weightMax: 8, maxUsers: 5, fallHeight: 8, siteLength: 8, siteWidth: 8,
  materials: 16, joints: 16, dimensions: 16, images: 16,
};
/** Все поля-метки: без значения предложение целиком не печатается (выпуск). */
export const BLANK_OPTIONAL: readonly string[] = Object.keys(BLANK_LINES);
export const BLANK_TAIL: readonly string[] = ['ageTo'];
export const PASSPORT_BLANKS: BlankRules = { lines: BLANK_LINES, defaultLine: 16, optional: BLANK_OPTIONAL, tail: BLANK_TAIL };

/** Метки, которые можно встретить в текстах и откуда берётся значение (поле паспорта/изделия); {std:КОД} — справочник «Нормативы»; fig/tab — PDF. */
export const LABEL_SOURCES: Record<string, string> = {
  name: 'Изделие → Название', serviceLifeYears: 'Паспорт → Срок службы', warrantyMonths: 'Паспорт → Гарантия, мес.',
  ageFrom: 'Паспорт → Возраст от', ageTo: 'Паспорт → Возраст до', heightMin: 'Паспорт → Рост пользователя от',
  weightMax: 'Паспорт → Вес пользователя до', maxUsers: 'Паспорт → Пользователей одновременно',
};

/** Пропуски, которые не всегда видны как {метка} в шаблоне — черновик показывает заметную пометку. */
export type PrintGap = 'dimensions' | 'images' | 'materials' | 'joints';

interface Item { key?: string; number?: string | null; text?: string; bullet?: boolean }
interface Section { key?: string; number?: string; title?: string; items?: Item[] }

const GAP_NOTE: Record<PrintGap, string> = {
  dimensions: 'Габариты и вес: [{dimensions} не заполнено].',
  images: 'Рисунки: [{images} не заполнено].',
  materials: 'Материалы: [{materials} не заполнено].',
  joints: 'Конструкция (болты / сварка): [{joints} не заполнено].',
};

/** Копия текста паспорта (`textSnapshot`) для печати. Исходник не меняется. `draft: true` — оставить «не заполнено». */
export function printableText<T extends { sections?: unknown[]; needJoints?: boolean; description?: string }>(
  text: T,
  opts: { variant?: PassportVariant; certificate?: { number?: unknown } | null; category?: string; draft?: boolean; gaps?: PrintGap[] } = {},
): T {
  const draft = !!opts.draft;
  const fill = (s: string) => (draft ? String(s ?? '') : fillBlanks(String(s ?? ''), PASSPORT_BLANKS));
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return fill(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Date) && !('_bsontype' in (v as object))) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const cert = certificateLine(opts.certificate, opts.category);
  const kept = (text.sections ?? []) as Section[];
  const first = parseInt(kept[0]?.number ?? '', 10);
  const built: Section[] = [];
  for (let si = 0; si < kept.length; si += 1) {
    const s0 = kept[si];
    const num = Number.isFinite(first) ? String(first + built.length) : s0.number;
    let n = 0;
    const items: Item[] = [];
    for (const it of s0.items ?? []) {
      const t = fill(String(it.text ?? ''));
      if (!t.trim()) continue; // выпуск: фраза без значения выпала; черновик: пустых не бывает
      if (!it.bullet) n += 1;
      items.push({ ...it, text: t, number: it.bullet ? it.number ?? null : `${num}.${n}` });
    }
    if (!items.length && !(si === 0 && cert)) continue; // пустой раздел — без заголовка
    if (built.length === 0 && cert) items.push({ key: 'certificate', number: null, bullet: true, text: cert });
    built.push({ ...s0, number: num, title: fill(String(s0.title ?? '')), items });
  }
  if (draft) {
    const gaps = new Set<PrintGap>(opts.gaps ?? []);
    if (text.needJoints) gaps.add('joints');
    const notes = [...gaps].map((g) => GAP_NOTE[g]).filter(Boolean);
    if (notes.length) {
      const num = Number.isFinite(first) ? String(first + built.length) : String(built.length + 1);
      built.push({
        key: '_gaps', number: num, title: 'Не заполнено',
        items: notes.map((t, i) => ({ key: `gap_${i}`, number: null, bullet: true, text: t })),
      });
    }
  }
  return { ...(walk({ ...text, sections: undefined }) as object), sections: built } as T;
}

/** Незаполненные метки из `missing` сборщика → пункты «не хватает» ({label,key,hint}); нормативы — из справочника «Нормативы». */
export function blankItems(missing: string[]): Array<{ label: string; key: string; hint: string }> {
  return missing.map((m) => m.startsWith('std:')
    ? { label: `Норматив ${m.slice(4)} не найден`, key: m, hint: 'Документация → Справочники → Нормативы: добавьте запись с этим кодом' }
    : { label: V2_FIELD_LABELS[m] ?? (m === 'name' ? 'Наименование' : m === 'warrantyMonths' ? 'Гарантия, мес.' : m), key: m, hint: LABEL_SOURCES[m] ? `Карточка изделия → ${LABEL_SOURCES[m]}` : `Карточка изделия → Паспорт → «${m}»` });
}
