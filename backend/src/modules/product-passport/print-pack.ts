import { BadRequestException } from '@nestjs/common';

/** Режим печати комплекта. `variant` (short|full) — другое: объём текста паспорта, не этот выбор. */
export const PRINT_PACKS = ['passport', 'tech', 'combined'] as const;
export type PrintPack = (typeof PRINT_PACKS)[number];

/** Пусто и «passport» — как раньше (старые клиенты параметр не шлют). Чужое значение — 400. */
export function packOf(v: unknown): PrintPack {
  if (v === undefined || v === null || v === '') return 'passport';
  const s = String(v);
  if (s === 'passport' || s === 'tech' || s === 'combined') return s;
  throw new BadRequestException('Режим печати: passport (только паспорт), tech (только техническое описание) или combined (паспорт, затем техописание)');
}
