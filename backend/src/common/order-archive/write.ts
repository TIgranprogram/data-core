import { NotFoundException } from '@nestjs/common';
import { Types, type ClientSession, type Connection } from 'mongoose';
import { archiveOrderConflict, claimWritableOrders } from '../../modules/salesorders/salesorder-writes';

type Db = NonNullable<Connection['db']>;

export { archiveOrderConflict, claimWritableOrders };

export async function withOrderWrite<T>(connection: Connection, orderIds: readonly unknown[], write: (session: ClientSession) => Promise<T>) {
  const session = await connection.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      await claimWritableOrders(connection.db!, session, orderIds);
      result = await write(session);
    });
    return result;
  } finally { await session.endSession(); }
}

/** Читаем принадлежность строки в том же снимке, что её изменение, включая строки без договора. */
export async function withLineWrite<T>(connection: Connection, incomeId: Types.ObjectId, write: (session: ClientSession) => Promise<T>) {
  return withOrderWrite(connection, [], async session => {
    const line = await connection.db!.collection('incomes').findOne({ _id: incomeId }, { session, projection: { orderId: 1 } });
    if (!line) throw new NotFoundException('Позиция не найдена');
    await claimWritableOrders(connection.db!, session, [line.orderId]);
    return write(session);
  });
}

type PassportOwner = { incomeId?: unknown; salesOrderId?: unknown };

/** Старые паспорта могут ссылаться только на договор либо только на позицию. Проверяем обе связи. */
export async function claimPassportOwners(db: Db, session: ClientSession, owners: readonly PassportOwner[]) {
  const orderIds = owners.map(d => d.salesOrderId);
  const lineIds = [...new Set(owners.map(d => d.incomeId).filter(Boolean).map(String))];
  for (const id of lineIds) {
    const line = await db.collection('incomes').findOne({ _id: new Types.ObjectId(id) }, { session, projection: { orderId: 1 } });
    if (line?.orderId) orderIds.push(line.orderId);
  }
  await claimWritableOrders(db, session, orderIds);
}

export async function withStoredPassportWrite<T>(connection: Connection, id: unknown, write: (session: ClientSession) => Promise<T>) {
  return withOrderWrite(connection, [], async session => {
    const doc = await connection.db!.collection('productpassports').findOne(
      { _id: new Types.ObjectId(String(id)) }, { session, projection: { incomeId: 1, salesOrderId: 1 } },
    );
    if (!doc) throw new NotFoundException('Паспорт не найден');
    await claimPassportOwners(connection.db!, session, [doc as PassportOwner]);
    return write(session);
  });
}

/** Склад и снабжение содержат ссылку на договор, на позицию или обе ссылки. */
export async function claimStockLinks(db: Db, session: ClientSession, links: readonly { salesOrderId?: unknown; salesOrderLineId?: unknown }[]) {
  await claimPassportOwners(db, session, links.map(link => ({ salesOrderId: link.salesOrderId, incomeId: link.salesOrderLineId })));
}
