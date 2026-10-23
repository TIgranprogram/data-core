import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { IncomesService } from './incomes.service';
import { incomeDerived } from './income.schema';

/** Цепочка запросов Mongoose (find().sort().skip()…lean().exec()) — любой метод возвращает её же, exec отдаёт результат. */
const chain = (result: unknown) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit', 'lean', 'setOptions']) c[m] = jest.fn(() => c);
  c.exec = jest.fn(async () => result);
  return c;
};

describe('incomeDerived', () => {
  it('сумма = qty * unitPrice с округлением до копеек', () => {
    expect(incomeDerived({ qty: 3, unitPrice: 10.555 }).amount).toBe(31.67);
  });
  it('ручная сумма важнее расчёта (в том числе 0)', () => {
    expect(incomeDerived({ qty: 3, unitPrice: 10, amountManual: 100 }).amount).toBe(100);
    expect(incomeDerived({ qty: 3, unitPrice: 10, amountManual: 0 }).amount).toBe(0);
  });
  it('нет цены или количества → 0', () => {
    expect(incomeDerived({ qty: 3 }).amount).toBe(0);
    expect(incomeDerived({}).amount).toBe(0);
  });
  it('reportDate = paidDate ?? shipDate', () => {
    const ship = new Date('2026-01-10'), paid = new Date('2026-02-01');
    expect(incomeDerived({ shipDate: ship, paidDate: paid }).reportDate).toBe(paid);
    expect(incomeDerived({ shipDate: ship }).reportDate).toBe(ship);
    expect(incomeDerived({}).reportDate).toBeUndefined();
  });
});

