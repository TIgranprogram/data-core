import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { StockReservationsService } from './stock-reservations.service';

const id = () => new Types.ObjectId();
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function setup() {
  const order = { _id: id() }, other = { _id: id() };
  const lineOk = { _id: id(), orderId: order._id }, lineOther = { _id: id(), orderId: other._id };
  const item = { quantity: 10, reservedQty: 4, save: jest.fn(async () => undefined) };
  const mk = (qty = 4): Row => ({ _id: id(), status: 'active', qty, materialId: id(), warehouseId: id(), salesOrderId: order._id,
    set(k: string, v: unknown) { this[k] = v; }, save: jest.fn(async () => undefined) });
  const res = mk();
  const coll = (name: string) => ({
    findOne: async (q: { _id: Types.ObjectId }) => (name === 'salesorders' ? [order, other].find((o) => o._id.equals(q._id)) : name === 'incomes' ? [lineOk, lineOther].find((o) => o._id.equals(q._id)) : null) ?? null,
  });
  const reservations = {
    findOne: () => ({ exec: async () => res }),
    find: (q: Row) => ({ lean: () => ({ exec: async () => (q._id ? q._id.$in.filter((i: Types.ObjectId) => i.equals(res._id)).map((i: Types.ObjectId) => ({ _id: i })) : [{ _id: res._id }, { _id: id() }]) }) }),
  };
  const movements = { exists: jest.fn(async () => false) };
  const connection = { db: { collection: coll }, startSession: async () => ({ withTransaction: async (cb: () => Promise<void>) => cb(), endSession: async () => undefined }) };
  const core = { loadStorage: async () => item };
  const svc = new StockReservationsService(connection as never, movements as never, reservations as never, {} as never, core as never, {} as never);
  return { svc, order, other, lineOk, lineOther, item, res, movements };
}

describe('StockReservationsService.updateReservation', () => {
  it('позиция чужого заказа — 400', async () => {
    const t = setup();
    await expect(t.svc.updateReservation(String(t.res._id), { salesOrderLineId: String(t.lineOther._id) })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('позиция своего заказа ставится; количество больше — в пределах свободного', async () => {
    const t = setup();
    const r = await t.svc.updateReservation(String(t.res._id), { salesOrderLineId: String(t.lineOk._id), qty: 9 });
    expect(r).toMatchObject({ qty: 9, salesOrderLineId: String(t.lineOk._id) });
    expect(t.item.reservedQty).toBe(9);
  });
  it('больше свободного — 400 с числами', async () => {
    const t = setup();
    await expect(t.svc.updateReservation(String(t.res._id), { qty: 12 })).rejects.toThrow(/свободно 6, нужно ещё 8/);
  });
  it('меньше — «свободно» растёт; смена заказа снимает позицию', async () => {
    const t = setup();
    t.res.salesOrderLineId = t.lineOk._id;
    const r = await t.svc.updateReservation(String(t.res._id), { qty: 1, salesOrderId: String(t.other._id) });
    expect(t.item.reservedQty).toBe(1);
    expect(r).toMatchObject({ salesOrderId: String(t.other._id), salesOrderLineId: null });
  });
  it('нулевое количество — 400', async () => {
    const t = setup();
    await expect(t.svc.updateReservation(String(t.res._id), { qty: 0 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('StockReservationsService.issueOrder', () => {
  it('все брони заказа уходят в одну выдачу', async () => {
    const t = setup();
    const spy = jest.spyOn(t.svc, 'issueReservations').mockResolvedValue({ issued: 2 } as never);
    const r = await t.svc.issueOrder({ salesOrderId: String(t.order._id), personId: String(id()), clientUid: 'k' }, 'u');
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][0] as { lines: unknown[] }).lines).toHaveLength(2);
    expect(r).toMatchObject({ issued: 2 });
  });
  it('пустой выбор — 400', async () => {
    const t = setup();
    await expect(t.svc.issueOrder({ salesOrderId: String(t.order._id), reservationIds: [] })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('повтор с тем же clientUid идёт в проверку повтора, а не в «нет броней»', async () => {
    const t = setup();
    t.movements.exists.mockResolvedValue(true as never);
    const spy = jest.spyOn(t.svc, 'issueReservations').mockResolvedValue({ issued: 0 } as never);
    await t.svc.issueOrder({ salesOrderId: String(t.order._id), clientUid: 'k' });
    expect((spy.mock.calls[0][0] as { lines: unknown[] }).lines).toEqual([]);
  });
  it('lines с количеством — выдаётся указанное, а не вся бронь (SK-6c)', async () => {
    const t = setup();
    const spy = jest.spyOn(t.svc, 'issueReservations').mockResolvedValue({ issued: 1 } as never);
    await t.svc.issueOrder({ salesOrderId: String(t.order._id), lines: [{ reservationId: String(t.res._id), qty: 3 }] });
    expect((spy.mock.calls[0][0] as { lines: unknown[] }).lines).toEqual([{ reservationId: String(t.res._id), qty: 3 }]);
  });
  it('часть выбранных броней уже выдана или снята — 409', async () => {
    const t = setup();
    await expect(t.svc.issueOrder({ salesOrderId: String(t.order._id), reservationIds: [String(t.res._id), String(id())] })).rejects.toBeInstanceOf(ConflictException);
  });
});
