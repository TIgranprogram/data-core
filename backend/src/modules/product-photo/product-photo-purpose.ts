import { BadRequestException } from '@nestjs/common';
import { PASSPORT_IMAGE_KINDS } from '../product-passport/product-passport.schema';

/** Назначение фото изделия. Нет поля = витрина (так пишет и читает CRM). */
export const PHOTO_PURPOSES = ['showcase', 'passport', 'drawing'] as const;
export type PhotoPurpose = (typeof PHOTO_PURPOSES)[number];

/**
 * Фильтр по назначению. Без параметра — только витрина и записи без поля (как было до purpose);
 * неизвестное значение — 400.
 */
export function purposeFilter(purpose?: string): Record<string, unknown> {
  const p = String(purpose ?? '').trim();
  if (!p || p === 'showcase') return { $or: [{ purpose: { $exists: false } }, { purpose: null }, { purpose: 'showcase' }] };
  if (!(PHOTO_PURPOSES as readonly string[]).includes(p)) throw new BadRequestException(`Неизвестное назначение «${p}»: ${PHOTO_PURPOSES.join(', ')}`);
  return { purpose: p };
}

/** Проверка пары purpose/kind: вид рисунка — только у «для паспорта», и он там обязателен. */
export function checkPurposeKind(purpose?: string, kind?: string): void {
  if (purpose !== undefined && !(PHOTO_PURPOSES as readonly string[]).includes(purpose)) throw new BadRequestException(`Неизвестное назначение «${purpose}»`);
  if (purpose === 'passport') {
    if (!kind) throw new BadRequestException('Для фото «для паспорта» укажите вид рисунка (kind)');
    if (!(PASSPORT_IMAGE_KINDS as readonly string[]).includes(kind)) throw new BadRequestException(`Неизвестный вид рисунка «${kind}»`);
  } else if (kind) throw new BadRequestException('Вид рисунка (kind) задаётся только для фото «для паспорта»');
}
