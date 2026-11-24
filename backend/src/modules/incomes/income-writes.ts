import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ClientSession, mongo } from 'mongoose';
import { Types } from 'mongoose';
import { versionFilter } from '../../common/versioned';
import { sameRe } from '../../common/text/same-text';

type Db = mongo.Db;
type Doc = Record<string, unknown>;

/** Поля шапки заказа, которые в позиции только кэш. Истина — salesorders. */
const HEADER_CACHE = ['orderNo', 'customer', 'companyId', 'paymentForm', 'shipDate'] as const;

/**
 * Смена изделия гасит подтверждение вложенного паспорта.
 * Живёт у хозяина доходов: общий помощник паспорта только реэкспортирует.
 */
export function passportContextStage(productChanged: unknown = false) {
  return { $set: { passportEpoch: { $add: [{ $ifNull: ['$passportEpoch', 0] }, 1] }, passportSelection: { $cond: [{ $and: [{ $eq: ['$passportSelection.mode', 'attachment'] }, productChanged] }, { $mergeObjects: ['$passportSelection', { revision: { $add: [{ $ifNull: ['$passportSelection.revision', 0] }, 1] }, invalidatedAt: '$$NOW', invalidReason: 'PRODUCT_CHANGED' }] }, { $ifNull: ['$passportSelection', '$$REMOVE'] }] } } };
}

/** Захват эпохи паспорта. Фильтр собирает вызывающий (позиция + эпоха); повтор с чужой эпохой не меняет строку. */
export function bumpIncomePassportEpoch(db: Db, filter: Doc, session: ClientSession) {
  return db.collection('incomes').updateOne(filter, { $inc: { passportEpoch: 1 } }, { session });
}

/**
 * Кэш шапки в позициях заказа. Версию позиции не трогает: это не правка человеком.
 * Пустое поле шапки снимается. Смена даты отгрузки пересчитывает reportDate (оплата важнее).
 * Сессия обязательна: вместе с записью шапки, иначе заказ и строки разъедутся.
 */
export async function syncOrderHeaderCache(db: Db, orderId: Types.ObjectId, fields: Doc, session: ClientSession) {
  const stage: Doc = {};
  for (const k of HEADER_CACHE) if (k in fields) stage[k] = fields[k] === undefined ? '$$REMOVE' : { $literal: fields[k] };
  if (!Object.keys(stage).length) return;
  const pipeline: Doc[] = [{ $set: { ...stage, updatedAt: new Date() } }];
  if ('shipDate' in fields) pipeline.push({ $set: { reportDate: { $ifNull: ['$paidDate', { $ifNull: ['$shipDate', '$$REMOVE'] }] } } });
  await db.collection('incomes').updateMany({ orderId }, pipeline, { session });
}

/** Корзина заказа уносит только живые позиции и помечает их, чтобы восстановление вернуло ровно их. */
export function softDeleteLinesWithOrder(db: Db, orderId: Types.ObjectId, now: Date, session: ClientSession) {
  return db.collection('incomes').updateMany(
    { orderId, deletedAt: null },
    { $set: { deletedAt: now, deletedWithOrder: true, editedInApp: true, updatedAt: now }, $inc: { passportEpoch: 1 } },
    { session },
  );
}

/** Вернуть позиции, ушедшие в корзину вместе с заказом. Чужую корзину позиции не трогает. */
export function restoreLinesDeletedWithOrder(db: Db, orderId: Types.ObjectId, session: ClientSession) {
  return db.collection('incomes').updateMany(
    { orderId, deletedWithOrder: true },
    { $set: { deletedAt: null, updatedAt: new Date() }, $unset: { deletedWithOrder: '' }, $inc: { passportEpoch: 1 } },
    { session },
  );
}

