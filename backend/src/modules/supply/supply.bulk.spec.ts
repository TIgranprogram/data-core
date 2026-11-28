import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { foldPurchases, topSupplier } from '../stock/purchase-history';
import { SupplyService, type SupplyBulkInput } from './supply.service';
import { SUPPLY_REQUEST_API_FLAG } from './supply-request-flag';

const flagsOn = { isEnabled: async () => true };

/** Цепочка запросов Mongoose — любой метод возвращает её же, exec отдаёт результат. */
const chain = (result: unknown) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit', 'lean', 'setOptions']) c[m] = jest.fn(() => c);
  c.exec = jest.fn(async () => result);
  return c;
};

const oidOf = () => new Types.ObjectId();

describe('foldPurchases', () => {
  it('чаще, затем свежее; цена за единицу = сумма / количество', () => {
    const a = oidOf(), b = oidOf();
    const names = new Map([[String(a), 'Альфа'], [String(b), 'Бета']]);
    const list = foldPurchases([
      { supplierId: b, qty: 2, priceHint: 200, receivedAt: new Date('2026-03-01') },
      { supplierId: a, qty: 10, priceHint: 500, receivedAt: new Date('2026-02-01') },
      { supplierId: a, qty: 5, priceHint: 100, receivedAt: new Date('2026-01-01') },
    ], (id) => names.get(String(id)));
    expect(list.map((s) => s.name)).toEqual(['Альфа', 'Бета']);
    expect(list[0]).toMatchObject({ count: 2, lastPrice: 50, lastQty: 10 });
    expect(String(topSupplier(list)!.supplierId)).toBe(String(a));
  });
  it('без поставщика не выбирается; деньги скрыты без прав', () => {
    const list = foldPurchases([{ qty: 1, priceHint: 10 }], () => undefined, false);
    expect(list[0]).toMatchObject({ name: 'Поставщик не указан', lastPrice: null });
    expect(topSupplier(list)).toBeUndefined();
  });
});

