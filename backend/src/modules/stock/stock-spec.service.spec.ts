import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { StockSpecService } from './stock-spec.service';

const id = () => new Types.ObjectId();
type Row = Record<string, any> & { _id: Types.ObjectId }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Склад в памяти: заказ, позиции заказа, позиции склада, остатки, брони. Только то, что зовёт StockSpecService. */
function setup(opts: { stock: Record<string, [number, number]> }) {
  const order = { _id: id(), stage: 'new' } as Row;
  const lineOk = { _id: id(), orderId: order._id, lineNo: 1, title: 'Стол' } as Row, lineOther = { _id: id(), orderId: id() } as Row;
  const mats: Row[] = Object.keys(opts.stock).map((name) => ({ _id: id(), name, unit: 'шт' }));
  const byName = (n: string) => mats.find((m) => m.name === n)!;
  const items = new Map<string, { quantity: number; reservedQty: number; save: jest.Mock }>();
  for (const m of mats) { const [q, r] = opts.stock[m.name]; items.set(String(m._id), { quantity: q, reservedQty: r, save: jest.fn(async () => undefined) }); }
  const resv: Row[] = [];
  const reservations = {
    create: jest.fn(async (docs: Row[]) => { for (const d of docs) resv.push({ ...d, _id: id() } as Row); return docs; }),
    find: (q: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const list = resv.filter((r) => String(r.salesOrderId) === String(q.salesOrderId) && r.status === q.status && /^Спецификация/.test(r.groupName ?? ''));
      const chain = { session: () => chain, exec: async () => list, lean: () => chain, then: undefined as unknown };
      return Object.assign(chain, { exec: async () => list });
    },
    findOne: (q: { clientUid: string }) => ({ lean: () => ({ exec: async () => resv.find((r) => r.clientUid === q.clientUid) ?? null }) }),
    countDocuments: async (q: { batchId: Types.ObjectId }) => resv.filter((r) => String(r.batchId) === String(q.batchId)).length,
  };
  const materials = { find: (q: Record<string, any>) => ({ lean: () => ({ exec: async () => (q._id ? mats.filter((m) => q._id.$in.some((i: Types.ObjectId) => i.equals(m._id))) : mats) }) }) }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const wh = { _id: id() };
  const coll = (name: string) => ({
    findOne: async (q: { _id: Types.ObjectId }) => (name === 'salesorders' && q._id.equals(order._id) ? order : null),
    find: (q: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      sort: () => ({ toArray: async () => mats.map((m) => ({ materialId: m._id, quantity: items.get(String(m._id))!.quantity, reservedQty: items.get(String(m._id))!.reservedQty })) }),
      toArray: async () => (name === 'incomes' ? [lineOk, lineOther].filter((l) => q._id.$in.some((i: Types.ObjectId) => i.equals(l._id))) : []),
    }),
  });
  const connection = { db: { collection: coll }, startSession: async () => ({ withTransaction: async (cb: () => Promise<void>) => cb(), endSession: async () => undefined }) };
  const core = { defaultWarehouse: async () => wh, loadStorage: async (_w: unknown, m: Types.ObjectId) => items.get(String(m)) };
  const released: Row[] = [];
  const resvSvc = { releaseWithin: jest.fn(async (r: Row) => { r.status = 'released'; released.push(r); }) };
  const svc = new StockSpecService(connection as never, reservations as never, materials as never, core as never, resvSvc as never);
  return { svc, order, lineOk, lineOther, byName, items, resv, released };
}

describe('StockSpecService.preview', () => {
  it('делит строки: готово / не хватает / не сопоставлено; ничего не пишет', async () => {
    const t = setup({ stock: { 'Болт М6': [100, 10], 'Гайка М6': [5, 0] } });
    const r = await t.svc.preview({ salesOrderId: String(t.order._id), lines: [
      { name: 'болт м6', qty: 50 }, { name: 'Гайка М6', qty: 8 }, { name: 'Уголок', qty: 1 }, { name: 'Болт М6', qty: 1, salesOrderLineId: String(t.lineOther._id) },
    ] });
    expect(r.counts).toEqual({ total: 4, matched: 1, short: 1, notMatched: 2 });
    expect(r.short[0]).toMatchObject({ need: 8, free: 5, shortBy: 3 });
    expect((r.notMatched as { reason: string }[]).map((x) => x.reason)).toEqual(['notFound', 'badLine']);
    expect(t.resv).toHaveLength(0);
  });
  it('одна позиция в двух строках: свободное расходуется по ходу файла', async () => {
    const t = setup({ stock: { Болт: [10, 0] } });
    const r = await t.svc.preview({ salesOrderId: String(t.order._id), lines: [{ name: 'Болт', qty: 6 }, { name: 'Болт', qty: 6 }] });
    expect(r.counts).toMatchObject({ matched: 1, short: 1 });
    expect(r.short[0]).toMatchObject({ free: 4, shortBy: 2 });
  });
});

