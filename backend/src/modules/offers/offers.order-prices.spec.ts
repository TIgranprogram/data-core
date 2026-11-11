import { Types } from 'mongoose';
import { OffersService } from './offers.service';

/** C068-3 (решение владельца 2026-11-11): цены строк КП переносятся в позиции заказа. */
describe('OffersService: заказ из КП — с ценами', () => {
  const offer = {
    _id: new Types.ObjectId(), number: 'КП-12', status: 'accepted', companyId: new Types.ObjectId(), customer: 'ООО Ромашка',
    items: [
      { productName: 'Скамья', quantity: 2, unit: 'шт', unitPrice: 15000, total: 30000 },
      { productName: 'Монтаж', quantity: 1, unit: 'усл', total: 0 },
      { productName: 'Урна', quantity: 3, unit: 'шт', unitPrice: 0, total: 0 },
    ],
  };
  const chain = () => ({ lean: () => ({ exec: async () => offer }), exec: async () => ({ matchedCount: 1 }) });
  const model = { findOne: jest.fn(chain), updateOne: jest.fn(chain) };
  const salesOrders = { nextProductionNo: jest.fn(async () => ({ value: '45-26' })), create: jest.fn(async () => ({ id: String(new Types.ObjectId()), orderNo: 'КП-12', productionNo: '45-26' })) };
  const incomes = { create: jest.fn(async () => ({})) };
  const svc = new OffersService({} as never, model as never, {} as never, {} as never, salesOrders as never, incomes as never);
  jest.spyOn(svc as never, 'companyName' as never).mockResolvedValue('Наша фирма' as never);

  it('черновик заказа показывает цену строки; пустая и нулевая цена — без цены', async () => {
    const d = await svc.toOrder(String(offer._id));
    expect(d.lines.map((l) => l.unitPrice)).toEqual([15000, null, null]);
  });

  it('позиции создаются с ценой КП; строка без цены — без поля unitPrice', async () => {
    await svc.createOrder(String(offer._id), {} as never, { id: String(new Types.ObjectId()), username: 'man', role: 'manager' } as never);
    const sent = incomes.create.mock.calls.map((c) => (c as unknown[])[0] as Record<string, unknown>);
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({ title: 'Скамья', qty: 2, unitPrice: 15000, lineNo: 1 });
    expect(sent[1].unitPrice).toBeUndefined();
    expect(sent[2].unitPrice).toBeUndefined();
  });
});
