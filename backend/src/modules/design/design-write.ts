import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types, type ClientSession, type Connection } from 'mongoose';
import { claimWritableOrders, withOrderWrite } from '../../common/order-archive/write';

interface Binding { _id?: unknown; orderId?: unknown; incomeId?: unknown; updatedAt?: unknown }

/** Включает старого владельца и новую позицию при привязке свободной задачи. */
export function withDesignWrite<T>(connection: Connection, before: Binding | null, target: Binding | null, write: (session: ClientSession) => Promise<T>) {
  return withOrderWrite(connection, [], async session => {
    const db = connection.db!;
    const stored = before?._id ? await db.collection('designtasks').findOne(
      { _id: new Types.ObjectId(String(before._id)) }, { session, projection: { orderId: 1, incomeId: 1, updatedAt: 1 } },
    ) : null;
    if (before && !stored) throw new NotFoundException('Задача не найдена');
    const owners: unknown[] = [];
    for (const bind of [stored, target]) {
      if (!bind) continue;
      owners.push(bind.orderId);
      if (!bind.incomeId) continue;
      const line = await db.collection('incomes').findOne({ _id: new Types.ObjectId(String(bind.incomeId)) }, { session, projection: { orderId: 1 } });
      owners.push(line?.orderId);
      if (bind === target && (!line || String(line.orderId ?? '') !== String(bind.orderId ?? '')))
        throw new ConflictException('Позиция сменила договор. Обновите задачу');
    }
    await claimWritableOrders(db, session, owners);
    if (stored && before && (String(stored.incomeId ?? '') !== String(before.incomeId ?? '') || String(stored.orderId ?? '') !== String(before.orderId ?? '')
        || Number(stored.updatedAt ?? 0) !== Number(before.updatedAt ?? 0)))
      throw new ConflictException('Задача изменилась. Обновите карточку');
    return write(session);
  });
}
