import { Types } from 'mongoose';
import { StockSummaryService } from './stock-summary.service';
import { buildMonthly, buildPrices, buildSuppliers, lastMonths, topCustomers } from './stock-summary';

const id = () => new Types.ObjectId();
const A = id(), B = id(), C = id();
const names = new Map([[String(A), 'Альфа'], [String(B), 'Бета'], [String(C), 'Гамма']]);
const nameOf = (i: Types.ObjectId) => names.get(String(i));
const got = [
  { supplierId: A, qty: 10, priceHint: 1000, receivedAt: new Date('2026-10-05') },
  { supplierId: A, qty: 5, priceHint: 400, receivedAt: new Date('2026-08-01') },
  { supplierId: B, qty: 2, priceHint: 300, receivedAt: new Date('2026-09-01') },
];
const offers = [
  { supplierId: B, priceHint: 99, priceDate: new Date('2026-01-01') },
  { supplierId: C, priceHint: 120, priceDate: new Date('2026-02-01'), priceHistory: [{ price: 118, date: new Date('2026-01-10') }] },
];

describe('сводка позиции: расчёты', () => {
  it('поставщики: закупки со статистикой, предложение без закупок — count 0, не дублирует купленных', () => {
    const s = buildSuppliers(got, offers, nameOf, true);
    expect(s.map((x) => x.name)).toEqual(['Альфа', 'Бета', 'Гамма']);
    expect(s[0]).toMatchObject({ count: 2, totalQty: 15, lastPrice: 100, minPrice: 80, maxPrice: 100 });
    expect(s[0].firstDate).toEqual(new Date('2026-08-01'));
    expect(s[2]).toMatchObject({ count: 0, totalQty: 0, lastPrice: 120, minPrice: 120, maxPrice: 120, firstDate: null });
  });

  it('без денег: цены null, но поставщики и числа на месте', () => {
    const s = buildSuppliers(got, offers, nameOf, false);
    expect(s[0]).toMatchObject({ count: 2, totalQty: 15, lastPrice: null, minPrice: null, maxPrice: null });
    expect(buildPrices(got, offers, nameOf, false).every((p) => p.price === null)).toBe(true);
  });

  it('цены: по дате по возрастанию, источник и поставщик, не больше limit', () => {
    const p = buildPrices(got, offers, nameOf, true);
    expect(p.map((x) => x.source)).toEqual(['catalog', 'purchase', 'purchase', 'purchase']);
    expect(p.map((x) => x.price)).toEqual([118, 80, 150, 100]);
    expect(p[2].supplierName).toBe('Бета');
    expect(buildPrices(got, offers, nameOf, true, 2)).toHaveLength(2);
  });

  it('помесячно: 12 месяцев, заказано / получено, отменённые не считаются, чужие месяцы отбрасываются', () => {
    const now = new Date('2026-11-07T10:00:00Z');
    expect(lastMonths(now)).toHaveLength(12);
    expect(lastMonths(now)[0]).toBe('2025-12');
    const m = buildMonthly(now, [
      { qty: 10, status: 'received', requestDate: new Date('2026-10-01'), receivedAt: new Date('2026-10-20') },
      { qty: 4, status: 'ordered', requestDate: new Date('2026-11-02') },
      { qty: 7, status: 'cancelled', requestDate: new Date('2026-11-03') },
      { qty: 9, status: 'received', requestDate: new Date('2024-01-01'), receivedAt: new Date('2024-01-05') },
    ], [{ qty: 3, date: new Date('2026-11-05') }, { qty: 1, date: new Date('2020-01-01') }]);
    expect(m.find((x) => x.month === '2026-10')).toMatchObject({ ordered: 10, received: 10, issued: 0 });
    expect(m.find((x) => x.month === '2026-11')).toMatchObject({ ordered: 4, received: 0, issued: 3 });
  });

  it('заказчики: суммы по заказчику, число заказов, топ по убыванию', () => {
    const t = topCustomers([
      { orderId: '1', customer: 'ООО Икс', qty: 5 }, { orderId: '2', customer: 'ООО Икс', qty: 2 },
      { orderId: '3', customer: 'ИП Игрек', qty: 9 }, { orderId: '4', customer: 'Зэт', qty: 0 },
    ], 10);
    expect(t).toEqual([{ name: 'ИП Игрек', qty: 9, orders: 1 }, { name: 'ООО Икс', qty: 7, orders: 2 }]);
    expect(topCustomers(Array.from({ length: 15 }, (_, i) => ({ orderId: String(i), customer: `К${i}`, qty: 1 })))).toHaveLength(10);
  });
});

