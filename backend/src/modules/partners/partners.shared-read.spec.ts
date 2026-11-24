import { Types } from 'mongoose';
import { PartnersService } from './partners.service';

const oid = () => new Types.ObjectId();

function chain(rows: unknown[]) {
  const cursor = {
    sort() { return cursor; },
    limit() { return cursor; },
    project() { return cursor; },
    toArray: async () => rows,
  };
  return cursor;
}

type Call = { name: string; op: string; filter?: unknown; options?: unknown };

/** Карточка заказчика доходит до склада: один заказ и одна выдача. */
function customerDb(orderId: Types.ObjectId, materialId: Types.ObjectId, calls: Call[]) {
  const coll = (name: string) => ({
    aggregate: () => ({ toArray: async () => (name === 'salesorders' ? [{ _id: 'Ромашка', n: 1, active: 0, last: null }] : []) }),
    find: (filter?: unknown, options?: unknown) => {
      calls.push({ name, op: 'find', filter, options });
      if (name === 'salesorders') return chain([{ _id: orderId, orderNo: '10' }]);
      if (name === 'stockmovements') return chain([{ _id: oid(), materialId, qty: 2, salesOrderId: orderId, date: null }]);
      if (name === 'materials') return chain([{ _id: materialId, name: 'Труба', unit: 'м', deletedAt: new Date() }]);
      return chain([]);
    },
  });
  return { db: { collection: coll } };
}

describe('PartnersService — чтение shared через слой', () => {
  it('имя снятого материала на выдаче сохраняется', async () => {
    const orderId = oid();
    const materialId = oid();
    const calls: Call[] = [];
    const svc = new PartnersService(customerDb(orderId, materialId, calls) as never);
    const card = await svc.get('c:Ромашка') as { issues: Array<{ name: string; unit: string }> };
    expect(card.issues[0]).toMatchObject({ name: 'Труба', unit: 'м' });
    const mat = calls.find((c) => c.name === 'materials');
    expect(mat?.filter).toEqual({ _id: { $in: [materialId] } });
    expect(mat?.options).toEqual({ projection: { name: 1, unit: 1 } });
  });

  it('карточка поставщика читает заявки полями контракта', async () => {
    const id = oid();
    const calls: Call[] = [];
    const coll = (name: string) => ({
      findOne: async () => ({ _id: id, name: 'Сталь', isOurCompany: false }),
      aggregate: () => ({ toArray: async () => [] }),
      find: (filter?: unknown, options?: unknown) => {
        calls.push({ name, op: 'find', filter, options });
        if (name === 'organizations') return chain([{ _id: id, name: 'Сталь' }]);
        if (name === 'supplyrequests') return chain([{ _id: oid(), num: '5', title: 'Лист' }]);
        return chain([]);
      },
    });
    const svc = new PartnersService({ db: { collection: coll } } as never);
    const card = await svc.get(String(id)) as unknown as { related: Array<{ num: string; title: string }> };
    expect(card.related[0]).toMatchObject({ num: '5', title: 'Лист' });
    const req = calls.find((c) => c.name === 'supplyrequests');
    expect(req?.filter).toEqual({ supplierId: id, deletedAt: null });
    expect(req?.options).toEqual({ projection: { num: 1, title: 1, qty: 1, unit: 1, status: 1, paid: 1, requestDate: 1, priceHint: 1 } });
  });

  it('удаление: shared не режет подпись вне контракта, чужая коллекция — с прежней проекцией', async () => {
    const id = oid();
    const calls: Call[] = [];
    const coll = (name: string) => ({
      findOne: async () => ({ _id: id, name: 'Сталь', isOurCompany: false }),
      countDocuments: async (filter: unknown) => {
        calls.push({ name, op: 'count', filter });
        return 0;
      },
      find: (filter: unknown, options: unknown) => {
        calls.push({ name, op: 'find', filter, options });
        if (name === 'notes') return chain([{ _id: oid(), name: 'Заметка' }]);
        return chain([]);
      },
    });
    const svc = new PartnersService({
      db: {
        collection: coll,
        listCollections: () => ({ toArray: async () => [{ name: 'storageitems' }, { name: 'notes' }] }),
      },
    } as never);
    await expect(svc.remove(String(id))).rejects.toThrow(/Заметка/);
    expect(calls.filter((c) => c.op === 'count').map((c) => c.filter)).toEqual([
      { supplierId: id, deletedAt: null },
      { companyId: id, deletedAt: null },
      { companyId: id, deletedAt: null },
    ]);
    const stored = calls.find((c) => c.name === 'storageitems');
    expect(stored?.filter).toMatchObject({ deletedAt: null });
    expect(stored?.options).toEqual({});
    const note = calls.find((c) => c.name === 'notes');
    expect(note?.options).toEqual({ projection: { num: 1, no: 1, orderNo: 1, name: 1 } });
  });

  it('удаление: имя позиции склада вне контракта чтения остаётся в тексте', async () => {
    const id = oid();
    const coll = (name: string) => ({
      findOne: async () => ({ _id: id, name: 'Сталь', isOurCompany: false }),
      countDocuments: async () => 0,
      find: () => chain(name === 'storageitems' ? [{ _id: oid(), name: 'Ячейка' }] : []),
    });
    const svc = new PartnersService({
      db: {
        collection: coll,
        listCollections: () => ({ toArray: async () => [{ name: 'storageitems' }] }),
      },
    } as never);
    await expect(svc.remove(String(id))).rejects.toThrow(/позициях склада \(№ Ячейка\)/);
  });
});
