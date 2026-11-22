import { claimPassportOwners, claimWritableOrders } from '../order-archive/write';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types, type ClientSession, type Connection } from 'mongoose';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

type Db = NonNullable<Connection['db']>;
export type PassportSelection = { mode: 'site' | 'attachment'; revision: number; attachmentId?: Types.ObjectId | string; attachmentGeneration?: number; productIdAtSelection?: Types.ObjectId | string; confirmedAt?: Date; confirmedBy?: string; changedAt?: Date; changedBy?: string; invalidatedAt?: Date; invalidReason?: string };
export type PassportLine = Record<string, unknown> & { _id: Types.ObjectId; orderId?: Types.ObjectId; productId?: Types.ObjectId; lineType?: string; passportSelection?: PassportSelection };
const key = randomBytes(32);
export const revisionOf = (d: PassportLine) => Number(d.passportSelection?.revision ?? 0);
export const epochOf = (d: PassportLine) => Number(d.passportEpoch ?? 0);
export const selectionOf = (d: PassportLine) => d.passportSelection ?? { mode: 'site', revision: 0 };
export const stalePassport = () => new ConflictException({ code: 'STALE_CONTEXT', message: 'Данные позиции изменились — перечитайте план' });
export const epochFilter = (n: number) => n ? { passportEpoch: n } : { $or: [{ passportEpoch: 0 }, { passportEpoch: { $exists: false } }] };
export function lineBaseline(d: PassportLine) {
  return { incomeId: String(d._id), orderId: String(d.orderId ?? ''), productId: String(d.productId ?? ''), lineType: d.lineType ?? null, cancelledAt: d.cancelledAt ?? null, deletedAt: d.deletedAt ?? null, selectionRevision: revisionOf(d), passportEpoch: epochOf(d) };
}
export function passportContextToken(d: PassportLine, generation?: number) {
  const data = Buffer.from(JSON.stringify({ ...lineBaseline(d), attachmentGeneration: generation ?? null })).toString('base64url');
  return data + '.' + createHmac('sha256', key).update(data).digest('base64url');
}
export function assertPassportToken(token: string, d: PassportLine, generation?: number) {
  const expected = Buffer.from(passportContextToken(d, generation)), actual = Buffer.from(String(token ?? ''));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw stalePassport();
}
export async function passportLine(db: Db, incomeId: unknown, orderId?: unknown, session?: ClientSession): Promise<PassportLine> {
  if (!Types.ObjectId.isValid(String(incomeId))) throw new NotFoundException('Позиция заказа не найдена');
  const d = await db.collection('incomes').findOne({ _id: new Types.ObjectId(String(incomeId)), deletedAt: null, cancelledAt: null }, { session });
  if (!d || !d.orderId || orderId && String(d.orderId) !== String(orderId)) throw new NotFoundException('Позиция заказа не найдена');
  const order = await db.collection('salesorders').findOne({ _id: d.orderId, deletedAt: null, cancelledAt: null, stage: { $ne: 'cancelled' } }, { session });
  if (!order) throw new NotFoundException('Заказ не найден или отменён');
  return d;
}
/** Общая запись позиции сериализует выбор, создание и выдачу номера. Baseline не перечитывается при retry. */
export async function claimPassportLine(db: Db, session: ClientSession, context: PassportLine, expectedEpoch: number, operation: 'select' | 'site') {
  await claimWritableOrders(db, session, [context.orderId]);
  const d = await passportLine(db, context._id, context.orderId, session);
  if (epochOf(d) !== expectedEpoch || JSON.stringify(lineBaseline(d)) !== JSON.stringify(lineBaseline(context))) throw stalePassport();
  if (operation === 'site' && selectionOf(d).mode === 'attachment') throw new ConflictException({ code: 'SOURCE_ATTACHMENT', message: 'Для позиции выбран вложенный паспорт — измените источник явно' });
  const r = await db.collection('incomes').updateOne({ _id: d._id, orderId: d.orderId, productId: d.productId ?? null, lineType: d.lineType ?? null, deletedAt: null, cancelledAt: null, ...epochFilter(expectedEpoch) }, { $inc: { passportEpoch: 1 } }, { session });
  if (!r.modifiedCount) throw stalePassport();
}
/** Атомарный контекстный hook для raw writers: смена изделия никогда не оживляет старое подтверждение. */
export function passportContextStage(productChanged: unknown = false) {
  return { $set: { passportEpoch: { $add: [{ $ifNull: ['$passportEpoch', 0] }, 1] }, passportSelection: { $cond: [{ $and: [{ $eq: ['$passportSelection.mode', 'attachment'] }, productChanged] }, { $mergeObjects: ['$passportSelection', { revision: { $add: [{ $ifNull: ['$passportSelection.revision', 0] }, 1] }, invalidatedAt: '$$NOW', invalidReason: 'PRODUCT_CHANGED' }] }, { $ifNull: ['$passportSelection', '$$REMOVE'] }] } } };
}
/** Guard и запись паспорта атомарны; исходный epoch сохраняется при retry. */
export async function withPassportSite<T>(connection: Connection, baseline: PassportLine | null, action: (session?: ClientSession) => Promise<T>, owners: readonly { salesOrderId?: unknown; incomeId?: unknown }[] = [], outer?: ClientSession): Promise<T> {
  if (!baseline && !owners.some(d => d.salesOrderId || d.incomeId)) return action(outer);
  const write = async (session: ClientSession) => {
    if (owners.length) await claimPassportOwners(connection.db!, session, [...owners, { salesOrderId: baseline?.orderId }]);
    if (baseline) await claimPassportLine(connection.db!, session, baseline, epochOf(baseline), 'site');
    return action(session);
  };
  if (outer) return write(outer);
  const session = await connection.startSession();
  let result!: T;
  try { await session.withTransaction(async () => { result = await write(session); }); return result; }
  finally { await session.endSession(); }
}
export function assertSitePassport(baseline: PassportLine | null) {
  if (baseline && selectionOf(baseline).mode === 'attachment') throw new ConflictException({ code: 'SOURCE_ATTACHMENT', message: 'Для позиции выбран вложенный паспорт — измените источник явно' });
}
/** Копия BSON-значений для новой попытки transaction: document и выданные номера не переиспользуются. */
export function copyPassportValue<T>(value: T): T {
  if (value instanceof Types.ObjectId) return new Types.ObjectId(value.toHexString()) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Buffer.isBuffer(value)) return Buffer.from(value) as T;
  if (Array.isArray(value)) return value.map(copyPassportValue) as T;
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [k, copyPassportValue(v)])) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copyPassportValue(v)])) as T;
  return value;
}
