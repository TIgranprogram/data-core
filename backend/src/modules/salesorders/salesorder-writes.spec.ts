import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  advanceContractStage, applyShipmentStage, assignContractsToProduction, claimWritableOrders,
  closeOrderArchive, lockLiveOrder, renameOrderPaymentForm, reopenOrderArchive, upsertOrderByImportKey,
} from './salesorder-writes';

const session = {} as never;

describe('операции хозяина salesorders', () => {
  it('захват: архив — конфликт без второй записи; нет договора — 404', async () => {
    const id = new Types.ObjectId();
    const updateOne = jest.fn(async () => ({ matchedCount: 0 }));
    const findOne = jest.fn(async () => ({ _id: id }));
    const db = { collection: () => ({ updateOne, findOne }) } as never;
    await expect(claimWritableOrders(db, session, [id])).rejects.toBeInstanceOf(ConflictException);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledTimes(1);
    const filter = (updateOne.mock.calls[0] as unknown as [Record<string, unknown>, { $inc: Record<string, number> }])[0];
    expect(filter).toEqual({ _id: id, activeArchiveVersion: null });
    findOne.mockResolvedValueOnce(null as never);
    await expect(claimWritableOrders(db, session, [id])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('привязка к производству: записали не всех — конфликт, пустой номер в фильтре', async () => {
    const id = new Types.ObjectId();
    const updateMany = jest.fn(async () => ({ modifiedCount: 0 }));
    const db = { collection: () => ({ updateMany }) } as never;
    await expect(assignContractsToProduction(db, [{ _id: id }], '4-26', new Date(), session)).rejects.toThrow('уже занят');
    const filter = (updateMany.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(filter.$or).toEqual([{ productionNo: null }, { productionNo: '' }, { productionNo: { $exists: false } }]);
    expect(filter.deletedAt).toBeNull();
  });

  it('этап: чужой текущий — конфликт и запись не подтверждается', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 0 }));
    const db = { collection: () => ({ updateOne }) } as never;
    const id = new Types.ObjectId();
    await expect(advanceContractStage(db, id, 'new', 'production', session)).rejects.toThrow('перечитайте заказ');
    expect((updateOne.mock.calls[0] as unknown as [Record<string, unknown>, { $set: Record<string, string> }])[0]).toEqual({ _id: id, stage: 'new' });
  });

  it('отгрузка не пишет тот же этап', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 1 }));
    const db = { collection: () => ({ updateOne }) } as never;
    const id = new Types.ObjectId();
    await applyShipmentStage(db, id, 'partly', 'partly', session);
    expect(updateOne).not.toHaveBeenCalled();
    await applyShipmentStage(db, id, 'shipped', 'partly', session);
    expect((updateOne.mock.calls[0] as unknown as [unknown, { $set: { stage: string } }])[1].$set.stage).toBe('shipped');
  });

  it('форма оплаты: шапка с меткой правки, повторное имя обрезается', async () => {
    const updateMany = jest.fn(async () => ({ modifiedCount: 1 }));
    const db = { collection: () => ({ updateMany }) } as never;
    await renameOrderPaymentForm(db, 'б/р', '  безнал  ');
    const [filter, update] = updateMany.mock.calls[0] as unknown as [{ paymentForm: RegExp }, { $set: Record<string, unknown> }];
    expect(filter.paymentForm.test(' б/р ')).toBe(true);
    expect(update.$set.paymentForm).toBe('безнал');
    expect(update.$set.editedInApp).toBe(true);
  });

  it('архив: замок только живого; закрытие ставит снимок; возобновление фильтрует номер', async () => {
    const updateOne = jest.fn(async () => ({ modifiedCount: 1, matchedCount: 1 }));
    const db = { collection: () => ({ updateOne }) } as never;
    const id = new Types.ObjectId();
    const at = new Date('2026-11-24T00:00:00Z');
    await lockLiveOrder(db, id, session);
    expect((updateOne.mock.calls[0] as unknown as [Record<string, unknown>])[0]).toEqual({ _id: id, deletedAt: null });
    await closeOrderArchive(db, id, 2, 5, at, session);
    expect((updateOne.mock.calls[1] as unknown as [unknown, { $set: Record<string, unknown> }])[1].$set).toMatchObject({ stage: 'closed', activeArchiveVersion: 2, archiveStateVersion: 5, updatedAt: at });
    await reopenOrderArchive(db, id, 2, 6, 'shipped', at, session);
    const reopen = updateOne.mock.calls[2] as unknown as [Record<string, unknown>, { $unset: Record<string, string>; $set: Record<string, unknown> }];
    expect(reopen[0]).toEqual({ _id: id, activeArchiveVersion: 2 });
    expect(reopen[1].$unset).toEqual({ activeArchiveVersion: '' });
    expect(reopen[1].$set.stage).toBe('shipped');
  });

  it('повтор вставки по ключу импорта возвращает первую шапку и не пишет вторую', async () => {
    const existing = { _id: new Types.ObjectId(), importKey: 'a|1' };
    const findOne = jest.fn(async () => existing);
    const findOneAndUpdate = jest.fn(async () => { const e = new Error('dup') as Error & { code?: number }; e.code = 11000; throw e; });
    const db = { collection: () => ({ findOneAndUpdate, findOne }) } as never;
    await expect(upsertOrderByImportKey(db, 'a|1', { orderNo: '1' })).resolves.toBe(existing);
    expect(findOne).toHaveBeenCalledWith({ importKey: 'a|1' });
  });
});
