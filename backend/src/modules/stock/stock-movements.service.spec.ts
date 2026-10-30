import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { StockMovementsService } from './stock-movements.service';

const q = (r: unknown) => { const c: Record<string, jest.Mock> = {}; for (const m of ['session', 'lean', 'sort', 'setOptions']) c[m] = jest.fn(() => c); c.exec = jest.fn(async () => r); return c; };

function setup(over: { existing?: Record<string, unknown> | null; mv?: Record<string, unknown>; claim?: number } = {}) {
  const matId = new Types.ObjectId();
  const item = { quantity: 10, reservedQty: 0, save: jest.fn(async () => undefined) };
  const mv = { _id: new Types.ObjectId(), type: 'in', materialId: matId, date: new Date(), delta: 5, ...over.mv };
  const movements = {
    findOne: jest.fn((f: Record<string, unknown>) => q(f.clientUid ? over.existing ?? null : mv)),
    create: jest.fn(async () => []), exists: jest.fn(async () => false),
    updateOne: jest.fn(() => q({ matchedCount: over.claim ?? 1 })),
  };
  const reservations = { findOne: jest.fn(() => q(null)), exists: jest.fn(async () => false) };
  const materials = { exists: jest.fn(async () => true) };
  const core = { defaultWarehouse: async () => ({ _id: new Types.ObjectId() }), loadStorage: jest.fn(async () => item), markEdited: jest.fn(async () => undefined) };
  const search = { getItem: jest.fn(async () => ({ id: String(matId), quantity: item.quantity })) };
  const connection = { db: { collection: () => ({}) }, startSession: async () => ({ withTransaction: async (cb: () => Promise<void>) => cb(), endSession: async () => undefined }) };
  const svc = new StockMovementsService(connection as never, movements as never, reservations as never, materials as never, core as never, search as never, {} as never);
  return { svc, movements, item, matId, mv, core };
}

describe('HARDEN-1: движения склада', () => {
  it('п.4: отмена занимает запись условием cancelledAt: null в транзакции; занято — 409, остаток не меняется', async () => {
    const t = setup({ claim: 0 });
    await expect(t.svc.cancelMovement(String(t.mv._id))).rejects.toBeInstanceOf(ConflictException);
    expect(t.movements.updateOne).toHaveBeenCalledWith({ _id: t.mv._id, cancelledAt: null }, expect.anything(), expect.objectContaining({ session: expect.anything() }));
    expect(t.item.quantity).toBe(10);
    expect(t.movements.create).not.toHaveBeenCalled();
  });
  it('п.4: обычная отмена проводит обратное движение', async () => {
    const t = setup();
    await t.svc.cancelMovement(String(t.mv._id));
    expect(t.item.quantity).toBe(5);
    expect(t.movements.create).toHaveBeenCalledTimes(1);
  });
  it('п.5: clientUid проверяется внутри транзакции — найден, остаток не трогаем', async () => {
    const t = setup({ existing: { _id: new Types.ObjectId() } });
    await t.svc.move(String(t.matId), { type: 'in', qty: 3, clientUid: 'u1' } as never);
    expect(t.movements.findOne.mock.results[0].value.session).toHaveBeenCalled();
    expect(t.item.quantity).toBe(10);
    expect(t.movements.create).not.toHaveBeenCalled();
  });
  it('cancelBatch: запись занята параллельной отменой — 409, остаток не меняется', async () => {
    const t = setup({ claim: 0 });
    (t.movements as Record<string, unknown>).find = jest.fn(() => q([t.mv]));
    await expect(t.svc.cancelBatch(String(new Types.ObjectId()))).rejects.toThrow('уже отменена');
    expect(t.item.quantity).toBe(10);
  });
  it('п.9: отмена выдачи по брони — 409', async () => {
    const t = setup({ mv: { type: 'out', delta: -2, reservationId: new Types.ObjectId() } });
    await expect(t.svc.cancelMovement(String(t.mv._id))).rejects.toThrow('выдача по брони');
  });
  it('п.7: принудительная корректировка ниже брони уменьшает бронь до остатка', async () => {
    const t = setup();
    t.item.reservedQty = 8;
    await t.svc.move(String(t.matId), { type: 'adjust', qty: -5, force: true } as never);
    expect(t.item.quantity).toBe(5);
    expect(t.item.reservedQty).toBe(5);
  });
  it('п.8: исправление списания проверяет остаток до отмены', async () => {
    const t = setup({ mv: { type: 'out', delta: -2 } });
    await expect(t.svc.correctMovement(String(t.mv._id), 99)).rejects.toThrow('Недостаточно');
    expect(t.movements.updateOne).not.toHaveBeenCalled();
  });
});