describe('StockSpecService.apply', () => {
  const lines = (t: ReturnType<typeof setup>, ...a: [string, number][]) => a.map(([n, qty], row) => ({ row, materialId: String(t.byName(n)._id), qty }));

  it('брони одной пачкой с общим batchId и названием «Спецификация …»', async () => {
    const t = setup({ stock: { A: [10, 0], B: [10, 2] } });
    const r = await t.svc.apply({ salesOrderId: String(t.order._id), lines: [...lines(t, ['A', 3], ['B', 4]), { materialId: String(t.byName('A')._id), qty: 1, salesOrderLineId: String(t.lineOk._id) }], clientUid: 'u1' });
    expect(r.created).toBe(3);
    expect(t.resv).toHaveLength(3);
    expect(new Set(t.resv.map((x) => String(x.batchId))).size).toBe(1);
    expect(t.resv[0].groupName).toMatch(/^Спецификация /);
    expect(t.resv.filter((x) => x.salesOrderLineId)).toHaveLength(1);
    expect(t.items.get(String(t.byName('B')._id))!.reservedQty).toBe(6);
  });
  it('нехватка: строка пропущена и есть в отчёте', async () => {
    const t = setup({ stock: { A: [10, 0], B: [2, 0] } });
    const r = await t.svc.apply({ salesOrderId: String(t.order._id), lines: lines(t, ['A', 3], ['B', 5]) });
    expect(r.created).toBe(1);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toMatchObject({ need: 5, free: 2, reserved: 0 });
    expect(t.items.get(String(t.byName('B')._id))!.reservedQty).toBe(0);
  });
  it('takeFree: бронируется сколько свободно, остаток — в отчёте', async () => {
    const t = setup({ stock: { B: [2, 0] } });
    const r = await t.svc.apply({ salesOrderId: String(t.order._id), lines: lines(t, ['B', 5]), takeFree: true });
    expect(r.created).toBe(1);
    expect(t.resv[0].qty).toBe(2);
    expect(r.skipped[0]).toMatchObject({ need: 5, reserved: 2 });
  });
  it('повтор с тем же clientUid дублей не создаёт', async () => {
    const t = setup({ stock: { A: [10, 0] } });
    const dto = { salesOrderId: String(t.order._id), lines: lines(t, ['A', 3]), clientUid: 'same' };
    await t.svc.apply(dto);
    const again = await t.svc.apply(dto);
    expect(again.repeated).toBe(true);
    expect(t.resv).toHaveLength(1);
    expect(t.items.get(String(t.byName('A')._id))!.reservedQty).toBe(3);
  });
  it('replace снимает активные брони прежней загрузки', async () => {
    const t = setup({ stock: { A: [10, 0] } });
    await t.svc.apply({ salesOrderId: String(t.order._id), lines: lines(t, ['A', 3]) });
    const r = await t.svc.apply({ salesOrderId: String(t.order._id), lines: lines(t, ['A', 4]), replace: true });
    expect(r.replaced).toBe(1);
    expect(t.released).toHaveLength(1);
  });
  it('чужая позиция заказа или количество 0 — 400, ничего не записано', async () => {
    const t = setup({ stock: { A: [10, 0] } });
    const base = { materialId: String(t.byName('A')._id), qty: 1 };
    await expect(t.svc.apply({ salesOrderId: String(t.order._id), lines: [{ ...base, salesOrderLineId: String(t.lineOther._id) }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.svc.apply({ salesOrderId: String(t.order._id), lines: [{ ...base, qty: 0 }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(t.resv).toHaveLength(0);
  });
});
