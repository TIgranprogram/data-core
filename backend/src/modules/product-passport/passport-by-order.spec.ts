import { Types } from 'mongoose';
import { PassportQueries } from './passport-queries';
import { AFTER_PRINT_FIELDS, readinessOf } from './passport-consts';

describe('готовность паспорта и группы по заказам', () => {
  it('readinessOf: свой статус, иначе выпущенный готов, черновик не готов', () => {
    expect(readinessOf({ status: 'issued', passportNumber: '1' })).toBe('ready');
    expect(readinessOf({ status: 'draft', passportNumber: 'draft-x' })).toBe('notReady');
    expect(readinessOf({ status: 'issued', passportNumber: '1', readiness: 'rework' })).toBe('rework');
    expect(readinessOf({ passportNumber: '5' })).toBe('ready'); // старый, без статуса
  });
  it('readiness и reworkNote меняются после печати', () => {
    expect(AFTER_PRINT_FIELDS).toEqual(expect.arrayContaining(['readiness', 'reworkNote']));
  });

  const oid = (v: unknown) => new Types.ObjectId(String(v));
  const mk = (docs: Array<Record<string, unknown>>) => {
    let filter: Record<string, unknown> = {};
    const model = { find: (f: Record<string, unknown>) => { filter = f; return { setOptions: () => ({ sort: () => ({ lean: () => ({ exec: async () => docs }) }) }) }; } };
    return { q: new PassportQueries({ model, oid } as never), filter: () => filter };
  };
  const a = new Types.ObjectId();

  it('by-order: группа по salesOrderId, по номеру без id, «Без заказа» последней, счётчики', async () => {
    const { q } = mk([
      { _id: 1, status: 'issued', passportNumber: '1', orderNo: '' },
      { _id: 2, status: 'issued', passportNumber: '2', salesOrderId: a, orderNo: '7', customerName: 'ГБУ' },
      { _id: 3, status: 'draft', passportNumber: 'draft-3', salesOrderId: a },
      { _id: 4, status: 'issued', passportNumber: '4', salesOrderId: a, readiness: 'rework' },
      { _id: 5, status: 'issued', passportNumber: '5', orderNo: ' 12 ' },
      { _id: 6, status: 'issued', passportNumber: '6', orderNo: '12' },
    ]);
    const r = await q.byOrder({});
    expect(r.total).toBe(3);
    expect(r.items.map((g) => g.orderNo)).toEqual(['7', '12', null]);
    expect(r.items[0]).toMatchObject({ orderId: String(a), customerName: 'ГБУ', total: 3, ready: 1, notReady: 1, rework: 1 });
    expect(r.items[1]).toMatchObject({ orderId: null, total: 2, ready: 2 });
    expect(r.items[2].items).toHaveLength(1);
  });

  it('by-order: пагинация по заказам; аннулированные исключены', async () => {
    const { q, filter } = mk([{ _id: 1, status: 'issued', orderNo: '1' }, { _id: 2, status: 'issued', orderNo: '2' }]);
    const r = await q.byOrder({ limit: '1', page: '2' });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].orderNo).toBe('2');
    expect(filter().status).toEqual({ $ne: 'annulled' });
  });
});
