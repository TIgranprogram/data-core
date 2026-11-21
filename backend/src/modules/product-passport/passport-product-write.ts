import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types, type ClientSession, type Connection } from 'mongoose';

export interface PassportProductVersion {
  _id: Types.ObjectId;
  updatedAt?: Date;
  __v?: number;
}

/** Источники подготовки не должны устареть до вставки нового паспорта. */
export async function passportProductVersion(connection: Connection, productId: unknown): Promise<PassportProductVersion | null> {
  if (!productId) return null;
  if (!Types.ObjectId.isValid(String(productId))) throw new NotFoundException('Изделие не найдено');
  const product = await connection.db!.collection('products').findOne({ _id: new Types.ObjectId(String(productId)), deletedAt: null }, { projection: { _id: 1, updatedAt: 1, __v: 1 } });
  if (!product) throw new NotFoundException('Изделие не найдено');
  return product as PassportProductVersion;
}

/** Общая запись с импортом исключает phantom нового паспорта в snapshot-транзакции. */
export async function claimPassportProduct(connection: Connection, productId: unknown, session: ClientSession, expected?: PassportProductVersion) {
  if (!productId) return;
  const _id = new Types.ObjectId(String(productId));
  const version = expected ? {
    updatedAt: expected.updatedAt ?? { $exists: false },
    __v: expected.__v ?? { $exists: false },
  } : {};
  const result = await connection.db!.collection('products').updateOne({ _id, deletedAt: null, ...version }, { $inc: { __v: 1 }, $set: { updatedAt: new Date() } }, { session });
  if (!result.matchedCount) throw new ConflictException('Изделие изменилось во время подготовки паспорта — повторите создание');
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