describe('SupplyService.createBulk', () => {
  const m1 = oidOf(), m2 = oidOf(), m3 = oidOf(), sA = oidOf(), sB = oidOf();
  let colls: Record<string, Array<Record<string, unknown>>>;
  let saved: Array<Record<string, unknown>>;
  let history: Map<string, unknown[]>;
  let service: SupplyService;
  let model: { findOne: jest.Mock; findById: jest.Mock; create: jest.Mock; find: jest.Mock; aggregate: jest.Mock };
  let connection: { db: { collection: jest.Mock } };
  let stock: { findMaterialByName: jest.Mock; purchaseSuppliers: jest.Mock };
  let counters: { setSeqAtLeast: jest.Mock; nextSeq: jest.Mock };

  beforeEach(() => {
    saved = [];
    colls = {
      materials: [{ _id: m1, unit: 'м' }, { _id: m2 }, { _id: m3 }],
      organizations: [{ _id: sA, name: 'Альфа' }, { _id: sB, name: 'Бета' }],
      supplieritems: [{ materialId: m3, supplierId: sB, priceHint: 40 }],
    };
    history = new Map<string, unknown[]>([
      [String(m1), [{ name: 'Альфа', supplierId: sA, count: 3, lastDate: new Date(), lastPrice: 12.5, lastQty: 4 }]],
      [String(m2), []],
      [String(m3), []],
    ]);
    const inList = (v: unknown, id: unknown) => ((v as { $in?: unknown[] })?.$in ?? []).some((x) => String(x) === String(id));
    const collection = (name: string) => ({
      find: jest.fn((f: Record<string, unknown>) => ({
        toArray: async () => (colls[name] ?? []).filter((d) => !f._id || inList(f._id, d._id)),
      })),
      countDocuments: jest.fn(async (f: Record<string, unknown>) => (colls[name] ?? []).filter((d) => !f._id || inList(f._id, d._id)).length),
      findOne: jest.fn(async () => null),
    });
    connection = { db: { collection: jest.fn(collection) } };
    model = {
      findOne: jest.fn((f: Record<string, unknown>) => chain(f.clientUid ? saved.find((d) => d.clientUid === f.clientUid) ?? null : null)),
      findById: jest.fn((id: unknown) => chain(saved.find((d) => String(d._id) === String(id)) ?? null)),
      create: jest.fn(async (d: Record<string, unknown>) => { const doc = { _id: oidOf(), ...d }; saved.push(doc); return doc; }),
      find: jest.fn(() => chain([])),
      aggregate: jest.fn(() => chain([])),
    };
    stock = { findMaterialByName: jest.fn(async () => null), purchaseSuppliers: jest.fn(async () => history) };
    let seq = 0;
    counters = { setSeqAtLeast: jest.fn(async () => undefined), nextSeq: jest.fn(async () => ++seq) };
    service = new SupplyService(connection as never, model as never, stock as never, { safe: async () => true } as never, { recheck: async () => undefined } as never, counters as never, undefined, undefined, undefined, undefined, flagsOn as never);
    // get() тянет present() с десятком справочников — для проверки записи достаточно сырого документа
    jest.spyOn(service, 'get').mockImplementation((async (id: string) => saved.find((d) => String(d._id) === id) ?? { id }) as never);
    jest.spyOn(service as never, 'assertNew').mockResolvedValue(undefined as never);
  });

  const body = (items: SupplyBulkInput['items'], clientUid = 'u1') => ({ clientUid, items });

  it('3 строки → 3 заявки: поставщик и цена из истории, из прайса, без поставщика', async () => {
    const r = await service.createBulk(body([
      { materialId: String(m1), qty: 10, note: '  Два хлыста по 5 м  ' },
      { materialId: String(m2), qty: 2 },
      { materialId: String(m3), qty: 3, supplierId: String(sB) },
    ]), null, undefined);
    expect(r.total).toBe(3);
    expect(saved).toHaveLength(3);
    expect(saved[0]).toMatchObject({ qty: 10, unit: 'м', notes: 'Два хлыста по 5 м', priceHint: 125, clientUid: `u1:${m1}` });
    expect(saved[1].notes).toBeUndefined();
    expect(String(saved[0].materialId)).toBe(String(m1));
    expect(String(saved[0].supplierId)).toBe(String(sA));
    expect(saved[1].supplierId).toBeUndefined();
    expect(saved[1].priceHint).toBeUndefined();
    expect(String(saved[2].supplierId)).toBe(String(sB));
    expect(saved[2].priceHint).toBe(120); // прайс 40 × 3
  });

  it('повтор с тем же clientUid — те же заявки, новых нет', async () => {
    const items = [{ materialId: String(m1), qty: 10 }, { materialId: String(m2), qty: 2 }];
    const first = await service.createBulk(body(items), null);
    const again = await service.createBulk(body(items), null);
    expect(saved).toHaveLength(2);
    expect(again.items.map((x) => (x as { _id: unknown })._id)).toEqual(first.items.map((x) => (x as { _id: unknown })._id));
  });

  it('несуществующая позиция → 400, ничего не записано', async () => {
    await expect(service.createBulk(body([{ materialId: String(m1), qty: 1 }, { materialId: String(oidOf()), qty: 1 }]), null)).rejects.toBeInstanceOf(BadRequestException);
    expect(saved).toHaveLength(0);
  });

  it('флаг выключен — пачка не пишет заявки', async () => {
    const flags = { isEnabled: jest.fn(async () => false) };
    const blocked = new SupplyService(connection as never, model as never, stock as never, { safe: async () => true } as never, { recheck: async () => undefined } as never, counters as never, undefined, undefined, undefined, undefined, flags as never);
    jest.spyOn(blocked, 'get').mockImplementation((async (id: string) => saved.find((d) => String(d._id) === id) ?? { id }) as never);
    jest.spyOn(blocked as never, 'assertNew').mockResolvedValue(undefined as never);
    await expect(blocked.createBulk(body([{ materialId: String(m1), qty: 1 }]), null)).rejects.toMatchObject({ status: 409 });
    expect(flags.isEnabled).toHaveBeenCalledWith(SUPPLY_REQUEST_API_FLAG);
    expect(saved).toHaveLength(0);
  });

  it('неизвестный поставщик и повтор позиции → 400 до записи', async () => {
    await expect(service.createBulk(body([{ materialId: String(m1), qty: 1, supplierId: String(oidOf()) }]), null)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createBulk(body([{ materialId: String(m1), qty: 1 }, { materialId: String(m1), qty: 2 }]), null)).rejects.toBeInstanceOf(BadRequestException);
    expect(saved).toHaveLength(0);
  });
});
