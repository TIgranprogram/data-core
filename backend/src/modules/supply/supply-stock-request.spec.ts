import { ValidationPipe } from '@nestjs/common';
import { Types } from 'mongoose';
import { SupplyService } from './supply.service';
import { SupplyStockRequestDto, SupplyStockRequestQueryDto } from './supply-stock-request.dto';

const uid = '65b53f88-2f80-4af7-92b6-18d9182bf201';
const id = String(new Types.ObjectId());
const actor = String(new Types.ObjectId());
const chain = (value: unknown) => ({ setOptions() { return this; }, lean() { return this; }, exec: async () => value });

describe('C271 — намерение закупки', () => {
  const make = () => {
    let saved: Record<string, unknown> | null = null;
    const model = { findOne: jest.fn(() => chain(saved)) };
    const stock = { activeItem: jest.fn(async () => ({ name: 'Труба', unit: 'м' })) };
    const flags = { isEnabled: jest.fn(async () => true) };
    const service = new SupplyService({} as never, model as never, stock as never, {} as never, {} as never, {} as never, undefined, undefined, undefined, undefined, flags as never);
    jest.spyOn(service, 'assertNew').mockResolvedValue(undefined);
    const create = jest.spyOn(service, 'create').mockImplementation(async (dto, _user, _scope, intent) => {
      if (saved) throw { code: 11000, keyPattern: { _id: 1 } };
      saved = { ...dto, _id: intent?.id, num: 12, status: 'requested', paid: false };
      return saved as never;
    });
    return { service, model, stock, flags, create, saved: () => saved! };
  };

  it('два одновременных первых запроса дают один id и защищены unique _id', async () => {
    const x = make();
    const results = await Promise.all([1, 2].map(() => x.service.createStockRequest(id, { qty: 7, clientUid: uid }, actor, null)));
    expect(results[0]).toEqual(results[1]);
    expect(Object.keys(results[0]).sort()).toEqual(['id', 'materialId', 'num', 'qty', 'status', 'unit']);
    expect(x.saved().clientUid).toMatch(/^c271:[0-9a-f]{64}$/);
    expect(x.saved()).toMatchObject({ materialId: id, unit: 'м', requestedBy: actor });
  });

  it('retry после правки количества сравнивает исходный fingerprint', async () => {
    const x = make();
    const first = await x.service.createStockRequest(id, { qty: 7, clientUid: uid }, actor, null);
    x.saved().qty = 3;
    expect(await x.service.createStockRequest(id, { qty: 7, clientUid: uid }, actor, null)).toMatchObject({ id: first.id, qty: 3 });
    await expect(x.service.createStockRequest(id, { qty: 8, clientUid: uid }, actor, null)).rejects.toMatchObject({ status: 409 });
    await expect(x.service.createStockRequest(String(new Types.ObjectId()), { qty: 7, clientUid: uid }, actor, null)).rejects.toMatchObject({ status: 409 });
    x.saved().materialId = new Types.ObjectId();
    await expect(x.service.createStockRequest(id, { qty: 7, clientUid: uid }, actor, null)).rejects.toMatchObject({ status: 409 });
    expect(x.create).toHaveBeenCalledTimes(1);
  });

  it('доступ проверяется до поиска повтора; C262 и отсутствие unit блокируют запись', async () => {
    const x = make();
    x.stock.activeItem.mockRejectedValueOnce(Object.assign(new Error('чужая'), { status: 403 }));
    await expect(x.service.createStockRequest(id, { qty: 1, clientUid: uid }, actor, null)).rejects.toMatchObject({ status: 403 });
    expect(x.model.findOne).not.toHaveBeenCalled();
    x.flags.isEnabled.mockResolvedValueOnce(false);
    await expect(x.service.createStockRequest(id, { qty: 1, clientUid: uid }, actor, null)).rejects.toMatchObject({ status: 409 });
    x.stock.activeItem.mockResolvedValueOnce({ name: 'Без единицы', unit: '' });
    await expect(x.service.createStockRequest(id, { qty: 1, clientUid: uid }, actor, null)).rejects.toMatchObject({ status: 400 });
    expect(x.create).not.toHaveBeenCalled();
  });

  it('ошибку duplicate другого индекса не маскирует', async () => {
    const x = make();
    x.create.mockRejectedValueOnce({ code: 11000, keyPattern: { num: 1 } });
    await expect(x.service.createStockRequest(id, { qty: 1, clientUid: uid }, actor, null)).rejects.toMatchObject({ keyPattern: { num: 1 } });
  });

  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  it.each([0, -1, '1', null, Infinity, NaN])('DTO отклоняет qty=%s', async qty => {
    await expect(pipe.transform({ qty, clientUid: uid }, { type: 'body', metatype: SupplyStockRequestDto })).rejects.toMatchObject({ status: 400 });
  });
  it.each(['unit', 'priceHint', 'materialId', 'status', 'paid'])('DTO запрещает override %s', async key => {
    await expect(pipe.transform({ qty: 1, clientUid: uid, [key]: 'x' }, { type: 'body', metatype: SupplyStockRequestDto })).rejects.toMatchObject({ status: 400 });
  });
  it('DTO запрещает query и не-UUIDv4', async () => {
    await expect(pipe.transform({ qty: 1, clientUid: 'x' }, { type: 'body', metatype: SupplyStockRequestDto })).rejects.toMatchObject({ status: 400 });
    await expect(pipe.transform({ unit: 'м' }, { type: 'query', metatype: SupplyStockRequestQueryDto })).rejects.toMatchObject({ status: 400 });
  });
});
