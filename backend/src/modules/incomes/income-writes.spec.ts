import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { applyIncomeClassification, markIncomeCancelled, moveIncomeToOrder, setIncomePassportSelection, softDeleteLinesWithOrder, syncOrderHeaderCache } from './income-writes';

const dbOf = (updateOne: jest.Mock, updateMany: jest.Mock = jest.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }))) => ({ collection: () => ({ updateOne, updateMany }) }) as never;
const session = {} as never;

describe('операции хозяина incomes', () => {
  it('отмена: короткая причина не пишет; чужая версия — конфликт, повтор не затирает строку', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 0 }));
    await expect(markIncomeCancelled(dbOf(updateOne), new Types.ObjectId(), 1, 'не', undefined, session)).rejects.toBeInstanceOf(BadRequestException);
    expect(updateOne).not.toHaveBeenCalled();
    await expect(markIncomeCancelled(dbOf(updateOne), new Types.ObjectId(), 3, 'клиент отказался', undefined, session)).rejects.toBeInstanceOf(ConflictException);
    const cancelCall = updateOne.mock.calls[0] as unknown as [Record<string, unknown>, { $inc: Record<string, number> }];
    expect(cancelCall[0]).toMatchObject({ version: 3, cancelledAt: null, deletedAt: null });
    expect(cancelCall[1].$inc).toEqual({ version: 1, passportEpoch: 1 });
  });

  it('кэш шапки: дата отгрузки пересчитывает reportDate, чужое поле не пишется', async () => {
    const updateMany = jest.fn(async () => ({ modifiedCount: 1 }));
    const orderId = new Types.ObjectId();
    await syncOrderHeaderCache(dbOf(jest.fn(), updateMany), orderId, { shipDate: undefined, notes: 'мимо' }, session);
    const pipeline = (updateMany.mock.calls as unknown as Array<[unknown, Array<{ $set: Record<string, unknown> }>]>)[0][1];
    expect(pipeline[0].$set.shipDate).toBe('$$REMOVE');
    expect(pipeline[0].$set.notes).toBeUndefined();
    expect(pipeline[1].$set.reportDate).toEqual({ $ifNull: ['$paidDate', { $ifNull: ['$shipDate', '$$REMOVE'] }] });
    updateMany.mockClear();
    await syncOrderHeaderCache(dbOf(jest.fn(), updateMany), orderId, { notes: 'только чужое' }, session);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('корзина заказа помечает только живые позиции', async () => {
    const updateMany = jest.fn(async () => ({ modifiedCount: 2 }));
    const orderId = new Types.ObjectId();
    const now = new Date('2026-11-24T00:00:00Z');
    await softDeleteLinesWithOrder(dbOf(jest.fn(), updateMany), orderId, now, session);
    const deleted = updateMany.mock.calls[0] as unknown as [Record<string, unknown>, { $set: Record<string, unknown>; $inc: Record<string, number> }];
    expect(deleted[0]).toEqual({ orderId, deletedAt: null });
    expect(deleted[1].$set).toMatchObject({ deletedAt: now, deletedWithOrder: true, editedInApp: true });
    expect(deleted[1].$inc).toEqual({ passportEpoch: 1 });
  });

  it('классификация: версия не совпала — конфликт и журнал вызывающий не должен писать', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 0 }));
    await expect(applyIncomeClassification(dbOf(updateOne), new Types.ObjectId(), 4, { 'payments.0': { amount: 1 } }, session)).rejects.toThrow('перечитайте операцию');
    const classCall = updateOne.mock.calls[0] as unknown as [Record<string, unknown>, { $inc: Record<string, number> }];
    expect(classCall[0]).toMatchObject({ version: 4, deletedAt: null });
    expect(classCall[1].$inc).toEqual({ version: 1 });
  });

  it('перенос без договора и чужой источник паспорта не пишут строку', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 1 }));
    await expect(moveIncomeToOrder(dbOf(updateOne), new Types.ObjectId(), 1, {}, {}, session)).rejects.toBeInstanceOf(BadRequestException);
    await expect(setIncomePassportSelection(dbOf(updateOne), new Types.ObjectId(), { mode: 'file', revision: 1 }, session)).rejects.toThrow('Неизвестный источник');
    expect(updateOne).not.toHaveBeenCalled();
  });
});
