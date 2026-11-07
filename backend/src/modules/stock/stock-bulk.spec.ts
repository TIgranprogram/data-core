import { BadRequestException } from '@nestjs/common';
import { Types, type Connection } from 'mongoose';
import { StockBulk, type BulkHost } from './stock-bulk';

/** Документ materials в «базе» — поля позиции. */
type Doc = Record<string, unknown> & { _id: Types.ObjectId };

/** Массовая правка позиций: минимальная «база» materials и хост карточки позиции. */
function make(initial: Record<string, unknown>[] = []) {
  const docs = initial as Doc[];
  const collection = {
    // как драйвер Mongo: снимок документа, а не живая ссылка (правка его не меняет)
    findOne: jest.fn(async (filter: { _id: Types.ObjectId }) => {
      const d = docs.find((x) => String(x._id) === String(filter._id));
      return d ? { ...d } : null;
    }),
    updateOne: jest.fn(async (filter: { _id: Types.ObjectId }, update: { $set?: Record<string, unknown>; $unset?: Record<string, string> }) => {
      const d = docs.find((x) => String(x._id) === String(filter._id));
      if (!d) return { modifiedCount: 0 };
      Object.assign(d, update.$set ?? {});
      for (const k of Object.keys(update.$unset ?? {})) delete d[k];
      return { modifiedCount: 1 };
    }),
  };
  const db = { collection: jest.fn(() => collection) };
  const categoryId = new Types.ObjectId();
  // как CategoryResolver: id важнее названия, пустое название — категория не назначена
  const resolveCategory = jest.fn(async (dto: { categoryId?: string; categoryName?: string }) =>
    dto.categoryId && Types.ObjectId.isValid(dto.categoryId) ? new Types.ObjectId(dto.categoryId) : String(dto.categoryName ?? '').trim() ? categoryId as Types.ObjectId | undefined : undefined);
  const markEdited = jest.fn(async () => undefined);
  const host: BulkHost = { db: () => db as unknown as NonNullable<Connection['db']>, resolveCategory, markEdited };
  const bulk = new StockBulk(host);
  return { bulk, docs, collection, resolveCategory, markEdited, categoryId };
}

const doc = (extra: Record<string, unknown> = {}): Doc => ({ _id: new Types.ObjectId(), name: 'Позиция', unit: 'шт', ...extra });

describe('C043: StockBulk', () => {
  it('меняет только белый список: пустые строки типа/марки/сортамента → null, лишние ключи игнорируются', async () => {
    const d = doc({ typeName: 'Соединитель', materialGrade: 'Ст3', assortment: '40×20', categoryId: new Types.ObjectId() });
    const h = make([d]);
    const r = await h.bulk.run({ ids: [String(d._id)], set: { typeName: '  ', materialGrade: '', assortment: ' 2 мм ', unit: 'кг', notes: 'нельзя', foo: 1 } });
    expect(r.updated).toBe(1);
    expect(r.failed).toEqual([]);
    expect(d.typeName).toBeNull();
    expect(d.materialGrade).toBeNull();
    expect(d.assortment).toBe('2 мм');
    expect(d.unit).toBe('кг');
    expect(d).not.toHaveProperty('notes');
    expect(d).not.toHaveProperty('foo');
    expect(h.markEdited).toHaveBeenCalledWith(d._id);
  });

  it('пустая единица измерения не затирает обязательное поле', async () => {
    const d = doc({ unit: 'шт' });
    const h = make([d]);
    await h.bulk.run({ ids: [String(d._id)], set: { unit: '  ', typeName: 'Труба' } });
    expect(d.unit).toBe('шт');
    expect(d.typeName).toBe('Труба');
  });

  it('без отметки, с пустым set и больше 500 позиций → 400', async () => {
    const d = doc();
    const h = make([d]);
    await expect(h.bulk.run({ ids: [], set: { unit: 'кг' } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.bulk.run({ ids: [String(d._id)], set: {} })).rejects.toThrow('Отметьте, что изменить');
    await expect(h.bulk.run({ ids: [String(d._id)], set: { categoryName: '   ' } })).rejects.toThrow('Отметьте, что изменить');
    const many = Array.from({ length: 501 }, () => String(new Types.ObjectId()));
    await expect(h.bulk.run({ ids: many, set: { unit: 'кг' } })).rejects.toThrow('не больше 500');
    expect(h.collection.updateOne).not.toHaveBeenCalled();
  });

  it('категория по названию: ищется/создаётся через CategoryResolver, before — прежние значения', async () => {
    const oldCategory = new Types.ObjectId();
    const d = doc({ categoryId: oldCategory, typeName: 'Труба' });
    const h = make([d]);
    const r = await h.bulk.run({ ids: [String(d._id)], set: { categoryName: 'Метизы' } });
    expect(h.resolveCategory).toHaveBeenCalledWith({ categoryId: undefined, categoryName: 'Метизы' });
    expect(String(d.categoryId)).toBe(String(h.categoryId));
    expect(r.before).toEqual([{ id: String(d._id), set: { typeName: 'Труба', categoryId: oldCategory, unit: 'шт', materialGrade: null, assortment: null } }]);
  });

  it('нет позиции или битый id — в failed, остальные обновляются', async () => {
    const d = doc({ unit: 'шт' });
    const h = make([d]);
    const r = await h.bulk.run({ ids: [String(d._id), String(new Types.ObjectId()), 'мусор'], set: { unit: 'кг' } });
    expect(r.updated).toBe(1);
    expect(r.before).toHaveLength(1);
    expect(r.failed.map((f) => f.id)).toEqual([expect.any(String), 'мусор']);
    expect(r.failed[0].message).toBe('Позиция не найдена');
    expect(d.unit).toBe('кг');
  });

  it('«Отменить»: возвращает прежние значения, null → поле убирается, лишние ключи не пишутся', async () => {
    const oldCategory = new Types.ObjectId();
    const d = doc({ typeName: null, categoryId: new Types.ObjectId(), unit: 'кг', materialGrade: 'Ст3' });
    const h = make([d]);
    const r = await h.bulk.restore({ items: [{ id: String(d._id), set: { typeName: 'Труба', categoryId: oldCategory, unit: 'шт', materialGrade: null, notes: 'нельзя' } }] });
    expect(r.restored).toBe(1);
    expect(d.typeName).toBe('Труба');
    expect(String(d.categoryId)).toBe(String(oldCategory));
    expect(d.unit).toBe('шт');
    expect(d).not.toHaveProperty('materialGrade');
    expect(d).not.toHaveProperty('notes');
    expect(h.markEdited).toHaveBeenCalledWith(d._id);
  });

  it('«Отменить»: битый id и больше 500 — ничего не ломают', async () => {
    const d = doc({ typeName: 'Труба' });
    const h = make([d]);
    expect(await h.bulk.restore({ items: [{ id: 'мусор', set: { typeName: 'Гайка' } }] })).toEqual({ restored: 0 });
    expect(await h.bulk.restore({ items: [{ id: String(d._id), set: { foo: 'бар' } }] })).toEqual({ restored: 0 });
    const many = Array.from({ length: 501 }, () => ({ id: String(new Types.ObjectId()), set: { typeName: 'Гайка' } }));
    await expect(h.bulk.restore({ items: many })).rejects.toThrow('не больше 500');
  });
});
