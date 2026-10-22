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

interface VersionLike { version: number; isActive?: boolean; category?: string | null }

const catOf = (t: VersionLike): string => (t.category ? t.category : 'ALL');

/** Последняя активная версия именно этой категории (без подстановки ALL); нет — null. Версии без category = ALL. */
export function pickOwnVersion<T extends VersionLike>(docs: T[], category: PassportCategory): T | null {
  let best: T | null = null;
  for (const d of docs) {
    if (d.isActive === false || catOf(d) !== category) continue;
    if (!best || d.version > best.version) best = d;
  }
  return best;
}

/** Версия для показа: своя категория, иначе «Для всех», иначе null. */
export function pickTemplateVersion<T extends VersionLike>(docs: T[], category: PassportCategory): T | null {
  return pickOwnVersion(docs, category) ?? (category === 'ALL' ? null : pickOwnVersion(docs, 'ALL'));
}