/** Подбор изделия в позиции без productId. Уже сопоставленная или отменённая строка даёт конфликт — повтор безопасен. */
export async function confirmOrderLineProduct(db: Db, lineId: Types.ObjectId, orderId: Types.ObjectId, productId: Types.ObjectId, session: ClientSession) {
  const changed = await db.collection('incomes').updateOne(
    { _id: lineId, orderId, deletedAt: null, cancelledAt: null, productId: null },
    [passportContextStage({ $ne: [{ $ifNull: ['$productId', null] }, productId] }), { $set: { productId, matchStatus: 'confirmed', matchedAt: new Date(), updatedAt: new Date(), version: { $add: [{ $ifNull: ['$version', 0] }, 1] } } }],
    { session },
  );
  if (!changed.matchedCount) throw new ConflictException('Позиция изменилась — перечитайте договор');
}

/** Сопоставление: подтвердить изделие или снять («не изделие»). Эпоха паспорта растёт только при смене изделия. */
export async function matchIncomeLine(db: Db, lineId: Types.ObjectId, productId: Types.ObjectId | null, by: Types.ObjectId | undefined, now: Date, session: ClientSession) {
  const set: Doc = { productId: productId ?? '$$REMOVE', matchStatus: productId ? 'confirmed' : 'none', matchedAt: now, editedInApp: true, ...(by ? { matchedBy: by } : {}) };
  await db.collection('incomes').updateOne({ _id: lineId }, [
    passportContextStage({ $ne: [{ $ifNull: ['$productId', null] }, productId] }),
    { $set: Object.fromEntries(Object.entries(set).map(([key, value]) => [key, value === '$$REMOVE' ? value : { $literal: value }])) },
  ], { session });
}

/** Переименование заказчика на уже отобранных живых позициях. Повтор с тем же именем ничего не меняет по смыслу. */
export function renameCustomerLines(db: Db, ids: readonly unknown[], customer: string, session: ClientSession) {
  return db.collection('incomes').updateMany({ _id: { $in: ids as Types.ObjectId[] } }, { $set: { customer, editedInApp: true } }, { session });
}

/** Черновик изделия из заказов: productId только тем строкам, которые вызывающий уже отфильтровал. */
export function bindDraftProduct(db: Db, ids: readonly unknown[], productId: unknown, session: ClientSession) {
  return db.collection('incomes').updateMany(
    { _id: { $in: ids as Types.ObjectId[] } },
    { $set: { productId }, $inc: { passportEpoch: 1, version: 1 } },
    { session },
  );
}

/** Позиция становится заявкой на новое изделие: изделие и старое сопоставление снимаются. */
export function attachIncomeNewProductRequest(db: Db, incomeId: Types.ObjectId, requestId: Types.ObjectId, session: ClientSession) {
  return db.collection('incomes').updateOne({ _id: incomeId }, [
    passportContextStage({ $ne: [{ $ifNull: ['$productId', null] }, null] }),
    { $set: { lineType: 'new_product', productRequestId: requestId, editedInApp: true } },
    { $unset: ['productId', 'matchStatus', 'matchedAt', 'matchedBy', 'serviceId', 'workTypeId'] },
  ], { session });
}

/** Подтверждение заявки: все её позиции получают одно изделие. */
export function confirmRequestLines(db: Db, ids: readonly unknown[], productId: Types.ObjectId, by: Types.ObjectId | undefined, now: Date, session: ClientSession) {
  return db.collection('incomes').updateMany({ _id: { $in: ids as Types.ObjectId[] } }, [
    passportContextStage({ $ne: [{ $ifNull: ['$productId', null] }, productId] }),
    { $set: { productId, matchStatus: 'confirmed', matchedAt: now, lineType: 'product', editedInApp: true, ...(by ? { matchedBy: by } : {}) } },
  ], { session });
}

/**
 * Объединение справочника: одно написание формы оплаты или цвета.
 * Сессию добавляет обёртка справочника. Повтор после переноса находит 0 строк.
 */
