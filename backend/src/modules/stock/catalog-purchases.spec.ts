import { Types, type mongo } from 'mongoose';
import { catalogPurchases } from './catalog-purchases';

describe('История закупок в витрине', () => {
  const materialId = new Types.ObjectId(), invoiceId = new Types.ObjectId();
  const date = new Date('2026-11-05'), later = new Date('2026-11-18');
  function database(rows: object[], invoices: object[]) {
    const requests = jest.fn(() => ({ toArray: async () => rows }));
    const headers = jest.fn(() => ({ toArray: async () => invoices }));
    const db = { collection: (name: string) => ({ find: name === 'supplyrequests' ? requests : headers }) } as unknown as mongo.Db;
    return { db, requests, headers };
  }
  it('оплату и дату счёта берёт из живой шапки, количество открытого заказа — из остатка строки', async () => {
    const draftId = new Types.ObjectId();
    const { db, requests, headers } = database([
      { materialId, invoiceId, status: 'ordered', num: 4, qty: 3, paid: false, invoiceDate: later },
      { materialId, invoiceId: draftId, status: 'ordered', num: 8, qty: 7, paid: true, supplierOrderDate: later },
    ], [{ _id: invoiceId, status: 'paid', date }, { _id: draftId, status: 'draft', date: later }]);
    const result = await catalogPurchases(db, [{ materialId: String(materialId), unit: 'м' }]);
    expect(result.get(String(materialId))).toEqual({
      lastPurchase: { date, dateKind: 'invoice', num: 4 },
      openPurchases: [{ status: 'ordered', unit: 'м', paid: true, qty: 3 }, { status: 'ordered', unit: 'м', paid: false, qty: 7 }],
    });
    expect(requests).toHaveBeenCalledTimes(1);
    expect(headers).toHaveBeenCalledTimes(1);
    expect(requests).toHaveBeenCalledWith({ materialId: { $in: [materialId] }, deletedAt: null, status: { $in: ['requested', 'in_progress', 'ordered', 'received'] } }, expect.anything());
  });
  it('принятый заказ попадает в историю по дате поставщику, дата заявки и приёмка не заменяют её', async () => {
    const { db } = database([
      { materialId, status: 'received', qty: 4, num: 5, supplierOrderDate: later, invoiceDate: date },
      { materialId, status: 'requested', num: 6, paid: false, qty: 18, invoiceDate: later, unit: 'шт' },
      { materialId, status: 'ordered', num: 3, paid: true, qty: 12, invoiceDate: date },
      { materialId, status: 'received', num: 12, qty: 2, requestDate: later, receivedAt: later },
    ], []);
    const facts = (await catalogPurchases(db, [{ materialId: String(materialId), unit: 'м' }])).get(String(materialId))!;
    expect(facts.lastPurchase).toEqual({ date: later, dateKind: 'order', num: 5 });
    expect(facts.openPurchases.map((o) => [o.paid, o.unit])).toEqual([[false, 'шт'], [true, 'м']]);
  });
  it('при отсутствии доступных материалов запросов нет', async () => {
    const { db, requests, headers } = database([], []);
    expect((await catalogPurchases(db, [])).size).toBe(0);
    expect(requests).not.toHaveBeenCalled();
    expect(headers).not.toHaveBeenCalled();
  });
});
