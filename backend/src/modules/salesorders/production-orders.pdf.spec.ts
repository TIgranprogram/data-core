import { Types } from 'mongoose';
import { ProductionOrdersService } from './production-orders.service';
import { renderOrderPdf } from './order-pdf';

jest.mock('./order-pdf', () => ({
  ...jest.requireActual('./order-pdf'),
  renderOrderPdf: jest.fn(async () => Buffer.from('%PDF-пример')),
}));

describe('Печать договора и производственного заказа через прежний маршрут', () => {
  beforeEach(() => jest.clearAllMocks());

  const fixture = (productionNo?: string, multiple = false) => {
    const contract = (orderNo: string) => ({
      id: String(new Types.ObjectId()), orderNo, stage: 'new',
      lines: [{ id: String(new Types.ObjectId()), title: 'Скамья', qty: 2, unit: 'шт' }],
    });
    const card = { productionNo, orders: [contract('18/11/45'), ...(multiple ? [contract('18/11/46')] : [])] };
    const collection = { find: jest.fn(() => ({ toArray: async () => [] })) };
    const connection = { db: { collection: jest.fn(() => collection) } };
    const service = new ProductionOrdersService(connection as never, {} as never, {} as never, {} as never, {} as never);
    jest.spyOn(service, 'get').mockResolvedValue(card as never);
    return { service, card };
  };

  it.each([undefined, '', '   '])('договор без productionNo=%p использует номер договора и имя «Договор»', async productionNo => {
    const { service, card } = fixture(productionNo);
    const original = JSON.stringify(card);
    const result = await service.pdf(card.orders[0].id);
    expect(result.filename).toBe('Договор_18_11_45.pdf');
    expect(renderOrderPdf).toHaveBeenCalledWith(expect.objectContaining({
      documentKind: 'contract', number: '18/11/45',
      contracts: [expect.objectContaining({ orderNo: '18/11/45', lines: [expect.objectContaining({ title: 'Скамья', qty: 2 })] })],
    }));
    expect(JSON.stringify(card)).toBe(original);
  });

  it('заказ с несколькими договорами печатает productionNo, сохраняя номера договоров', async () => {
    const { service, card } = fixture('51-26', true);
    const original = JSON.stringify(card);
    const result = await service.pdf('51-26');
    expect(result.filename).toBe('Заказ_51-26.pdf');
    expect(renderOrderPdf).toHaveBeenCalledWith(expect.objectContaining({
      documentKind: 'order', number: '51-26',
      contracts: [expect.objectContaining({ orderNo: '18/11/45' }), expect.objectContaining({ orderNo: '18/11/46' })],
    }));
    expect(JSON.stringify(card)).toBe(original);
  });
});
