import { ConflictException } from '@nestjs/common';
import type { Types } from 'mongoose';
import { skuRegex } from '../../common/text/search-norm';
import type { CounterService } from '../counter/counter.service';
import type { Db } from './showcase-common';

/** Название счётчика автоартикула; префикс счётчика — номер группы. */
export const SKU_ENTITY = 'ProductSku';
const MAX_SEQ = 99;
const WARN_FROM = 90;
export const pad2 = (n: number) => String(n).padStart(2, '0');

/** Номер группы (`categories.groupNo`) или null, если группы нет / номер не задан. */
export async function groupNoOf(db: Db, groupId: Types.ObjectId | null): Promise<{ groupNo: string; name: string } | null> {
  if (!groupId) return null;
  const c = await db.collection('categories').findOne({ _id: groupId, deletedAt: null }, { projection: { groupNo: 1, name: 1 } });
  const no = c?.groupNo ? String(c.groupNo) : '';
  return no ? { groupNo: no, name: String(c?.name ?? '') } : null;
}

/**
 * Следующий свободный артикул группы: номер группы + два знака счётчика (1280 → группа 12, №80).
 * Счётчик монотонный (номер после удаления не повторяется); занятые — в т. ч. в корзине и ручные — пропускаются.
 * Больше 99 — 409. Нет номера у группы — null (вызывающий решает, что делать).
 */
export async function nextSku(db: Db, counter: CounterService, groupId: Types.ObjectId | null): Promise<{ sku: string; warning?: string } | null> {
  const g = await groupNoOf(db, groupId);
  if (!g) return null;
  const full = () => new ConflictException(`В группе «${g.name}» заняты номера 01–99. Создайте новую группу или введите артикул вручную`);
  for (let i = 0; i < 100; i++) {
    const seq = await counter.nextSeq(SKU_ENTITY, g.groupNo);
    if (seq > MAX_SEQ) throw full();
    const sku = g.groupNo + pad2(seq);
    if (await db.collection('products').findOne({ sku: skuRegex(sku) }, { projection: { _id: 1 } })) continue;
    return { sku, ...(seq >= WARN_FROM ? { warning: `В группе «${g.name}» остаётся ${MAX_SEQ - seq} номеров из 99` } : {}) };
  }
  throw full();
}