describe('IncomesService', () => {
  let colls: Record<string, Array<Record<string, unknown>>>;
  let model: { find: jest.Mock; findOne: jest.Mock; countDocuments: jest.Mock; aggregate: jest.Mock; create: jest.Mock; updateOne: jest.Mock; distinct: jest.Mock };
  let service: IncomesService;
  /** Что вернёт findOne по _id (текущая запись) и по clientUid (дубль). */
  let current: Record<string, unknown> | null;
  let dup: Record<string, unknown> | null;

  beforeEach(() => {
    colls = {};
    current = null;
    dup = null;
    const collection = (name: string) => ({
      find: jest.fn(() => ({ toArray: async () => colls[name] ?? [] })),
      findOne: jest.fn(async () => (colls[name] ?? [])[0] ?? null),
      distinct: jest.fn(async () => []),
    });
    const connection = { db: { collection: jest.fn(collection) } };
    model = {
      find: jest.fn(() => chain([])),
      findOne: jest.fn((f: Record<string, unknown>) => chain(f.clientUid ? dup : current)),
      countDocuments: jest.fn(() => chain(0)),
      aggregate: jest.fn(() => chain([])),
      create: jest.fn(async (d: Record<string, unknown>) => { current = { _id: new Types.ObjectId(), ...d }; return current; }),
      updateOne: jest.fn(() => chain({ matchedCount: 1 })),
      distinct: jest.fn(() => chain([])),
    };
    service = new IncomesService(connection as never, model as never);
  });

  describe('create', () => {
    it('без наименования → BadRequest', async () => {
      await expect(service.create({ qty: 1 } as never)).rejects.toThrow(BadRequestException);
      await expect(service.create({ title: '   ' } as never)).rejects.toThrow('Укажите наименование');
      expect(model.create).not.toHaveBeenCalled();
    });

    it('считает amount и reportDate, пишет автора', async () => {
      const uid = new Types.ObjectId().toHexString();
      await service.create({ title: 'Скамья', qty: 2, unitPrice: 500, shipDate: '2026-03-05' } as never, uid);
      const arg = model.create.mock.calls[0][0];
      expect(arg.amount).toBe(1000);
      expect(arg.reportDate).toBeInstanceOf(Date);
      expect(arg.createdBy).toEqual(new Types.ObjectId(uid));
    });

    it('clientUid уже есть — возвращает существующую запись без создания', async () => {
      const id = new Types.ObjectId();
      dup = { _id: id, title: 'Дубль' };
      current = dup;
      const res = await service.create({ title: 'Дубль', clientUid: 'u1' } as never);
      expect(model.create).not.toHaveBeenCalled();
      expect(res.id).toBe(String(id));
    });

    it('неверная дата отгрузки → BadRequest', async () => {
      await expect(service.create({ title: 'X', shipDate: 'не дата' } as never)).rejects.toThrow(BadRequestException);
    });

    it('productId не задан — привязывает изделие по короткому названию', async () => {
      const pid = new Types.ObjectId();
      colls.products = [{ _id: new Types.ObjectId(), name: 'Другое' }, { _id: pid, name: 'Трибуны на 200 мест' }];
      await service.create({ title: 'Трибуны на 200 мест. Цвет: графит' } as never);
      expect(model.create.mock.calls[0][0].productId).toEqual(pid);
    });

    it('нет подходящего изделия — productId не пишется', async () => {
      colls.products = [{ _id: new Types.ObjectId(), name: 'Другое' }];
      await service.create({ title: 'Скамья' } as never);
      expect(model.create.mock.calls[0][0]).not.toHaveProperty('productId');
    });

    it('явный productId: null — не привязывает автоматически', async () => {
      colls.products = [{ _id: new Types.ObjectId(), name: 'Скамья' }];
      await service.create({ title: 'Скамья', productId: null } as never);
      expect(model.create.mock.calls[0][0]).not.toHaveProperty('productId');
    });

    it('явный productId сохраняется как ObjectId', async () => {
      const pid = new Types.ObjectId();
      colls.products = [{ _id: new Types.ObjectId(), name: 'Скамья' }];
      await service.create({ title: 'Скамья', productId: String(pid) } as never);
      expect(model.create.mock.calls[0][0].productId).toEqual(pid);
    });

    it('с заказом: шапка берётся из заказа, lineNo = последний + 1', async () => {
      const orderId = new Types.ObjectId();
      colls.salesorders = [{ _id: orderId, orderNo: '123', customer: 'ООО Ромашка', paymentForm: 'б/р' }];
      const cur = { _id: new Types.ObjectId(), title: 'x' };
      model.findOne.mockImplementation((f: Record<string, unknown>) => chain(f.orderId ? { lineNo: 4 } : f.clientUid ? null : cur));
      await service.create({ title: 'Скамья', orderId: String(orderId) } as never);
      const arg = model.create.mock.calls[0][0];
      expect(arg).toMatchObject({ orderNo: '123', customer: 'ООО Ромашка', paymentForm: 'б/р', lineNo: 5 });
    });

    it('заказ не найден → BadRequest', async () => {
      await expect(service.create({ title: 'X', orderId: String(new Types.ObjectId()) } as never)).rejects.toThrow('Заказ не найден');
    });

    it('неизвестная наша компания по названию → BadRequest', async () => {
      colls.organizations = [{ _id: new Types.ObjectId(), name: 'ООО Наша', isOurCompany: true }];
      await expect(service.create({ title: 'X', companyName: 'Чужая' } as never)).rejects.toThrow(BadRequestException);
    });

    it('наша компания находится по названию без учёта регистра', async () => {
      const cid = new Types.ObjectId();
      colls.organizations = [{ _id: cid, name: 'ООО Наша', isOurCompany: true }];
      await service.create({ title: 'X', companyName: 'ооо наша' } as never);
      expect(model.create.mock.calls[0][0].companyId).toEqual(cid);
    });
  });

  describe('update', () => {
    const base = () => ({ _id: new Types.ObjectId(), title: 'Скамья', qty: 2, unitPrice: 100 });

    it('несуществующая запись → NotFound', async () => {
      await expect(service.update(String(new Types.ObjectId()), { title: 'X' } as never)).rejects.toThrow(NotFoundException);
    });

    it('пустое наименование → BadRequest', async () => {
      current = base();
      await expect(service.update(String(current._id), { title: ' ' } as never)).rejects.toThrow('Наименование не может быть пустым');
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('оплата без суммы → BadRequest', async () => {
      current = { _id: new Types.ObjectId(), title: 'Скамья' };
      await expect(service.update(String(current._id), { paidDate: '2026-04-01' } as never)).rejects.toThrow(/Сначала впишите сумму/);
    });

    it('оплата при наличии суммы — проходит, reportDate = дата оплаты', async () => {
      current = { ...base(), shipDate: new Date('2026-03-01') };
      await service.update(String(current._id), { paidDate: '2026-04-01' } as never);
      const upd = model.updateOne.mock.calls[0][1];
      expect(upd.$set).toMatchObject({ amount: 200, editedInApp: true });
      expect(upd.$set.paidDate).toBeInstanceOf(Date);
      expect(upd.$set.reportDate).toEqual(upd.$set.paidDate);
    });

    it('ставит editedInApp и пересчитывает сумму из новых qty', async () => {
      current = base();
      await service.update(String(current._id), { qty: 5 } as never);
      expect(model.updateOne.mock.calls[0][1].$set).toMatchObject({ qty: 5, amount: 500, editedInApp: true });
    });

    it('null в числовом поле и пустой текст очищают поле ($unset)', async () => {
      current = { ...base(), notes: 'a' };
      await service.update(String(current._id), { unitPrice: null, notes: '' } as never);
      const upd = model.updateOne.mock.calls[0][1];
      expect(upd.$unset).toMatchObject({ unitPrice: '', notes: '', reportDate: '' });
      expect(upd.$set.unitPrice).toBeUndefined();
    });

    it('productId: null отвязывает изделие', async () => {
      current = { ...base(), productId: new Types.ObjectId() };
      await service.update(String(current._id), { productId: null } as never);
      expect(model.updateOne.mock.calls[0][1].$unset).toHaveProperty('productId');
    });

    it('правка поля шапки у позиции заказа подтягивает шапку из заказа', async () => {
      const orderId = new Types.ObjectId();
      colls.salesorders = [{ _id: orderId, orderNo: '7', customer: 'Заказчик' }];
      current = { ...base(), orderId };
      await service.update(String(current._id), { customer: 'Левое' } as never);
      expect(model.updateOne.mock.calls[0][1].$set).toMatchObject({ orderNo: '7', customer: 'Заказчик' });
    });

    it('мусорный id → BadRequest', async () => {
      await expect(service.update('abc', {} as never)).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove / restore', () => {
    it('remove ставит deletedAt и editedInApp', async () => {
      const id = String(new Types.ObjectId());
      await expect(service.remove(id)).resolves.toEqual({ id, deleted: true });
      expect(model.updateOne.mock.calls[0][1].$set).toMatchObject({ editedInApp: true });
      expect(model.updateOne.mock.calls[0][1].$set.deletedAt).toBeInstanceOf(Date);
    });

    it('remove несуществующей → NotFound', async () => {
      model.updateOne.mockReturnValue(chain({ matchedCount: 0 }));
      await expect(service.remove(String(new Types.ObjectId()))).rejects.toThrow(NotFoundException);
    });

    it('restore обнуляет deletedAt и возвращает запись', async () => {
      const id = new Types.ObjectId();
      current = { _id: id, title: 'Скамья' };
      const res = await service.restore(String(id));
      expect(model.updateOne.mock.calls[0][1]).toEqual({ $set: { deletedAt: null } });
      expect(res.id).toBe(String(id));
    });

    it('restore записи не из корзины → NotFound', async () => {
      model.updateOne.mockReturnValue(chain({ matchedCount: 0 }));
      await expect(service.restore(String(new Types.ObjectId()))).rejects.toThrow('Записи нет в корзине');
    });
  });

  describe('get / list', () => {
    it('get несуществующей → NotFound', async () => {
      await expect(service.get(String(new Types.ObjectId()))).rejects.toThrow(NotFoundException);
    });

    it('get: статус по датам и сумме, название компании и изделия', async () => {
      const cid = new Types.ObjectId(), pid = new Types.ObjectId();
      colls.organizations = [{ _id: cid, name: 'ООО Наша', isOurCompany: true }];
      colls.products = [{ _id: pid, name: 'Скамья', sku: 'S1' }];
      current = { _id: new Types.ObjectId(), companyId: cid, productId: pid, shipDate: new Date(), amount: 100 };
      const r = await service.get(String(current._id));
      expect(r).toMatchObject({ status: 'awaiting', companyName: 'ООО Наша', product: { id: String(pid), name: 'Скамья', sku: 'S1' } });
    });

    it('status: paid / noamount / draft', async () => {
      const mk = async (d: Record<string, unknown>) => { current = { _id: new Types.ObjectId(), ...d }; return (await service.get(String(current._id))).status; };
      expect(await mk({ paidDate: new Date(), amount: 1 })).toBe('paid');
      expect(await mk({ shipDate: new Date(), amount: 0 })).toBe('noamount');
      expect(await mk({})).toBe('draft');
    });

    it('list: форма ответа, сумма и счётчики по статусам', async () => {
      const doc = { _id: new Types.ObjectId(), title: 'A', amount: 10 };
      model.find.mockReturnValue(chain([doc]));
      model.countDocuments.mockImplementation((f: Record<string, unknown>) => chain(f.paidDate && typeof f.paidDate === 'object' ? 2 : 1));
      model.aggregate.mockReturnValue(chain([{ _id: null, sum: 777 }]));
      const r = await service.list({ page: 2, limit: 10 });
      expect(r).toMatchObject({ page: 2, limit: 10, sum: 777 });
      expect(r.items).toHaveLength(1);
      const c = r.counts as Record<string, number>;
      expect(c.all).toBe(c.paid + c.awaiting + c.noamount + c.draft);
      expect(Object.keys(r.counts).sort()).toEqual(['all', 'awaiting', 'draft', 'noamount', 'paid']);
    });

    it('list: по умолчанию без удалённых, корзина — deletedAt != null', async () => {
      await service.list({});
      expect(model.find.mock.calls[0][0].deletedAt).toBeNull();
      await service.list({ deleted: '1' });
      expect(model.find.mock.calls[1][0].deletedAt).toEqual({ $ne: null });
    });

    it('list: фильтр status=awaiting и период по reportDate', async () => {
      await service.list({ status: 'awaiting', from: '2026-01-01', to: '2026-01-31' });
      const f = model.find.mock.calls[0][0];
      expect(f).toMatchObject({ paidDate: null, shipDate: { $ne: null }, amount: { $gt: 0 } });
      expect(f.reportDate.$gte).toEqual(new Date(Date.UTC(2026, 0, 1)));
      expect(f.reportDate.$lt).toEqual(new Date(Date.UTC(2026, 1, 1)));
    });

    it('list: поиск — каждое слово ($and) в одном из 6 текстовых полей ($or); статус «Без суммы» его не затирает', async () => {
      await service.list({ search: 'скам двойн', status: 'noamount' });
      const f = model.find.mock.calls[0][0];
      expect(f.$and).toHaveLength(2);
      expect(f.$and[0].$or).toHaveLength(6);
      expect(f.$or).toHaveLength(2); // свой $or статуса «Без суммы»
    });

    it('list: нельзя сортировать по постороннему полю', async () => {
      await expect(service.list({ sort: 'password' })).rejects.toThrow(BadRequestException);
    });

    it('list: суммы нет — sum = 0', async () => {
      const r = await service.list({});
      expect(r.sum).toBe(0);
    });
  });

  describe('фото', () => {
    it('addPhoto: фото нет → NotFound', async () => {
      await expect(service.addPhoto(String(new Types.ObjectId()), String(new Types.ObjectId()))).rejects.toThrow('Фото не найдено');
    });

    it('addPhoto: позиция не найдена → NotFound', async () => {
      colls.photos = [{ _id: new Types.ObjectId() }];
      model.updateOne.mockReturnValue(chain({ matchedCount: 0 }));
      await expect(service.addPhoto(String(new Types.ObjectId()), String(new Types.ObjectId()))).rejects.toThrow('Позиция не найдена');
    });

    it('removePhoto: $pull и editedInApp', async () => {
      const id = new Types.ObjectId();
      current = { _id: id };
      await service.removePhoto(String(id), String(new Types.ObjectId()));
      expect(model.updateOne.mock.calls[0][1]).toMatchObject({ $set: { editedInApp: true } });
      expect(model.updateOne.mock.calls[0][1].$pull).toBeDefined();
    });
  });

  describe('lookups', () => {
    it('формы оплаты: «б/р», «нал» и встреченные — без дублей', async () => {
      model.distinct.mockReturnValue(chain(['нал', 'карта', '']));
      colls.organizations = [{ _id: new Types.ObjectId(), name: 'ООО Наша', isOurCompany: true }];
      const r = await service.lookups();
      expect(r.paymentForms).toEqual(['б/р', 'карта', 'нал']);
      expect(r.companies).toHaveLength(1);
    });
  });
});
