import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SalesOrdersService } from './salesorders.service';

const q = (r: unknown) => { const c: Record<string, jest.Mock> = {}; for (const m of ['lean', 'setOptions']) c[m] = jest.fn(() => c); c.exec = jest.fn(async () => r); return c; };

function setup(counts: { incomes: number; shipments: number }) {
  const cur = { _id: new Types.ObjectId(), deletedAt: null };
  const updateOne = jest.fn(() => q({}));
  const updateMany = jest.fn(async () => ({}));
  const coll = (n: string) => ({ countDocuments: async () => (n === 'incomes' ? counts.incomes : counts.shipments), updateMany });
  const connection = { db: { collection: coll }, startSession: async () => ({ withTransaction: async (cb: () => Promise<void>) => cb(), endSession: async () => undefined }) };
  const svc = new SalesOrdersService(connection as never, { updateOne, findOne: jest.fn(() => q(cur)) } as never);
  jest.spyOn(svc as never, 'findRaw').mockResolvedValue(cur as never);
  return { svc, cur, updateOne, updateMany };
}

describe('HARDEN-1 п.14: удаление заказа', () => {
  it('с оплатой — 409 словами, ничего не удалено', async () => {
    const t = setup({ incomes: 2, shipments: 0 });
    await expect(t.svc.remove('x')).rejects.toThrow(/есть оплаты/);
    expect(t.updateOne).not.toHaveBeenCalled();
  });
  it('с отгрузками — 409', async () => {
    const t = setup({ incomes: 0, shipments: 1 });
    await expect(t.svc.remove('x')).rejects.toBeInstanceOf(ConflictException);
  });
  it('чистый заказ удаляется вместе с позициями', async () => {
    const t = setup({ incomes: 0, shipments: 0 });
    await expect(t.svc.remove('x')).resolves.toEqual({ id: 'x', deleted: true });
    expect(t.updateOne).toHaveBeenCalledTimes(1);
    expect(t.updateMany).toHaveBeenCalledTimes(1);
  });
});
