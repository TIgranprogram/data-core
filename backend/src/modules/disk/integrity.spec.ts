import { Types } from 'mongoose';
import { IntegrityService } from './integrity';

const id = () => new Types.ObjectId();
// мини-подделка db.collection(name).find(q).limit().toArray(): фильтры склада — по ключевым полям запроса
function fakeDb(data: Record<string, Record<string, unknown>[]>) {
  return { collection: (name: string) => ({ find: (q: Record<string, any>) => {
    let rows = data[name] ?? [];
    if (q.quantity) rows = rows.filter((r) => (r.quantity as number) < 0);
    if (q.qty) rows = rows.filter((r) => (r.qty as number) <= 0);
    if (q._id?.$in) { const want = new Set(q._id.$in.map(String)); rows = rows.filter((r) => want.has(String(r._id))); }
    const out = { limit: () => out, toArray: async () => rows };
    return out;
  } }) };
}

describe('А1: проверка целостности (только чтение)', () => {
  it('находит отрицательный остаток, бронь на 0 и бронь на удалённую позицию', async () => {
    const m1 = id(); const gone = id();
    const db = fakeDb({
      storageitems: [{ _id: id(), materialId: m1, quantity: -2 }],
      reservations: [{ _id: id(), materialId: gone, qty: 0, status: 'active' }],
      materials: [{ _id: m1 }],
      salesorders: [],
    });
    const svc = new IntegrityService({ db } as never);
    const r = await svc.report();
    const keys = r.issues.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['negative-stock', 'empty-reservation', 'reservation-no-material']));
    expect(keys).not.toContain('stock-no-material');
  });

  it('чистые данные — пустой список', async () => {
    const m1 = id();
    const db = fakeDb({ storageitems: [{ _id: id(), materialId: m1, quantity: 3 }], reservations: [], materials: [{ _id: m1 }], salesorders: [] });
    expect((await new IntegrityService({ db } as never).report()).issues).toEqual([]);
  });
});
