import { PASSPORT_CATEGORY_CODES } from '../showcase/passport-defaults';

/**
 * Паспорт каждого справочника для экрана «Справочники» (DICT, 2026-10-25): где значения применяются (разделы приложения),
 * как значение хранится в данных и что встроено в программу.
 * refBy: 'name' — в данных лежит СТРОКА с названием: переименование каскадом правит данные; 'id' — ссылка по id/коду: каскад запрещён.
 */
export type DictMeta = {
  sections: string[];
  refBy: 'name' | 'id';
  /** Связь с данными не отслеживается (удаление свободно). */
  untracked?: true;
  /** Причина, по которой запись нельзя удалить (встроена в программу); null — можно. */
  locked?: (d: Record<string, unknown>) => string | null;
};

export const BUILTIN_REASON = 'Встроено в программу';

/** Категории паспорта, которые знает код: «Для всех» и пять видов изделий (коды — из showcase/passport-defaults). */
const CATEGORY_CODES: readonly string[] = ['ALL', ...PASSPORT_CATEGORY_CODES];
/** «Оформление» PDF: цвета категорий, рамка, обложки и пиктограммы правил, заведённые программой (`scripts/seed-passport-dicts.js`). */
const STYLE_ICONS = ['INSPECT', 'NO_WET', 'MAX_USERS', 'NO_CLIMB', 'NO_PUSH', 'SHOES', 'KIDS_ADULT', 'REPORT'];
const STYLE_CODES: readonly string[] = [...CATEGORY_CODES.map((c) => `COLOR_${c}`), 'FRAME_ALL', ...STYLE_ICONS.map((i) => `ICON_${i}`)];
const code = (d: Record<string, unknown>) => String(d.code ?? '').trim().toUpperCase();

export const DICT_META: Record<string, DictMeta> = {
  categories: { sections: ['Остатки', 'Заявки'], refBy: 'id' },
  productGroups: { sections: ['Продукция'], refBy: 'id' },
  productSections: { sections: ['Продукция'], refBy: 'id' },
  units: { sections: ['Остатки', 'Заявки'], refBy: 'name' },
  writeOffReasons: { sections: ['Остатки'], refBy: 'name' },
  colors: { sections: ['Остатки', 'Заявки', 'Позиции и оплаты'], refBy: 'name' },
  metalAssortments: { sections: ['Остатки'], refBy: 'name' },
  steelGrades: { sections: ['Остатки'], refBy: 'name' },
  persons: { sections: ['Заявки', 'Остатки', 'ФОТ'], refBy: 'name' },
  worktypes: { sections: ['ФОТ', 'Остатки'], refBy: 'id' },
  payoutSchedules: { sections: ['ФОТ'], refBy: 'id' },
  invoiceTypes: { sections: ['Заявки'], refBy: 'name' },
  paymentForms: { sections: ['Позиции и оплаты', 'Платёжный календарь'], refBy: 'name' },
  services: { sections: ['Заявки'], refBy: 'id', untracked: true },
  passportCategories: { sections: ['Документация', 'Продукция'], refBy: 'id', locked: (d) => (CATEGORY_CODES.includes(code(d)) ? BUILTIN_REASON : null) },
  passportStandards: { sections: ['Документация'], refBy: 'id' },
  passportElements: { sections: ['Документация'], refBy: 'id' },
  passportMaterials: { sections: ['Документация', 'Продукция'], refBy: 'id' },
  passportSortament: { sections: ['Продукция', 'Документация'], refBy: 'name' },
  passportParts: { sections: ['Документация', 'Продукция'], refBy: 'id' },
  passportDefects: { sections: ['Документация'], refBy: 'id' },
  passportInstall: { sections: ['Документация'], refBy: 'id' },
  passportPhrases: { sections: ['Документация'], refBy: 'id' },
  passportStyle: { sections: ['Документация'], refBy: 'id', untracked: true, locked: (d) => (STYLE_CODES.includes(code(d)) || /^COVER_/.test(code(d)) ? BUILTIN_REASON : null) },
};
