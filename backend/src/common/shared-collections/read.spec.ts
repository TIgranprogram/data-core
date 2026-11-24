import { SHARED_READ_FIELDS, SHARED_READ_OUTSIDE_SCHEMA } from './fields';
import { isSharedCollection, sharedCount, sharedFind, sharedProjection } from './read';

function colOf(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ op: string; filter?: unknown; options?: unknown }> = [];
  return {
    calls,
    find(filter: Record<string, unknown>, options?: { projection?: Record<string, unknown> }) {
      calls.push({ op: 'find', filter, options });
      const proj = options?.projection;
      const picked = rows.filter((row) => {
        if (filter.deletedAt === null && row.deletedAt != null) return false;
        if (filter.status !== undefined && row.status !== filter.status) return false;
        return true;
      }).map((row) => {
        if (!proj) return { ...row };
        const out: Record<string, unknown> = {};
        if (proj._id !== 0) out._id = row._id;
        for (const key of Object.keys(proj)) if (key !== '_id' && proj[key]) out[key] = row[key];
        return out;
      });
      const cursor = {
        limit() { return cursor; },
        sort() { return cursor; },
        toArray: async () => picked,
      };
      return cursor;
    },
    countDocuments(filter: Record<string, unknown>, options?: object) {
      calls.push({ op: 'count', filter, options });
      return Promise.resolve(rows.filter((row) => filter.deletedAt !== null || row.deletedAt == null).length);
    },
    aggregate() { return null; },
  };
}

describe('shared-collections — контракт и чтение', () => {
  it('шесть коллекций, поля вне схемы входят в контракт и без повторов', () => {
    expect(Object.keys(SHARED_READ_FIELDS).sort()).toEqual([
      'materials', 'reservations', 'stockmovements', 'storageitems', 'supplyrequests', 'warehouses',
    ]);
    for (const [name, extra] of Object.entries(SHARED_READ_OUTSIDE_SCHEMA)) {
      const fields = SHARED_READ_FIELDS[name as keyof typeof SHARED_READ_FIELDS];
      expect(new Set(fields).size).toBe(fields.length);
      for (const field of extra!) expect(fields).toContain(field);
    }
    expect(isSharedCollection('materials')).toBe(true);
    expect(isSharedCollection('incomes')).toBe(false);
  });

  it('тот же фильтр и та же выдача, если deletedAt уже null и проекция из контракта', async () => {
    const rows = [
      { _id: 'a', name: 'Болт', unit: 'шт', status: 'open', deletedAt: null, sku: 'скрыт' },
      { _id: 'b', name: 'Скрыт', unit: 'шт', status: 'open', deletedAt: new Date(), sku: 'x' },
    ];
    const db = colOf(rows);
    const filter = { status: 'open', deletedAt: null };
    const projection = { name: 1, unit: 1 };
    const via = await sharedFind(db, 'materials', filter, { projection }).limit(10).toArray();
    const direct = await db.find(filter, { projection }).toArray();
    expect(via).toEqual([{ _id: 'a', name: 'Болт', unit: 'шт' }]);
    expect(via).toEqual(direct);
    expect(db.calls[0]).toEqual({ op: 'find', filter, options: { projection } });
    expect(db.calls[0].filter).toBe(filter);
    expect(filter).toEqual({ status: 'open', deletedAt: null });
  });

  it('без проекции документ целиком, но удалённый не попадает', async () => {
    const db = colOf([{ _id: 'a', name: 'Живой', sku: 's', deletedAt: null }]);
    const got = await sharedFind(db, 'warehouses', { name: 'A' }).toArray();
    expect(got).toEqual([{ _id: 'a', name: 'Живой', sku: 's', deletedAt: null }]);
    expect(db.calls[0].filter).toEqual({ name: 'A', deletedAt: null });
    expect(db.calls[0].options).toEqual({});
  });

  it('includeDeleted не добавляет deletedAt, чужое поле и выключение поля отвергаются', () => {
    const db = colOf([]);
    const gone = { deletedAt: { $ne: null } };
    sharedCount(db, 'storageitems', gone, { includeDeleted: true });
    expect(db.calls[0]).toEqual({ op: 'count', filter: gone, options: undefined });
    expect(() => sharedProjection('materials', ['name', 'noSuch'])).toThrow(/не в контракте/);
    expect(() => sharedFind(db, 'warehouses', {}, { projection: { name: 0 } })).toThrow(/только включение/);
    expect(sharedProjection('reservations', ['_id', 'productId'])).toEqual({ _id: 1, productId: 1 });
  });
});
