import { ValidationPipe } from '@nestjs/common';
import { Types } from 'mongoose';
import { scopeOfZones } from '../../common/stock-scope';
import { StockReservationsService } from './stock-reservations.service';
import { StockItemReservationsDto } from './stock-item-reservations.dto';

const chain = (result: unknown) => {
  const q: Record<string, jest.Mock> = {};
  for (const key of ['sort', 'skip', 'limit', 'lean']) q[key] = jest.fn(() => q);
  q.exec = jest.fn(async () => result);
  return q;
};
describe('C271 — адресные брони', () => {
  it('точный материал до пагинации, общий count, остаток и исторический заказ', async () => {
    const materialId = new Types.ObjectId(); const orderId = new Types.ObjectId();
    const rows = chain([{ _id: new Types.ObjectId(), materialId, qty: 7, issuedQty: 3, orderId: 'Назначение', groupName: 'Каркас', salesOrderId: orderId }]);
    const reservations = { find: jest.fn(() => rows), countDocuments: jest.fn(() => chain(105)) };
    const materials = { findOne: jest.fn(() => chain({ _id: materialId, unit: 'м' })) };
    const find = jest.fn(() => ({ toArray: async () => [{ _id: orderId, orderNo: 'C271', stage: 'closed', amount: 123 }] }));
    const service = new StockReservationsService({ db: { collection: () => ({ find }) } } as never, {} as never, reservations as never, materials as never, {} as never, {} as never);
    const result = await service.itemReservations(String(materialId), { page: 2, limit: 100 }, null);
    expect(reservations.find).toHaveBeenCalledWith({ materialId, status: 'active', isActive: true, deletedAt: null });
    expect(reservations.countDocuments).toHaveBeenCalledWith({ materialId, status: 'active', isActive: true, deletedAt: null });
    expect(rows.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(rows.skip).toHaveBeenCalledWith(100);
    expect(result).toMatchObject({ total: 105, page: 2, limit: 100, items: [{ qty: 7, unit: 'м', orderId: 'Назначение', hanging: 'Заказ закрыт' }] });
    expect(JSON.stringify(result)).not.toContain('amount');
  });
  it('403 чужой и 404 missing без чтения броней', async () => {
    const materialId = new Types.ObjectId();
    const reservations = { find: jest.fn() };
    const materials = { findOne: jest.fn(() => chain({ _id: materialId, unit: 'м' })) };
    const service = new StockReservationsService({} as never, {} as never, reservations as never, materials as never, {} as never, {} as never);
    const scope = scopeOfZones([{ id: 'sheet', categoryIds: [] }]);
    await expect(service.itemReservations(String(materialId), { page: 1, limit: 20 }, scope)).rejects.toMatchObject({ status: 403 });
    materials.findOne.mockReturnValueOnce(chain(null));
    await expect(service.itemReservations(String(materialId), { page: 1, limit: 20 }, null)).rejects.toMatchObject({ status: 404 });
    expect(reservations.find).not.toHaveBeenCalled();
  });
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  it.each([{ page: '' }, { page: '1.1' }, { page: 'wat' }, { page: '0' }, { limit: '101' }, { materialId: 'x' }])('query %j запрещён', async query => {
    await expect(pipe.transform(query, { type: 'query', metatype: StockItemReservationsDto })).rejects.toMatchObject({ status: 400 });
  });
  it('default и целые строки', async () => {
    expect(await pipe.transform({}, { type: 'query', metatype: StockItemReservationsDto })).toEqual({ page: 1, limit: 20 });
    expect(await pipe.transform({ page: '2', limit: '100' }, { type: 'query', metatype: StockItemReservationsDto })).toEqual({ page: 2, limit: 100 });
  });
});

