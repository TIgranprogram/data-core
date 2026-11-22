import { NotFoundException } from '@nestjs/common';
import type { ClientSession, Connection, mongo } from 'mongoose';
import { oid } from '../../common/list-query';
import { claimWritableOrders, withOrderWrite } from '../../common/order-archive/write';

export function withPlanWrite<T>(connection: Connection, id: string,
  write: (plan: mongo.Document, line: mongo.Document, session: ClientSession) => Promise<T>) {
  return withOrderWrite(connection, [], async session => {
    const db = connection.db!;
    const plan = await db.collection('orderlineplans').findOne({ _id: oid(id, 'плана'), deletedAt: null }, { session });
    if (!plan) throw new NotFoundException('План не найден');
    const line = await db.collection('incomes').findOne({ _id: plan.incomeId, deletedAt: null }, { session });
    if (!line) throw new NotFoundException('Позиция заказа не найдена');
    await claimWritableOrders(db, session, [line.orderId]);
    return write(plan, line, session);
  });
}
