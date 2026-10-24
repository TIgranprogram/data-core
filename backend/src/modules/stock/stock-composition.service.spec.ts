import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { compareWithComposition, perProduct, StockCompositionService } from './stock-composition.service';

const id = () => new Types.ObjectId();
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function setup(opts: { qty?: number; productId?: Types.ObjectId | null; composition?: Row[]; moves?: Row[] } = {}) {
  const mat = { _id: id(), name: 'Болт М8', unit: 'шт' };
  const product = { _id: id(), name: 'Лавка', composition: opts.composition ?? [] };
  const line = { _id: id(), orderNo: '552', lineNo: 2, title: 'Лавка', qty: opts.qty ?? 4, productId: opts.productId === undefined ? product._id : opts.productId };
  const moves = (opts.moves ?? [{ type: 'out', qty: 20 }]).map((m) => ({ materialId: mat._id, salesOrderLineId: line._id, ...m }));
  const data: Record<string, Row[]> = { incomes: [line], products: [product], stockmovements: moves, materials: [mat] };
  const connection = { db: { collection: (n: string) => ({
    findOne: async (q: Row) => data[n].find((d) => d._id.equals(q._id)) ?? null,
    find: () => ({ toArray: async () => data[n] }),
  }) } };
  const svc = new StockCompositionService(connection as never);
  // запись и цены — через ShowcaseComposition: подменяем, чтобы проверить, что именно уходит в состав
  const set = jest.fn(async (...[, lines]: [string, Row[], string[]?]) => { product.composition = lines.map((l) => ({ lineType: 'material', refId: new Types.ObjectId(l.materialId), quantity: l.quantity, notes: l.notes })); });
  const cost = jest.fn(async (lines: Row[]) => ({ total: 10, missing: 0, lines: lines.map(() => ({ price: 2, source: 'purchase', sum: 10 })) }));
  (svc as unknown as { comp: unknown }).comp = { set, cost };
  return { svc, mat, product, line, set, cost };
}

describe('состав из выдач: расчёт', () => {
  it('деление на количество изделий и признак округления', () => {
    expect(perProduct(20, 4)).toEqual({ per: 5, rounded: false });
    expect(perProduct(10, 3)).toEqual({ per: 3.33, rounded: true });
    expect(perProduct(5, 0).per).toBe(5);
  });
  it('сравнение с составом', () => {
    expect(compareWithComposition(5, null)).toBe('add');
    expect(compareWithComposition(5, 6)).toBe('change');
    expect(compareWithComposition(5, 5)).toBe('same');
  });
});

describe('StockCompositionService.suggest', () => {
  it('выдали 20 под позицию из 4 изделий → 5 на изделие, в составе нет → add', async () => {
    const t = setup();
    const r = await t.svc.suggest(String(t.line._id), false);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ materialId: String(t.mat._id), net: 20, perProduct: 5, current: null, status: 'add', rounded: false });
    expect(r.position).toBe('552-2');
  });
  it('возврат 4 вычитается; отменённое и записи-отмены не считаются', async () => {
    const t = setup({ moves: [{ type: 'out', qty: 20 }, { type: 'in', qty: 4, isReturn: true }, { type: 'out', qty: 100, cancelledAt: new Date() }, { type: 'in', qty: 100, cancelOf: id() }] });
    const r = await t.svc.suggest(String(t.line._id), false);
    expect(r.items[0]).toMatchObject({ issued: 20, returned: 4, net: 16, perProduct: 4 });
  });
  it('совпадает с составом / отличается', async () => {
    const t = setup({ composition: [{ lineType: 'material', refId: undefined, quantity: 5 }] });
    t.product.composition[0].refId = t.mat._id;
    expect((await t.svc.suggest(String(t.line._id), false)).items[0]).toMatchObject({ current: 5, status: 'same' });
    t.product.composition[0].quantity = 3;
    expect((await t.svc.suggest(String(t.line._id), false)).items[0]).toMatchObject({ current: 3, status: 'change' });
  });
  it('цены — только деньговым ролям', async () => {
    const t = setup();
    const no = await t.svc.suggest(String(t.line._id), false);
    expect(no.items[0]).not.toHaveProperty('price');
    expect(no).not.toHaveProperty('total');
    expect(t.cost).not.toHaveBeenCalled();
    const yes = await t.svc.suggest(String(t.line._id), true);
    expect(yes.items[0]).toMatchObject({ price: 2, priceSource: 'purchase', sum: 10 });
    expect(yes).toMatchObject({ total: 10, missing: 0 });
  });
  it('позиция без изделия — пустое предложение с причиной', async () => {
    const t = setup({ productId: null });
    const r = await t.svc.suggest(String(t.line._id), true);
    expect(r).toMatchObject({ productId: null, items: [] });
    expect(r.reason).toMatch(/нет изделия/);
  });
  it('ничего не выдано — пустой список с причиной', async () => {
    const t = setup({ moves: [] });
    expect((await t.svc.suggest(String(t.line._id), false)).reason).toMatch(/ничего не выдано/);
  });
});

describe('StockCompositionService.accept', () => {
  it('пишет на одно изделие; повтор — то же значение, не 2×, и без записи', async () => {
    const t = setup();
    const a = await t.svc.accept({ salesOrderLineId: String(t.line._id) }, false);
    expect(t.set).toHaveBeenCalledTimes(1);
    expect(t.set.mock.calls[0][1]).toEqual([expect.objectContaining({ materialId: String(t.mat._id), quantity: 5 })]);
    expect(t.set.mock.calls[0][2]).toEqual(['material']);
    expect(a.applied).toHaveLength(1);
    expect(a.items[0]).toMatchObject({ current: 5, status: 'same' });
    const b = await t.svc.accept({ salesOrderLineId: String(t.line._id) }, false);
    expect(t.set).toHaveBeenCalledTimes(1);
    expect(b.applied).toEqual([]);
    expect(t.product.composition[0].quantity).toBe(5);
  });
  it('существующие строки сохраняются, меняется только принятая', async () => {
    const other = id();
    const t = setup({ composition: [{ lineType: 'material', refId: other, quantity: 2, notes: 'вручную' }] });
    await t.svc.accept({ salesOrderLineId: String(t.line._id) }, false);
    const lines = t.set.mock.calls[0][1];
    expect(lines).toHaveLength(2);
    expect(lines).toEqual(expect.arrayContaining([expect.objectContaining({ materialId: String(other), quantity: 2, notes: 'вручную' })]));
  });
  it('materialIds ограничивает; чужой материал — 400; без изделия — 400', async () => {
    const t = setup();
    await expect(t.svc.accept({ salesOrderLineId: String(t.line._id), materialIds: [String(id())] }, false)).rejects.toBeInstanceOf(BadRequestException);
    const n = setup({ productId: null });
    await expect(n.svc.accept({ salesOrderLineId: String(n.line._id) }, false)).rejects.toBeInstanceOf(BadRequestException);
    expect(n.set).not.toHaveBeenCalled();
  });
});
