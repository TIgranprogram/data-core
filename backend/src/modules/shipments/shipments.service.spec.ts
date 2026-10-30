import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ShipmentsService } from './shipments.service';

const q = (r: unknown) => { const c: Record<string, jest.Mock> = {}; for (const m of ['session', 'lean', 'sort']) c[m] = jest.fn(() => c); c.exec = jest.fn(async () => r); return c; };

function setup(ships: Array<Record<string, unknown>> = []) {
  const orderId = new Types.ObjectId(), lineId = new Types.ObjectId();
  const order = { _id: orderId, stage: 'new', orderNo: '1' };
  const line = { _id: lineId, title: 'Скамья', qty: 10 };
  const coll = (name: string) => ({
    findOne: async () => (name === 'salesorders' ? order : null),
    find: () => ({ sort: () => ({ toArray: async () => (name === 'incomes' ? [line] : []) }), toArray: async () => [] }),
    updateOne: jest.fn(async () => ({})),
  });
  let live = ships;
  const model = {
    findOne: jest.fn(() => q(null)),
    find: jest.fn(() => q(live)),
    create: jest.fn(async (d: Array<Record<string, unknown>>) => d.map((x) => ({ ...x, toObject: () => x }))),
  };
  const connection = { db: { collection: coll }, startSession: async () => ({ withTransaction: async (cb: () => Promise<void>) => cb(), endSession: async () => undefined }) };
  const svc = new ShipmentsService(connection as never, model as never, { nextSeq: async () => 1 } as never);
  return { svc, model, orderId, lineId, setLive: (s: Array<Record<string, unknown>>) => { live = s; } };
}

describe('HARDEN-1 п.12: отгрузка', () => {
  const user = { id: String(new Types.ObjectId()), username: 'u' } as never;
  it('остаток перепроверяется в транзакции: между проверкой и записью успела другая отгрузка — 400', async () => {
    const t = setup();
    // первая проверка (вне транзакции) видит пусто; в транзакции — уже отгружено 8
    let n = 0;
    t.model.find.mockImplementation(() => q(++n === 1 ? [] : [{ lines: [{ incomeId: t.lineId, qty: 8 }] }]));
    await expect(t.svc.create(String(t.orderId), { lines: [{ incomeId: String(t.lineId), qty: 5 }], reason: 'часть' } as never, user)).rejects.toBeInstanceOf(BadRequestException);
    expect(t.model.create).not.toHaveBeenCalled();
  });
  it('повтор с тем же clientUid внутри транзакции — второй записи нет', async () => {
    const t = setup();
    let n = 0;
    t.model.findOne.mockImplementation(() => q(++n === 1 ? null : { _id: new Types.ObjectId(), orderId: t.orderId, lines: [] }));
    await t.svc.create(String(t.orderId), { lines: [{ incomeId: String(t.lineId), qty: 10 }], clientUid: 'k1' } as never, user);
    expect(t.model.create).not.toHaveBeenCalled();
  });
});
