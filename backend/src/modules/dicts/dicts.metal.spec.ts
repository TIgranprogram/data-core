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
