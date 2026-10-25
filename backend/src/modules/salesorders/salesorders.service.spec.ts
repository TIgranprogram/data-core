import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SalesOrderDto } from './dto';
import { SalesOrdersService } from './salesorders.service';

/** Цепочка запросов Mongoose: любой метод возвращает её же, exec отдаёт результат. */
const chain = (result: unknown) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit', 'lean', 'setOptions']) c[m] = jest.fn(() => c);
  c.exec = jest.fn(async () => result);
  return c;
};

describe('SalesOrderDto.priority (ПРЖ-3)', () => {
  const errs = async (body: object) => validate(plainToInstance(SalesOrderDto, body), { whitelist: true, forbidNonWhitelisted: true });
  it('urgent / high / normal / low и "" (снять) принимаются; прочее и запрос без priority — как раньше', async () => {
    for (const priority of ['urgent', 'high', 'normal', 'low', '']) expect(await errs({ priority })).toHaveLength(0);
    expect(await errs({ orderNo: '5' })).toHaveLength(0);
    expect(await errs({ priority: 'asap' })).toHaveLength(1);
  });
});

describe('SalesOrdersService: приоритет и изделие позиций', () => {
  let rows: Record<string, Array<Record<string, unknown>>>;
  let model: { find: jest.Mock; findOne: jest.Mock; countDocuments: jest.Mock; aggregate: jest.Mock; updateOne: jest.Mock };
  let incomesUpdateMany: jest.Mock;
  let service: SalesOrdersService;
  const orderId = new Types.ObjectId();

  beforeEach(() => {
    rows = {};
    incomesUpdateMany = jest.fn();
    const coll = (name: string) => {
      const q = { sort: () => q, toArray: async () => rows[name] ?? [] };
      return { find: jest.fn(() => q), aggregate: jest.fn(() => q), updateMany: incomesUpdateMany };
    };
    const connection = { db: { collection: jest.fn(coll) } };
    model = {
      find: jest.fn(() => chain([])), findOne: jest.fn(() => chain({ _id: orderId, orderNo: '5', importKey: 'x|5', stage: 'new' })),
      countDocuments: jest.fn(() => chain(0)), aggregate: jest.fn(() => chain([])), updateOne: jest.fn(() => chain({ matchedCount: 1 })),
    };
    service = new SalesOrdersService(connection as never, model as never);
  });

  it('список: фильтр priority — «normal» включает заказы без приоритета; мусор — 400', async () => {
    await service.list({ priority: 'urgent,normal' });
    const filter = model.find.mock.calls[0][0];
    expect(filter.$and).toContainEqual({ $or: [{ priority: { $in: ['urgent', 'normal'] } }, { priority: null }] });
    await expect(service.list({ priority: 'asap' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('список: сортировка по priority — по рангу (срочные сверху), не по алфавиту', async () => {
    await service.list({ sort: 'priority' });
    const pipeline = model.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(pipeline.find((s) => '$sort' in s)).toEqual({ $sort: { _rank: 1, _id: -1 } });
    expect(model.find).not.toHaveBeenCalled();
  });

  it('PATCH с priority пишет поле и не копирует его в позиции; "" снимает', async () => {
    jest.spyOn(service, 'get').mockResolvedValue({} as never);
    await service.update(String(orderId), { priority: 'urgent' });
    expect(model.updateOne.mock.calls[0][1].$set).toMatchObject({ priority: 'urgent' });
    expect(incomesUpdateMany).not.toHaveBeenCalled();
    await service.update(String(orderId), { priority: '' });
    expect(model.updateOne.mock.calls[1][1].$unset).toEqual({ priority: '' });
  });

  it('карточка: lines[].product {id, name, sku, photoId} — фото из products.photoIds', async () => {
    const prodId = new Types.ObjectId(), photo = new Types.ObjectId();
    rows.incomes = [{ _id: new Types.ObjectId(), orderId, lineNo: 1, productId: prodId }, { _id: new Types.ObjectId(), orderId, lineNo: 2 }];
    rows.products = [{ _id: prodId, name: 'Скамья', sku: '3410', photoIds: [photo] }];
    const r = (await service.get(String(orderId))) as unknown as { lines: Array<{ product: unknown }> };
    expect(r.lines[0].product).toEqual({ id: String(prodId), name: 'Скамья', sku: '3410', photoId: String(photo) });
    expect(r.lines[1].product).toBeNull();
  });
});
