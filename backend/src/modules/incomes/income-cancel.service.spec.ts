import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { IncomeCancelService } from './income-cancel.service';

const id = new Types.ObjectId();
const orderId = new Types.ObjectId();

function setup(line: Record<string, unknown>, extra: Record<string, unknown[]> = {}) {
  const data: Record<string, unknown[]> = { incomes: [line], salesorders: [{ _id: orderId, orderNo: '5', deletedAt: null }], ...extra };
  const coll = (name: string) => {
    const rows = data[name] ?? [];
    const q = { sort() { return q; }, limit() { return q; }, toArray: async () => rows };
    return { find: () => q, findOne: async () => rows[0] ?? null, updateOne: async () => ({ matchedCount: 1 }), updateMany: jest.fn(async () => ({})), countDocuments: async () => 0 };
  };
  const session = { withTransaction: async (fn: () => Promise<void>) => fn(), endSession: async () => undefined };
  const releaseReservation = jest.fn(async () => undefined);
  const incomes = {
    assertCanChange: jest.fn(async () => undefined),
    get: jest.fn(async () => ({ id: String(id) })),
    markCancelled: jest.fn(async () => undefined),
    restoreCancelledLine: jest.fn(async () => undefined),
    moveLineToOrder: jest.fn(async () => undefined),
  };
  const svc = new IncomeCancelService({ db: { collection: coll }, startSession: async () => session } as never, incomes as never, { get: () => ({ releaseReservation }) } as never);
  return { svc, incomes, releaseReservation };
}

const line = { _id: id, orderId, deletedAt: null, version: 2, title: 'Скамья', lineNo: 1, payments: [] };

describe('отмена позиции: частичный сбой не продолжает операцию', () => {
  it('короткая причина и оплата не пишут отмену', async () => {
    const t = setup(line);
    await expect(t.svc.cancel(String(id), 'не', false)).rejects.toBeInstanceOf(BadRequestException);
    const paid = setup({ ...line, payments: [{ amount: 1 }] });
    await expect(paid.svc.cancel(String(id), 'клиент отказался', true)).rejects.toBeInstanceOf(ConflictException);
    expect(t.incomes.markCancelled).not.toHaveBeenCalled();
    expect(paid.incomes.markCancelled).not.toHaveBeenCalled();
  });

  it('бронь без согласия не снимается; срыв склада откатывает вызов наружу', async () => {
    const reservationId = new Types.ObjectId();
    const held = setup(line, { reservations: [{ _id: reservationId, salesOrderLineId: id, qty: 1, groupName: 'Бронь' }] });
    await expect(held.svc.cancel(String(id), 'клиент отказался', false)).rejects.toBeInstanceOf(ConflictException);
    expect(held.incomes.markCancelled).not.toHaveBeenCalled();
    held.incomes.markCancelled.mockRejectedValueOnce(new ConflictException('Позиция уже изменена — перечитайте'));
    await expect(held.svc.cancel(String(id), 'клиент отказался', true)).rejects.toThrow('перечитайте');
    expect(held.releaseReservation).not.toHaveBeenCalled();
    held.incomes.markCancelled.mockResolvedValueOnce(undefined);
    held.releaseReservation.mockRejectedValueOnce(new Error('склад'));
    await expect(held.svc.cancel(String(id), 'клиент отказался', true)).rejects.toThrow('склад');
    expect(held.incomes.markCancelled).toHaveBeenCalledTimes(2);
  });

  it('вернуть неотменённую и перенести с оплатой нельзя', async () => {
    const t = setup(line);
    await expect(t.svc.restoreCancelled(String(id))).rejects.toThrow('не отменена');
    expect(t.incomes.restoreCancelledLine).not.toHaveBeenCalled();
    const paid = setup({ ...line, payments: [{ amount: 10 }] });
    await expect(paid.svc.move(String(id), String(new Types.ObjectId()))).rejects.toBeInstanceOf(ConflictException);
    expect(paid.incomes.moveLineToOrder).not.toHaveBeenCalled();
  });
});
