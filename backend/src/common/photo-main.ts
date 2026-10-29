import { NotFoundException } from '@nestjs/common';
import type { Types } from 'mongoose';

type Upd = (filter: Record<string, unknown>, update: Record<string, unknown>) => Promise<{ matchedCount: number; modifiedCount: number }>;

/**
 * «Сделать главным»: фото переезжает в начало `photoIds` — первое фото и есть главное (обложка в списках, карточке, КП).
 * Фото не из этой записи — 404 (ничего не добавляется). Mongo 4.4: $push с $position.
 */
export async function photoToFront(update: Upd, filter: Record<string, unknown>, pid: Types.ObjectId, what = 'Фото') {
  const r = await update({ ...filter, photoIds: pid }, { $pull: { photoIds: pid } });
  if (!r.matchedCount) throw new NotFoundException(`${what} не найдено в этой записи`);
  await update(filter, { $push: { photoIds: { $each: [pid], $position: 0 } } });
}