describe('сводка позиции: сервис', () => {
  const mid = id(), wh = id(), ord = id(), line = id();
  const data: Record<string, unknown[]> = {
    materials: [{ _id: mid, name: 'Труба 20', article: 'T-20', unit: 'м', categoryId: id() }],
    categories: [{ name: 'Трубы' }],
    storageitems: [{ warehouseId: wh, zoneName: 'А-1', quantity: 10, reservedQty: 4 }, { warehouseId: wh, quantity: 0, reservedQty: 0 }],
    warehouses: [{ _id: wh, name: 'Основной' }],
    supplyrequests: [{ _id: id(), num: 7, qty: 10, status: 'received', priceHint: 1000, supplierId: A, receivedAt: new Date('2026-10-05'), createdAt: new Date('2026-10-01') }],
    supplieritems: [],
    organizations: [{ _id: A, name: 'Альфа' }],
    stockmovements: [{ _id: id(), date: new Date('2026-11-01'), qty: 3, salesOrderId: ord, salesOrderLineId: line }],
    reservations: [{ salesOrderId: ord, qty: 4 }],
    salesorders: [{ _id: ord, orderNo: '34', customer: 'ООО Икс' }],
    incomes: [{ _id: line, title: 'Каркас' }],
    products: [], productmodules: [],
  };
  const coll = (name: string) => {
    const cur = { sort: () => cur, limit: () => cur, toArray: async () => (name === 'categories' ? data.categories : data[name] ?? []) };
    return {
      findOne: async () => (data[name] ?? [])[0] ?? null, find: () => cur, countDocuments: async () => (data[name] ?? []).length,
      aggregate: () => ({ toArray: async () => [{ qty: 3 }] }),
    };
  };
  const svc = new StockSummaryService({ db: { collection: coll } } as never, { assertMaterials: async () => undefined } as never);

  it('собирает паспорт: остаток и места, поставщика, заявку, выдачу с заказчиком, аналитику', async () => {
    const r = await svc.summary(String(mid), true, null, new Date('2026-11-07'));
    expect(r).toMatchObject({ name: 'Труба 20', categoryName: 'Трубы', stock: { total: 10, reserved: 4, free: 6, places: [{ warehouseName: 'Основной', place: 'А-1', qty: 10 }] } });
    expect(r.suppliers[0]).toMatchObject({ name: 'Альфа', count: 1, lastPrice: 100 });
    expect(r.requests).toMatchObject({ total: 1, open: 1 });
    expect(r.requests.items[0]).toMatchObject({ num: 7, statusLabel: 'Получено', supplierName: 'Альфа' });
    expect(r.issued).toMatchObject({ totalQty: 3, items: [{ qty: 3, orderNum: '34', customerName: 'ООО Икс', workType: 'Каркас' }] });
    expect(r.customers).toEqual([{ name: 'ООО Икс', qty: 7, orders: 1 }]);
    expect(r.usedIn).toEqual({ products: 0, orders: 1 });
    expect(r.monthly).toHaveLength(12);
  });

  it('роль без денег: цены null', async () => {
    const r = await svc.summary(String(mid), false, null, new Date('2026-11-07'));
    expect(r.suppliers[0].lastPrice).toBeNull();
    expect(r.prices.every((p) => p.price === null)).toBe(true);
  });
});
