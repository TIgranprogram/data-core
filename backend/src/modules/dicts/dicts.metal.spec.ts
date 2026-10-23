import { Types } from 'mongoose';
import { DICT } from './dicts.defs';

/** Справочники металла склада: описание, счёт «используется» по materials и перенос значений при объединении. */
describe('справочники металла', () => {
  it.each([['metalAssortments', 'assortment'], ['steelGrades', 'materialGrade']])('%s: группа склада, поле %s', async (key, field) => {
    const d = DICT.get(key)!;
    expect(d.group).toBe('Склад и позиции');
    expect(d.coll).toBe('dict_values');
    const doc = { _id: new Types.ObjectId(), name: ' Ст3 ' };
    const aggregate = jest.fn<{ toArray: () => Promise<unknown[]> }, [Record<string, Record<string, unknown>>[]]>(() => ({ toArray: async () => [{ _id: 'ст3', n: 4 }] }));
    const updateMany = jest.fn<Promise<{ modifiedCount: number }>, [unknown, unknown]>(async () => ({ modifiedCount: 2 }));
    const db = { collection: jest.fn(() => ({ aggregate, updateMany })) } as never;
    expect((await d.usage(db, [doc])).get(String(doc._id))).toBe(4);
    expect(aggregate.mock.calls[0][0][0].$match).toHaveProperty(field);
    expect(await d.reassign(db, doc, { _id: new Types.ObjectId(), name: 'Ст3сп' })).toBe(2);
    expect(updateMany.mock.calls[0][1]).toEqual({ $set: { [field]: 'Ст3сп', updatedAt: expect.any(Date) } });
  });
});

describe('справочник «Формы оплаты» и цвета (SPR-2)', () => {
  const mk = (rowsByColl: Record<string, unknown[]> = {}) => {
    const updateMany = jest.fn<Promise<{ modifiedCount: number }>, [string, unknown, unknown]>(async () => ({ modifiedCount: 1 }));
    const db = {
      collection: jest.fn((name: string) => ({
        aggregate: () => ({ toArray: async () => rowsByColl[name] ?? [] }),
        find: () => ({ toArray: async () => [] }),
        updateMany: (f: unknown, u: unknown) => updateMany(name, f, u),
      })),
    } as never;
    return { db, updateMany };
  };

  it('paymentForms: группа, usage по incomes, кандидаты — значения по умолчанию и из данных', async () => {
    const d = DICT.get('paymentForms')!;
    expect(d.group).toBe('Заявки и счета');
    const doc = { _id: new Types.ObjectId(), name: 'б/р 30%' };
    const { db, updateMany } = mk({ incomes: [{ _id: 'Б/Р 30%', n: 3 }, { _id: 'карта', n: 2 }] });
    expect((await d.usage(db, [doc])).get(String(doc._id))).toBe(3);
    const names = (await d.candidates!(db)).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['б/р', 'нал', 'карта']));
    expect(await d.reassign(db, doc, { _id: new Types.ObjectId(), name: 'б/р 30 %' })).toBe(1);
    expect(updateMany.mock.calls[0][0]).toBe('incomes');
  });

  it('colors: «используется» суммирует склад, позиции заказов и заявки', async () => {
    const d = DICT.get('colors')!;
    const doc = { _id: new Types.ObjectId(), name: 'RAL 6005' };
    const { db } = mk({ materials: [{ _id: 'RAL 6005', n: 1 }], incomes: [{ _id: 'ral 6005', n: 2 }], supplyrequests: [{ _id: 'RAL 6005', n: 4 }] });
    expect((await d.usage(db, [doc])).get(String(doc._id))).toBe(7);
  });
});
