import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types, type ClientSession, type Connection } from 'mongoose';
import { createHash } from 'crypto';
import { claimPassportProductVersion } from '../product/product-writes';
import { canon } from './passport-snapshot-refresh';

export interface PassportProductVersion {
  _id: Types.ObjectId;
  updatedAt?: Date;
  __v?: number;
  businessFingerprint: string;
}

/** Технический touch другого выпуска не меняет подготовленные бизнес-источники. */
function businessFingerprint(product: Record<string, unknown>): string {
  const business = Object.fromEntries(Object.entries(product).filter(([key]) => key !== 'updatedAt' && key !== '__v'));
  return createHash('sha256').update(canon(business)).digest('hex');
}

/** Источники подготовки не должны устареть до вставки нового паспорта. */
export async function passportProductVersion(connection: Connection, productId: unknown): Promise<PassportProductVersion | null> {
  if (!productId) return null;
  if (!Types.ObjectId.isValid(String(productId))) throw new NotFoundException('Изделие не найдено');
  const product = await connection.db!.collection('products').findOne({ _id: new Types.ObjectId(String(productId)), deletedAt: null });
  if (!product) throw new NotFoundException('Изделие не найдено');
  return { _id: product._id, updatedAt: product.updatedAt, __v: product.__v, businessFingerprint: businessFingerprint(product) };
}

/** Общая запись с импортом исключает phantom нового паспорта в snapshot-транзакции. */
export async function claimPassportProduct(connection: Connection, productId: unknown, session: ClientSession, expected?: PassportProductVersion) {
  if (!productId) return;
  const _id = new Types.ObjectId(String(productId));
  if (expected) {
    const current = await connection.db!.collection('products').findOne({ _id, deletedAt: null }, { session });
    if (!current || businessFingerprint(current) !== expected.businessFingerprint) throw new ConflictException('Изделие изменилось во время подготовки паспорта — повторите создание');
  }
  await claimPassportProductVersion(connection.db!, _id, session);
}

/** Позиционный guard уже может владеть session; самостоятельный паспорт получает свою транзакцию. */
export async function withPassportProductWrite<T>(connection: Connection, expected: PassportProductVersion | null, existingSession: ClientSession | undefined, action: (session?: ClientSession) => Promise<T>): Promise<T> {
  if (!expected) return action(existingSession);
  const run = async (session: ClientSession) => {
    await claimPassportProduct(connection, expected._id, session, expected);
    return action(session);
  };
  if (existingSession) return run(existingSession);
  const session = await connection.startSession();
  let result!: T;
  try { await session.withTransaction(async () => { result = await run(session); }); }
  finally { await session.endSession(); }
  return result;
}
