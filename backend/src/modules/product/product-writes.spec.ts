import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  applyPlanToProduct, archiveShowcaseProduct, claimPassportProductVersion, claimProductPhotoVersion,
  commitBulkProductRow, commitPassportTemplate, fillEmptyOrderName, fillEmptyProductWeight,
  fillProductDesigner, reassignProductFacet, reassignProductMaterialSpec, reassignProductSeries,
  restoreBulkProduct, restoreShowcaseProduct,
} from './product-writes';

const session = {} as never;

describe('операции хозяина products', () => {
  it('корзина: нет живого изделия — 404 и второй записи нет', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 0 }));
    const db = { collection: () => ({ updateOne }) } as never;
    const id = new Types.ObjectId();
    await expect(archiveShowcaseProduct(db, id)).rejects.toBeInstanceOf(NotFoundException);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect((updateOne.mock.calls[0] as unknown as [Record<string, unknown>])[0]).toEqual({ _id: id, deletedAt: null });
  });

  it('восстановление из корзины пишет даже без проверки совпадения', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 0 }));
    const db = { collection: () => ({ updateOne }) } as never;
    const id = new Types.ObjectId();
    await restoreShowcaseProduct(db, id);
    expect((updateOne.mock.calls[0] as unknown as [unknown, { $set: { deletedAt: null } }])[1].$set.deletedAt).toBeNull();
  });

  it('массовая строка: чужой снимок — конфликт, частичный ряд не подтверждается', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 0 }));
    const db = { collection: () => ({ updateOne }) } as never;
    const id = new Types.ObjectId();
    await expect(commitBulkProductRow(db, id, { series: 'А' }, { $set: { series: 'Б' } }, session)).rejects.toBeInstanceOf(ConflictException);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect((updateOne.mock.calls[0] as unknown as [Record<string, unknown>])[0]).toMatchObject({ _id: id, deletedAt: null, series: 'А' });
  });

  it('отмена массовой правки: чужой снимок не возвращает старые поля', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 0 }));
    const db = { collection: () => ({ updateOne }) } as never;
    await expect(restoreBulkProduct(db, new Types.ObjectId(), { status: 'draft' }, { $set: { status: 'active' } })).rejects.toThrow('обновите список');
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it('книжка: нет изделия — 404; изделие есть, снимок чужой — конфликт без второй правки', async () => {
    const id = new Types.ObjectId();
    const updateOne = jest.fn(async () => ({ matchedCount: 0 }));
    const findOne = jest.fn(async (): Promise<{ _id: Types.ObjectId } | null> => null);
    const db = { collection: () => ({ updateOne, findOne }) } as never;
    await expect(commitPassportTemplate(db, { _id: id, deletedAt: null }, [true], { updatedAt: new Date() })).rejects.toBeInstanceOf(NotFoundException);
    expect(updateOne).toHaveBeenCalledTimes(1);
    findOne.mockResolvedValueOnce({ _id: id });
    await expect(commitPassportTemplate(db, { _id: id, deletedAt: null }, [true], { updatedAt: new Date() })).rejects.toThrow('перечитайте книжку');
    expect(updateOne).toHaveBeenCalledTimes(2);
  });

  it('план: чужой updatedAt — конфликт', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 0 }));
    const db = { collection: () => ({ updateOne }) } as never;
    const stamp = new Date('2026-11-24T00:00:00Z');
    const current = new Date('2026-11-01T00:00:00Z');
    await expect(applyPlanToProduct(db, 'p', current, { parts: [] }, { workTypes: '' }, stamp, session)).rejects.toThrow('после копии');
    const [filter, update] = updateOne.mock.calls[0] as unknown as [Record<string, unknown>, { $set: Record<string, unknown>; $unset: Record<string, string> }];
    expect(filter.updatedAt).toBe(current);
    expect(update.$set.updatedAt).toBe(stamp);
    expect(update.$unset).toEqual({ workTypes: '' });
  });

  it('захват паспорта — конфликт, захват фото — 404, оба по живому изделию', async () => {
    const updateOne = jest.fn(async () => ({ matchedCount: 0 }));
    const db = { collection: () => ({ updateOne }) } as never;
    const id = new Types.ObjectId();
    await expect(claimPassportProductVersion(db, id, session)).rejects.toThrow('подготовки паспорта');
    await expect(claimProductPhotoVersion(db, id, session)).rejects.toBeInstanceOf(NotFoundException);
    expect((updateOne.mock.calls[0] as unknown as [Record<string, unknown>, { $inc: { __v: number } }])[1].$inc.__v).toBe(1);
  });

  it('серия схлопывает пробелы; проектировщик и название в договоре не затирают заполненное', async () => {
    const updateMany = jest.fn(async () => ({ modifiedCount: 1 }));
    const updateOne = jest.fn(async () => ({ matchedCount: 1 }));
    const db = { collection: () => ({ updateMany, updateOne }) } as never;
    await reassignProductSeries(db, '  Серия   А ', '  Бета  ');
    const [filter, update] = updateMany.mock.calls[0] as unknown as [{ series: RegExp }, { $set: { series: string } }];
    expect(filter.series.test(' серия а ')).toBe(true);
    expect(update.$set.series).toBe('Бета');
    const id = new Types.ObjectId();
    await fillProductDesigner(db, id, 'person');
    expect((updateOne.mock.calls[0] as unknown as [Record<string, unknown>])[0]).toEqual({ _id: id, designerId: null });
    await fillEmptyOrderName(db, id.toHexString(), '   ');
    expect(updateOne).toHaveBeenCalledTimes(1);
    await fillEmptyOrderName(db, id.toHexString(), ' Качели ');
    const nameFilter = (updateOne.mock.calls[1] as unknown as [{ $or: unknown[] }, { $set: { orderName: string } }]);
    expect(nameFilter[0].$or).toHaveLength(3);
    expect(nameFilter[1].$set.orderName).toBe('Качели');
  });

  it('признак: сначала добавить, потом снять; материал покрытия не стирает чужое до добавления', async () => {
    const updateMany = jest.fn(async () => ({ modifiedCount: 1 }));
    const db = { collection: () => ({ updateMany }) } as never;
    const from = new Types.ObjectId();
    const to = new Types.ObjectId();
    await reassignProductFacet(db, from, to);
    expect((updateMany.mock.calls[0] as unknown as [unknown, { $addToSet: unknown }])[1].$addToSet).toEqual({ facetValueIds: to });
    expect((updateMany.mock.calls[1] as unknown as [unknown, { $pull: unknown }])[1].$pull).toEqual({ facetValueIds: from });
    await reassignProductMaterialSpec(db, from, to);
    const coatingAdd = updateMany.mock.calls[3] as unknown as [Record<string, unknown>, { $push: unknown }];
    expect(coatingAdd[0].$and).toEqual([{ 'materialsSpec.coatingIds': from }, { 'materialsSpec.coatingIds': { $ne: to } }]);
    expect((updateMany.mock.calls[4] as unknown as [unknown, { $pull: unknown }])[1].$pull).toEqual({ 'materialsSpec.coatingIds': from });
  });

  it('вес PDM: ноль не пишет, положительный округляется в пустое поле', () => {
    const updateOne = jest.fn(() => undefined);
    const model = { updateOne, create: jest.fn() };
    expect(fillEmptyProductWeight(model, 'id', 0, session)).toBeUndefined();
    expect(updateOne).not.toHaveBeenCalled();
    fillEmptyProductWeight(model, 'id', 1.26, session);
    const [filter, update] = updateOne.mock.calls[0] as unknown as [Record<string, unknown>, { $set: { weightKg: number } }];
    expect(filter.$or).toEqual([{ weightKg: null }, { weightKg: { $exists: false } }, { weightKg: 0 }]);
    expect(update.$set.weightKg).toBe(1.3);
  });
});
