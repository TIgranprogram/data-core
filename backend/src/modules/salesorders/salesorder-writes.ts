import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ClientSession, mongo } from 'mongoose';
import { Types } from 'mongoose';
import { sameRe } from '../../common/text/same-text';

type Db = mongo.Db;
type Doc = Record<string, unknown>;

/** Договор в архиве: обычная правка запрещена, пока администратор не возобновит. */
export function archiveOrderConflict() {
  return new ConflictException({ code: 'ORDER_ARCHIVED', message: 'Договор в архиве. Для изменений администратор должен возобновить договор.' });
}

/**
 * Захват живого договора перед чужой записью. Архивный не берётся — конфликт.
 * Нет документа — 404. Повтор увеличивает барьер, поля человека не меняет.
 * Сессия обязательна: вместе с записью, которая этот захват открыла.
 */
export async function claimWritableOrders(db: Db, session: ClientSession, orderIds: readonly unknown[]) {
  const ids = [...new Set(orderIds.filter(id => id != null).map(String))].sort();
  for (const id of ids) {
    const _id = new Types.ObjectId(id);
    const result = await db.collection('salesorders').updateOne(
      { _id, activeArchiveVersion: null }, { $inc: { passportGuard: 1 } }, { session },
    );
    if (!result.matchedCount) {
      if (await db.collection('salesorders').findOne({ _id }, { session, projection: { _id: 1 } })) throw archiveOrderConflict();
      throw new NotFoundException('Договор не найден');
    }
  }
}

/** Объединение справочника: одно написание формы оплаты в шапке. Сессию добавляет справочник, если она есть. Повтор после переноса находит 0. */
export function renameOrderPaymentForm(db: Db, fromName: string, toName: string) {
  const name = String(toName ?? '').replace(/\s+/g, ' ').trim();
  return db.collection('salesorders').updateMany(
    { paymentForm: sameRe(fromName) },
    { $set: { paymentForm: name, editedInApp: true, updatedAt: new Date() } },
  );
}

/** Переименование заказчика на уже отобранных договорах. Повтор с тем же именем пишет то же значение. */
export function renameOrderCustomers(db: Db, ids: readonly unknown[], customer: string, now: Date, session: ClientSession) {
  return db.collection('salesorders').updateMany(
    { _id: { $in: ids as Types.ObjectId[] } },
    { $set: { customer, updatedAt: now } },
    { session },
  );
}

/**
 * Этап после отгрузки. Тот же этап не пишет строку.
 * Версию и editedInApp не трогает: это пересчёт, не правка человеком.
 */
export async function applyShipmentStage(db: Db, orderId: Types.ObjectId, stage: string, current: string, session: ClientSession) {
  if (stage === current) return;
  await db.collection('salesorders').updateOne({ _id: orderId }, { $set: { stage, updatedAt: new Date() } }, { session });
}

/** Барьер архивации. Удалённый договор не берётся: modifiedCount 0, снимок не пишется. */
export function lockLiveOrder(db: Db, orderId: Types.ObjectId, session: ClientSession) {
  return db.collection('salesorders').updateOne({ _id: orderId, deletedAt: null }, { $inc: { passportGuard: 1 } }, { session });
}

/** Закрытие в архив. Версию состояния и номер снимка передаёт архив после своих проверок. */
export function closeOrderArchive(db: Db, orderId: Types.ObjectId, version: number, stateVersion: number, archivedAt: Date, session: ClientSession) {
  return db.collection('salesorders').updateOne(
    { _id: orderId },
    { $set: { stage: 'closed', activeArchiveVersion: version, archiveStateVersion: stateVersion, updatedAt: archivedAt } },
    { session },
  );
}

/** Возобновление. Чужой номер снимка не совпадёт с фильтром — документ не меняется, архив это не считает успехом записи. */
export function reopenOrderArchive(db: Db, orderId: Types.ObjectId, version: number, stateVersion: number, stage: string, reopenedAt: Date, session: ClientSession) {
  return db.collection('salesorders').updateOne(
    { _id: orderId, activeArchiveVersion: version },
    { $unset: { activeArchiveVersion: '' }, $set: { archiveStateVersion: stateVersion, stage, updatedAt: reopenedAt } },
    { session },
  );
}

/**
 * Шапка по ключу импорта. Существующую не меняет.
 * Гонка двух вставок: уникальный индекс отбивает вторую, возвращаем первую.
 */
export async function upsertOrderByImportKey(db: Db, importKey: string, insert: Doc) {
  try {
    return await db.collection('salesorders').findOneAndUpdate(
      { importKey }, { $setOnInsert: insert }, { upsert: true, returnDocument: 'after', includeResultMetadata: false },
    ) as Doc;
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return await db.collection('salesorders').findOne({ importKey }) as Doc;
    throw e;
  }
}

type AssignRow = Record<string, unknown>;

/**
 * Привязка договоров к номеру производства. Пустой номер и чужая дата/версия не проходят.
 * Записали не всех — конфликт: транзакция вызывающего откатывает частичное.
 */
export async function assignContractsToProduction(db: Db, found: readonly AssignRow[], productionNo: string, now: Date, session: ClientSession) {
  const filter: Doc = {
    _id: { $in: found.map((d) => d._id) },
    deletedAt: null,
    $and: [{ $or: found.map(d => ({ _id: d._id, ...(d.updatedAt ? { updatedAt: d.updatedAt } : {}), ...(d.legalVersion !== undefined ? { legalVersion: d.legalVersion } : {}) })) }],
    $or: [{ productionNo: null }, { productionNo: '' }, { productionNo: { $exists: false } }],
  };
  const res = await db.collection('salesorders').updateMany(filter, { $set: { productionNo, productionAddedAt: now, editedInApp: true } }, { session });
  if (res.modifiedCount !== found.length) throw new ConflictException('Договор уже занят другим заказом, обновите список');
}

/** Перенос договора в другой номер производства. Уже чужой номер — конфликт, повтор не затирает. */
export async function moveContractProduction(db: Db, id: unknown, from: string, to: string, session: ClientSession) {
  const changed = await db.collection('salesorders').updateOne(
    { _id: id as Types.ObjectId, productionNo: from },
    { $set: { productionNo: to, productionAddedAt: new Date(), editedInApp: true } },
    { session },
  );
  if (!changed.matchedCount) throw new ConflictException('Договор уже сменил заказ — перечитайте карточку');
}

/** Подтянуть этап одного договора. Чужой текущий этап — конфликт, опережающие вызывающий не передаёт. */
export async function advanceContractStage(db: Db, id: unknown, fromStage: unknown, toStage: string, session: ClientSession) {
  const changed = await db.collection('salesorders').updateOne(
    { _id: id as Types.ObjectId, stage: fromStage ?? null },
    { $set: { stage: toStage, editedInApp: true } },
    { session },
  );
  if (!changed.matchedCount) throw new ConflictException('Этап договора изменился — перечитайте заказ');
}
