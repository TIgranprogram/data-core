import { BadRequestException } from '@nestjs/common';

/** Коды категорий блоков текста паспорта (docs/PASSPORTS-V2.md §3.4). ALL — «Для всех». */
export const PASSPORT_CATEGORIES = ['ALL', 'DIO', 'DSP', 'TRN', 'WRK', 'MAF'] as const;
export type PassportCategory = (typeof PASSPORT_CATEGORIES)[number];

/** Пусто/null/ALL → 'ALL'; известный код → он же; иначе 400. */
export function normalizeCategory(v: unknown): PassportCategory {
  if (v === undefined || v === null || v === '') return 'ALL';
  if (typeof v === 'string' && (PASSPORT_CATEGORIES as readonly string[]).includes(v)) return v as PassportCategory;
  throw new BadRequestException(`category: одно из ${PASSPORT_CATEGORIES.join(', ')}`);
}
