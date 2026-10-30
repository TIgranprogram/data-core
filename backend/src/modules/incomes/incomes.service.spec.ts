import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { IncomesService } from './incomes.service';
import { incomeDerived, incomePayments } from './income.schema';

/** Цепочка запросов Mongoose (find().sort().skip()…lean().exec()) — любой метод возвращает её же, exec отдаёт результат. */
const chain = (result: unknown) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit', 'lean', 'setOptions']) c[m] = jest.fn(() => c);
  c.exec = jest.fn(async () => result);
  return c;
};

describe('incomeDerived: платежи (В-4)', () => {
  const d = (s: string) => new Date(s);
  it('частично: paidAmount = Σ, paidDate пуст, reportDate = отгрузка', () => {
    const r = incomeDerived({ amountManual: 1000, shipDate: d('2026-10-10'), payments: [{ date: d('2026-10-01'), amount: 300 }] });
    expect(r).toMatchObject({ paidAmount: 300, paidDate: undefined, reportDate: d('2026-10-10') });
  });
  it('полностью: paidDate = дата последнего платежа', () => {
    const r = incomeDerived({ amountManual: 1000, payments: [{ date: d('2026-10-01'), amount: 300 }, { date: d('2026-10-20'), amount: 700 }] });
    expect(r).toMatchObject({ paidAmount: 1000, paidDate: d('2026-10-20'), reportDate: d('2026-10-20') });
  });
  it('старая запись: paidDate без платежей = оплачено на всю сумму; платежи для календаря — один', () => {
    expect(incomeDerived({ amountManual: 500, paidDate: d('2026-10-05') })).toMatchObject({ paidAmount: 500, paidDate: d('2026-10-05') });
    expect(incomePayments({ amount: 500, paidDate: d('2026-10-05') })).toEqual([{ date: d('2026-10-05'), amount: 500 }]);
    expect(incomePayments({ amount: 0, paidDate: d('2026-10-05') })).toEqual([]);
  });
});

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

  describe('защита состава заказа (этап ≠ new)', () => {
    const orderId = new Types.ObjectId();
    const manager = { id: 'm', username: 'm', role: 'manager' };
    const MSG = 'Заказ уже в работе. Менять позиции может только администратор.';
    beforeEach(() => {
      colls.salesorders = [{ _id: orderId, stage: 'production', orderNo: '5' }];
      current = { _id: new Types.ObjectId(), orderId, title: 'Скамья', qty: 2, deletedAt: null };
    });

    it('менеджер: title/qty → 403 по-русски, productId/color/notes → можно', async () => {
      await expect(service.update(String(current!._id), { title: 'Другое' } as never, manager)).rejects.toThrow(MSG);
      await expect(service.update(String(current!._id), { qty: 5 } as never, manager)).rejects.toThrow(ForbiddenException);
      await expect(service.update(String(current!._id), { productId: String(new Types.ObjectId()), color: 'красный', notes: 'x' } as never, manager)).resolves.toBeDefined();
    });
    it('неизменённое значение title (форма шлёт всё) — не блокирует', async () => {
      await expect(service.update(String(current!._id), { title: 'Скамья', qty: 2 } as never, manager)).resolves.toBeDefined();
    });
    it('менеджер: добавить / удалить позицию → 403', async () => {
      await expect(service.create({ title: 'Новая', orderId: String(orderId) } as never, undefined, manager)).rejects.toThrow(MSG);
      await expect(service.remove(String(current!._id), manager)).rejects.toThrow(MSG);
    });
    it('менеджер: restore позиции в сформированный заказ → 403, admin — можно', async () => {
      await expect(service.restore(String(current!._id), manager)).rejects.toThrow(MSG);
      await expect(service.restore(String(current!._id), { ...manager, role: 'admin' })).resolves.toBeDefined();
    });
    it('admin и машинный ключ — можно', async () => {
      await expect(service.update(String(current!._id), { title: 'Другое' } as never, { ...manager, role: 'admin' })).resolves.toBeDefined();
      await expect(service.update(String(current!._id), { qty: 9 } as never, { ...manager, keyScope: {} as never })).resolves.toBeDefined();
    });
    it('этап new — менеджер правит как раньше', async () => {
      colls.salesorders = [{ _id: orderId, stage: 'new' }];
      await expect(service.update(String(current!._id), { title: 'Другое' } as never, manager)).resolves.toBeDefined();
    });
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
      expect(r).toMatchObject({ status: 'awaiting', companyName: 'ООО Наша', product: { id: String(pid), name: 'Скамья', sku: 'S1', ourName: 'S1 · Скамья' } });
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
      expect(c.all).toBe(c.paid + c.partial + c.awaiting + c.noamount + c.draft);
      expect(Object.keys(r.counts).sort()).toEqual(['all', 'awaiting', 'draft', 'noamount', 'paid', 'partial']);
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
    it('формы оплаты: обычные (б/р, 30 %, 50 %, нал) и встреченные — без дублей', async () => {
      model.distinct.mockReturnValue(chain(['нал', 'карта', '']));
      colls.organizations = [{ _id: new Types.ObjectId(), name: 'ООО Наша', isOurCompany: true }];
      const r = await service.lookups();
      expect(r.paymentForms).toEqual(['б/р', 'б/р 30%', 'б/р 50%', 'карта', 'нал']);
      expect(r.companies).toHaveLength(1);
    });

    it('справочник «Формы оплаты» + данные: дубли разного написания схлопываются, написание справочника главнее', async () => {
      colls.dict_values = [{ name: 'б/р 30%' }, { name: 'Нал' }];
      model.distinct.mockReturnValue(chain(['б/р  30%', 'НАЛ', 'карта']));
      const r = await service.lookups();
      expect(r.paymentForms).toEqual(['б/р 30%', 'карта', 'Нал']);
    });
  });
});

