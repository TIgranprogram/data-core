import { BadRequestException } from '@nestjs/common';

/** Чей файл: изделия (`productId`) или покупного материала (`materialId`, C136). */
export type AttachmentOwner = 'productId' | 'materialId';

/** Вид файла покупного материала: заводится сам при старте, пользователь его не выбирает. */
export const SUPPLIER_PASSPORT_TYPE = 'Паспорт поставщика';

/** Ровно одно из двух полей: у файла либо изделие, либо материал. */
export function assertOneOwner(doc: { productId?: unknown; materialId?: unknown }): void {
  if (!doc.productId === !doc.materialId) throw new BadRequestException('У файла должно быть ровно одно из полей: изделие или материал.');
}

interface Live { _id?: unknown; uploadedAt?: Date | string | null; deletedAt?: Date | null }

/** Действующий паспорт поставщика — последний живой по дате загрузки; убранные не считаются. */
export function currentOf<T extends Live>(rows: T[]): T | null {
  const live = rows.filter((r) => !r.deletedAt);
  live.sort((a, b) => new Date(b.uploadedAt ?? 0).getTime() - new Date(a.uploadedAt ?? 0).getTime());
  return live[0] ?? null;
}
