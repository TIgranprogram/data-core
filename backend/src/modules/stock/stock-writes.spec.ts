import { Types } from 'mongoose';
import { moveReservationsToOrder, renameMaterialColor, renameStockLabel } from './stock-writes';
import { moveSupplyRequestsToOrder, renameSupplyLabel } from '../supply/supply-writes';

function fake() {
  const calls: { coll: string; filter: unknown; update: unknown; opts?: unknown }[] = [];
  const db = {
    collection: (coll: string) => ({
      updateMany: async (filter: unknown, update: unknown, opts?: unknown) => {
        calls.push({ coll, filter, update, opts });
        return { modifiedCount: 1 };
      },
    }),
  };
  return { db: db as never, calls };
}

describe('запись shared у хозяина', () => {
  it('чужая коллекция в подпись склада не пишется', async () => {
    const { db } = fake();
    expect(() => renameStockLabel(db, 'products', 'series', 'А', 'Б')).toThrow('не коллекция склада');
  });

  it('причина списания: stockmovements.reason без метки заявки', async () => {
    const { db, calls } = fake();
    await renameStockLabel(db, 'stockmovements', 'reason', 'Брак', 'Заводской брак');
    expect(calls[0].coll).toBe('stockmovements');
    expect(calls[0].update).toEqual({ $set: { reason: 'Заводской брак' } });
  });

  it('цвет позиции — точная строка массива', async () => {
    const { db, calls } = fake();
    await renameMaterialColor(db, 'RAL 6005', 'RAL 6005 мох');
    expect(calls[0]).toMatchObject({ coll: 'materials', filter: { colors: 'RAL 6005' }, update: { $set: { 'colors.$': 'RAL 6005 мох' } } });
  });

  it('тип счёта заявки ставит editedInApp', async () => {
    const { db, calls } = fake();
    await renameSupplyLabel(db, 'sheetExtra.invoiceType', 'УПД', 'УПД новый');
    expect(calls[0].coll).toBe('supplyrequests');
    expect(calls[0].update).toEqual({ $set: { 'sheetExtra.invoiceType': 'УПД новый', editedInApp: true } });
  });

  it('перенос позиции пишет бронь и заявку в той же сессии', async () => {
    const line = new Types.ObjectId();
    const order = new Types.ObjectId();
    const session = { id: 's' };
    const stock = fake();
    const supply = fake();
    await moveReservationsToOrder(stock.db, line, order, session as never);
    await moveSupplyRequestsToOrder(supply.db, line, order, session as never);
    expect(stock.calls[0]).toMatchObject({ coll: 'reservations', filter: { salesOrderLineId: line }, opts: { session } });
    expect(supply.calls[0]).toMatchObject({ coll: 'supplyrequests', filter: { salesOrderLineId: line }, opts: { session } });
  });
});