describe('СВ-11 (3): новый платёж у позиции без договора → Бухгалтерия', () => {
  const run = async (order: Record<string, unknown> | null, f: Record<string, unknown>, cur: Record<string, unknown>) => {
    const notifyZone = jest.fn(async () => ({}));
    const conn = { db: { collection: () => ({ findOne: async () => order }) } };
    const svc = new IncomesService(conn as never, {} as never, { notifyZone } as never);
    await svc.notifyNoContract({ _id: new Types.ObjectId(), customer: 'ООО А', ...cur }, f);
    return notifyZone;
  };
  const pay = { date: new Date(), amount: 500, method: 'x' };
  it('платёж добавлен, договора нет — событие в accounting без повтора (Infinity)', async () => {
    const n = await run({ _id: 1, contractNo: '' }, { payments: [pay] }, { orderId: new Types.ObjectId() });
    expect(n).toHaveBeenCalledWith('accounting', expect.objectContaining({ type: 'income_no_contract' }), expect.objectContaining({ dedupeDays: Infinity }));
  });
  it('есть договор или платёж не новый — тишина', async () => {
    expect(await run({ _id: 1, contractNo: 'Д-1' }, { payments: [pay] }, { orderId: new Types.ObjectId() })).not.toHaveBeenCalled();
    expect(await run(null, { payments: [pay] }, { payments: [pay] })).not.toHaveBeenCalled();
  });
});

describe('HARDEN-1: платежи не теряются', () => {
  let current: Record<string, unknown>;
  let upd: jest.Mock;
  let service: IncomesService;
  const chain2 = (r: unknown) => { const c: Record<string, jest.Mock> = {}; for (const m of ['lean', 'setOptions']) c[m] = jest.fn(() => c); c.exec = jest.fn(async () => r); return c; };
  beforeEach(() => {
    current = { _id: new Types.ObjectId(), title: 'Скамья', qty: 1, unitPrice: 1000, amount: 1000, paidAmount: 300, payments: [{ date: new Date('2026-10-01'), amount: 300 }] };
    upd = jest.fn(() => chain2({ matchedCount: 1 }));
    const model = { findOne: jest.fn(() => chain2(current)), updateOne: upd };
    const conn = { db: { collection: () => ({ findOne: async () => null, find: () => ({ toArray: async () => [] }) }) } };
    service = new IncomesService(conn as never, model as never);
  });
  const id = () => String(current._id);

  it('п.1: форма шлёт неизменённый paidDate — аванс остаётся авансом', async () => {
    await service.update(id(), { title: 'Скамья', paidDate: '' } as never);
    const u = upd.mock.calls[0][1];
    expect(u.$set.paidAmount).toBe(300);
    expect(u.$set.payments).toHaveLength(1);
  });
  it('п.1: изменённый paidDate при платежах — 400', async () => {
    await expect(service.update(id(), { paidDate: '2026-10-05' } as never)).rejects.toThrow('меняйте в платеже');
    expect(upd).not.toHaveBeenCalled();
  });
  it('п.1: payments: [] отменяет оплату', async () => {
    await service.update(id(), { payments: [], paidDate: '' } as never);
    expect(upd.mock.calls[0][1].$set.paidAmount).toBe(0);
  });
  it('п.2: addPayment пишет с условием на прежнее состояние; не совпало — 409', async () => {
    await service.addPayment(id(), { date: '2026-10-02', amount: 100 });
    expect(upd.mock.calls[0][0]).toMatchObject({ paidAmount: 300, payments: { $size: 1 } });
    upd.mockReturnValue(chain2({ matchedCount: 0 }));
    await expect(service.addPayment(id(), { date: '2026-10-02', amount: 100 })).rejects.toThrow('Оплату уже изменили');
  });
  it('п.2: повтор с тем же clientUid не добавляет платёж', async () => {
    current.paymentUids = ['u1'];
    await service.addPayment(id(), { date: '2026-10-02', amount: 100, clientUid: 'u1' });
    expect(upd).not.toHaveBeenCalled();
    await service.addPayment(id(), { date: '2026-10-02', amount: 100, clientUid: 'u2' });
    expect(upd.mock.calls[0][1].$push).toEqual({ paymentUids: 'u2' });
  });
  it('п.2: removePayment — сумма не совпала с платежом по номеру → 409', async () => {
    await expect(service.removePayment(id(), 0, undefined, 999)).rejects.toThrow('Оплату уже изменили');
    await service.removePayment(id(), 0, undefined, 300);
    expect(upd.mock.calls[0][0]).toMatchObject({ payments: { $size: 1 } });
  });
  it('п.14: позицию с оплатой удалить нельзя — 409, запись не тронута', async () => {
    await expect(service.remove(id())).rejects.toThrow('есть оплата');
    expect(upd).not.toHaveBeenCalled();
  });
});
