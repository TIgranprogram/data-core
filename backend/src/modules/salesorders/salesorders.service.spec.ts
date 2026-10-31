import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SalesOrderDto } from './dto';
import { SalesOrdersService, nextProductionNo } from './salesorders.service';

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
  let distinct: jest.Mock;
  let service: SalesOrdersService;
  const orderId = new Types.ObjectId();

  beforeEach(() => {
    rows = {};
    incomesUpdateMany = jest.fn();
    distinct = jest.fn(async () => [orderId]);
    const coll = (name: string) => {
      const q = { sort: () => q, toArray: async () => rows[name] ?? [] };
      return { find: jest.fn(() => q), aggregate: jest.fn(() => q), updateMany: incomesUpdateMany, distinct };
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

  it('список: ?productId= — только договоры с позицией этого изделия (КМ1); мусор — 400', async () => {
    const pid = new Types.ObjectId();
    await service.list({ productId: String(pid) });
    expect(distinct).toHaveBeenCalledWith('orderId', { productId: { $in: [pid] }, deletedAt: null, cancelledAt: null, orderId: { $ne: null } });
    expect(model.find.mock.calls[0][0].$and).toContainEqual({ _id: { $in: [orderId] } });
    await expect(service.list({ productId: 'zzz' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('список: сортировка по priority — по рангу (срочные сверху), не по алфавиту', async () => {
    await service.list({ sort: 'priority' });
    const pipeline = model.aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(pipeline.find((s) => '$sort' in s)).toEqual({ $sort: { _rank: 1, _id: -1 } });
    expect(model.find).not.toHaveBeenCalled();
  });

  it('requireFields (форма приложения): без № заказа, заказчика, компании — 400 со списком; без флага — как раньше', async () => {
    await expect(service.create({ orderNo: '7', requireFields: true })).rejects.toThrow('Заполните: № заказа, заказчик, наша компания');
    await expect(service.update(String(orderId), { customer: '', requireFields: true })).rejects.toThrow('Заполните: № заказа, заказчик, наша компания');
    await expect(service.update(String(orderId), { customer: 'Школа' })).resolves.toBeDefined();
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

describe('SalesOrdersService.matchProducts (ПРЖ-4)', () => {
  const orderId = new Types.ObjectId(), lineId = new Types.ObjectId(), prodId = new Types.ObjectId();
  const updateOne = jest.fn();
  let service: SalesOrdersService;
  beforeEach(() => {
    updateOne.mockClear();
    const rows: Record<string, Array<Record<string, unknown>>> = {
      incomes: [{ _id: lineId, lineNo: 1, title: 'Скамья парковая цвет графит' }],
      products: [{ _id: prodId, name: 'Скамья парковая', sku: '3411' }],
    };
    const coll = (n: string) => { const q = { sort: () => q, toArray: async () => rows[n] }; return { find: () => q, updateOne }; };
    const model = { findOne: () => chain({ _id: orderId }) };
    service = new SalesOrdersService({ db: { collection: coll } } as never, model as never);
  });

  it('без apply — предложения, записи нет', async () => {
    const r = await service.matchProducts(String(orderId));
    expect(r.items?.[0].suggestions[0]).toMatchObject({ productId: String(prodId), sku: '3411' });
    expect(updateOne).not.toHaveBeenCalled();
  });
  it('apply — пишет productId; чужая позиция — 400', async () => {
    await service.matchProducts(String(orderId), true, [{ lineId: String(lineId), productId: String(prodId) }]);
    expect(updateOne.mock.calls[0][1].$set.productId).toEqual(prodId);
    await expect(service.matchProducts(String(orderId), true, [{ lineId: String(new Types.ObjectId()), productId: String(prodId) }])).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('nextProductionNo — № на производство', () => {
  it('пусто → 1-26; max+1; чужой год и мусор не считаются', () => {
    expect(nextProductionNo([], '26')).toBe('1-26');
    expect(nextProductionNo(['9-26', '20-26', undefined, 'abc', '99-25', null], '26')).toBe('21-26');
  });
  it('сервис: ищет по году, считает и удалённые; плохой год — 400', async () => {
    const find = jest.fn<unknown, [unknown, unknown]>(() => chain([{ productionNo: '20-26' }]));
    const model = { find };
    const s = new SalesOrdersService({} as never, model as never);
    expect(await s.nextProductionNo({ year: '2026' })).toEqual({ value: '21-26' });
    expect((find.mock.calls[0][0] as { productionNo: RegExp }).productionNo.source).toBe(String.raw`^\d+-26$`);
    await expect(s.nextProductionNo({ year: 'x' })).rejects.toThrow(BadRequestException);
  });
});