export function renameIncomeText(db: Db, field: 'paymentForm' | 'color', fromName: string, toName: string) {
  const name = String(toName ?? '').replace(/\s+/g, ' ').trim();
  return db.collection('incomes').updateMany({ [field]: sameRe(fromName) }, { $set: { [field]: name, updatedAt: new Date() } });
}

/** Выбор источника паспорта. Редакция и файл проверяются до вызова; здесь только запись внутри уже открытой сессии. */
export async function setIncomePassportSelection(db: Db, id: Types.ObjectId, selection: { mode?: string; revision?: number }, session: ClientSession) {
  if (selection.mode !== 'site' && selection.mode !== 'attachment') throw new BadRequestException('Неизвестный источник паспорта');
  if (!Number.isInteger(selection.revision) || Number(selection.revision) < 1) throw new BadRequestException('Редакция выбора паспорта не задана');
  await db.collection('incomes').updateOne({ _id: id }, { $set: { passportSelection: selection } }, { session });
}

/** Уточнение классификации оплаты позиции. Чужая версия документа — конфликт, повтор с тем же clientUid решает вызывающий до записи. */
export async function applyIncomeClassification(db: Db, id: unknown, documentVersion: number, set: Doc, session: ClientSession) {
  const changed = await db.collection('incomes').updateOne(
    { _id: id as Types.ObjectId, deletedAt: null, ...versionFilter(documentVersion) },
    { $set: set, $inc: { version: 1 } },
    { session },
  );
  if (!changed.matchedCount) throw new ConflictException('Источник уже изменён — перечитайте операцию');
}

/** Отмена позиции. Уже отменённая или с другой версией не меняется — повтор не затирает причину. */
export async function markIncomeCancelled(db: Db, id: unknown, expectedVersion: number, reason: string, actorId: string | undefined, session: ClientSession) {
  const text = String(reason || '').trim();
  if (text.length < 3) throw new BadRequestException('Укажите причину отмены');
  const now = new Date();
  const changed = await db.collection('incomes').updateOne(
    { _id: id as Types.ObjectId, deletedAt: null, cancelledAt: null, ...versionFilter(expectedVersion) },
    { $set: { cancelledAt: now, cancelReason: text, editedInApp: true, updatedAt: now, ...(actorId && Types.ObjectId.isValid(actorId) ? { cancelledBy: new Types.ObjectId(actorId) } : {}) }, $inc: { version: 1, passportEpoch: 1 } },
    { session },
  );
  if (!changed.matchedCount) throw new ConflictException('Позиция уже изменена — перечитайте');
}

/** Снять отмену. Брони и задачи этим методом не возвращаются. */
export async function restoreCancelledIncome(db: Db, id: unknown, expectedVersion: number, session: ClientSession) {
  const changed = await db.collection('incomes').updateOne(
    { _id: id as Types.ObjectId, deletedAt: null, ...versionFilter(expectedVersion) },
    { $unset: { cancelledAt: '', cancelReason: '', cancelledBy: '' }, $set: { editedInApp: true, updatedAt: new Date() }, $inc: { version: 1, passportEpoch: 1 } },
    { session },
  );
  if (!changed.matchedCount) throw new ConflictException('Позиция уже изменена — перечитайте');
}

/**
 * Перенос позиции в другой договор: версия и эпоха паспорта обязательны.
 * Состав шапки собирает операция переноса из договора; пустые поля шапки снимаются.
 */
export async function moveIncomeToOrder(db: Db, id: unknown, expectedVersion: number, set: Doc, unset: Record<string, ''>, session: ClientSession) {
  if (!set.orderId) throw new BadRequestException('Не выбран договор для переноса');
  const changed = await db.collection('incomes').updateOne(
    { _id: id as Types.ObjectId, deletedAt: null, ...versionFilter(expectedVersion) },
    { $set: set, $inc: { version: 1, passportEpoch: 1 }, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { session },
  );
  if (!changed.matchedCount) throw new ConflictException('Позиция уже изменена — перечитайте');
}
