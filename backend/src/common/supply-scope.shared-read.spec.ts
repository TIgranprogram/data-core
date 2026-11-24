import { Types } from 'mongoose';
import { docInScope, docScopeMatch } from './supply-scope';
import { scopeMatch, type StockScope } from './stock-scope';

const cat = '507f1f77bcf86cd799439011';
const scope: StockScope = {
  zones: [{ id: 'z', categoryIds: new Set([cat]), includeIds: new Set(), excludeIds: new Set(), noCategory: false }],
  categoryIds: [cat],
  noCategory: false,
};

describe('supply-scope — чтение materials через слой', () => {
  it('список позиций склада не добавляет deletedAt', async () => {
    const calls: Array<{ filter: unknown; options?: unknown }> = [];
    const connection = {
      db: {
        collection: () => ({
          find: (filter: unknown, options?: unknown) => {
            calls.push({ filter, options });
            return { toArray: async () => [{ _id: 'm1' }] };
          },
        }),
      },
    };
    const match = await docScopeMatch(connection as never, scope);
    expect(calls[0].filter).toEqual(scopeMatch(scope));
    expect((calls[0].filter as { deletedAt?: unknown }).deletedAt).toBeUndefined();
    expect(calls[0].options).toEqual({ projection: { _id: 1 } });
    expect(match).toEqual({ $or: [{ materialId: { $in: ['m1'] } }, { materialId: null, categoryId: { $in: [new Types.ObjectId(cat), cat] } }] });
  });

  it('снятая позиция всё ещё проверяется по категории', async () => {
    const id = new Types.ObjectId();
    let filter: { _id?: Types.ObjectId; deletedAt?: unknown } | undefined;
    const connection = {
      db: {
        collection: () => ({
          find: (f: { _id?: Types.ObjectId; deletedAt?: unknown }) => {
            filter = f;
            return { limit: () => ({ toArray: async () => [{ _id: id, categoryId: cat }] }) };
          },
        }),
      },
    };
    expect(await docInScope(connection as never, scope, { materialId: id })).toBe(true);
    expect(String(filter?._id)).toBe(String(id));
    expect(filter?.deletedAt).toBeUndefined();
  });
});
