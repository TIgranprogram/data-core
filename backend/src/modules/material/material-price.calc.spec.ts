import { unitPrices } from './material-price.calc';
import { MaterialPriceService } from './material-price.service';

describe('unitPrices', () => {
  it('сумма с НДС 20% / кол-во → цена без НДС и с НДС', () => {
    expect(unitPrices(1200, 10)).toEqual({ price: 100, priceWithVat: 120 });
  });
  it('своя ставка', () => { expect(unitPrices(110, 1, 10)).toEqual({ price: 100, priceWithVat: 110 }); });
  it('нет суммы или количества → null', () => {
    expect(unitPrices(0, 5)).toBeNull();
    expect(unitPrices(100, 0)).toBeNull();
  });
});

describe('MaterialPriceService.record', () => {
  const mk = () => {
    const prices = { updateOne: jest.fn().mockReturnValue({ exec: jest.fn() }), create: jest.fn() };
    const materials = { updateOne: jest.fn().mockReturnValue({ exec: jest.fn() }) };
    return { prices, materials, svc: new MaterialPriceService(prices as never, materials as never) };
  };
  const base = { materialId: 'm' as never, lineTotalWithVat: 240, qty: 2, date: new Date('2026-10-20'), source: 'invoice_issued' as const, requestId: 'r' as never };

  it('анти-дубль: upsert по (requestId, source), не create', async () => {
    const { prices, svc } = mk();
    expect(await svc.record(base)).toBe(true);
    expect(prices.updateOne).toHaveBeenCalledWith({ requestId: 'r', source: 'invoice_issued' }, expect.objectContaining({ $set: expect.objectContaining({ price: 100, priceWithVat: 120 }) }), expect.objectContaining({ upsert: true }));
    expect(prices.create).not.toHaveBeenCalled();
  });
  it('материал обновляется только если дата не старше', async () => {
    const { materials, svc } = mk();
    await svc.record(base);
    expect(materials.updateOne.mock.calls[0][0].$or).toContainEqual({ lastPriceDate: { $lte: base.date } });
  });
  it('без цены — ничего не пишет', async () => {
    const { prices, materials, svc } = mk();
    expect(await svc.record({ ...base, lineTotalWithVat: 0 })).toBe(false);
    expect(prices.updateOne).not.toHaveBeenCalled();
    expect(materials.updateOne).not.toHaveBeenCalled();
  });
});
