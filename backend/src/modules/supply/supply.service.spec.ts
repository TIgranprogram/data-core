import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SupplyService } from './supply.service';
import { labelFromPriority, labelFromStatus, priorityFromLabel, statusFromLabel } from './supply-labels';

/** Цепочка запросов Mongoose — любой метод возвращает её же, exec отдаёт результат. */
const chain = (result: unknown) => {
  const c: Record<string, jest.Mock> = {};
  for (const m of ['sort', 'skip', 'limit', 'lean', 'setOptions']) c[m] = jest.fn(() => c);
  c.exec = jest.fn(async () => result);
  return c;
};

describe('supply-labels', () => {
  it('подпись → статус и оплата', () => {
    expect(statusFromLabel('✅ Заказать')).toEqual({ status: 'requested' });
    expect(statusFromLabel('⚙️ В работе')).toEqual({ status: 'ordered' });
    expect(statusFromLabel('💰 Оплачено')).toEqual({ status: 'ordered', paid: true });
    expect(statusFromLabel('☑️ Получено')).toEqual({ status: 'received' });
    expect(statusFromLabel('❌ Отменено')).toEqual({ status: 'cancelled' });
    expect(statusFromLabel('что-то')).toBeUndefined();
    expect(statusFromLabel('')).toBeUndefined();
  });
  it('статус и оплата → подпись (по умолчанию «Заказать»)', () => {
    expect(labelFromStatus('ordered', true)).toBe('💰 Оплачено');
    expect(labelFromStatus('ordered', false)).toBe('⚙️ В работе');
    expect(labelFromStatus(undefined)).toBe('✅ Заказать');
  });
  it('приоритет туда и обратно', () => {
    expect(priorityFromLabel('Срочно')).toBe('urgent');
    expect(priorityFromLabel('Низко')).toBe('low');
    expect(priorityFromLabel('Обычный')).toBe('normal');
    expect(priorityFromLabel(' ')).toBeUndefined();
    expect(labelFromPriority('urgent')).toBe('Срочно');
    expect(labelFromPriority(undefined)).toBe('Обычный');
  });
});

describe('SupplyService', () => {
  let colls: Record<string, Array<Record<string, unknown>>>;
  let model: { find: jest.Mock; findOne: jest.Mock; findById: jest.Mock; countDocuments: jest.Mock; aggregate: jest.Mock; create: jest.Mock; updateOne: jest.Mock; distinct: jest.Mock };
  let stock: { adoptArticle: jest.Mock; move: jest.Mock; createItem: jest.Mock };
  let service: SupplyService;
  /** Текущая заявка (для findOne/findById по _id), последняя по номеру, дубль по clientUid. */
  let current: Record<string, unknown> | null;
  let last: Record<string, unknown> | null;
  let dup: Record<string, unknown> | null;

  const reqDoc = (extra: Record<string, unknown> = {}) => ({ _id: new Types.ObjectId(), title: 'Болт М10', qty: 10, status: 'requested', paid: false, ...extra });
  const setOf = (call = 0) => model.updateOne.mock.calls[call][1].$set;

  beforeEach(() => {
    colls = {};
    current = null;
    last = null;
    dup = null;
    const collection = (name: string) => ({
      find: jest.fn(() => ({ toArray: async () => colls[name] ?? [], sort: () => ({ toArray: async () => colls[name] ?? [] }) })),
      findOne: jest.fn(async () => (colls[name] ?? [])[0] ?? null),
      countDocuments: jest.fn(async () => (colls[name] ?? []).length),
    });
    const connection = { db: { collection: jest.fn(collection) } };
    model = {
      find: jest.fn(() => chain([])),
      findOne: jest.fn((f: Record<string, unknown>) => chain(f.clientUid ? dup : f.num ? last : current)),
      findById: jest.fn(() => chain(current)),
      countDocuments: jest.fn(() => chain(0)),
      aggregate: jest.fn(() => chain([])),
      create: jest.fn(async (d: Record<string, unknown>) => { current = { _id: new Types.ObjectId(), ...d }; return current; }),
      updateOne: jest.fn(() => chain({ matchedCount: 1 })),
      distinct: jest.fn(() => chain([])),
    };
    stock = {
      adoptArticle: jest.fn(async () => undefined),
      move: jest.fn(async () => ({})),
      createItem: jest.fn(async () => ({ id: String(new Types.ObjectId()) })),
    };
    service = new SupplyService(connection as never, model as never, stock as never);
  });

  describe('create', () => {
    it('без наименования и без позиции склада → BadRequest', async () => {
      await expect(service.create({ qty: 1 })).rejects.toThrow('Укажите наименование');
      await expect(service.create({ title: '  ' })).rejects.toThrow(BadRequestException);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('с позицией склада наименование не обязательно', async () => {
      await service.create({ materialId: String(new Types.ObjectId()) });
      expect(model.create).toHaveBeenCalledTimes(1);
    });

    it('значения по умолчанию и номер = последний + 1', async () => {
      last = { num: 41 };
      await service.create({ title: 'Болт' });
      const arg = model.create.mock.calls[0][0];
      expect(arg).toMatchObject({ title: 'Болт', status: 'requested', priority: 'normal', qty: 1, paid: false, num: 42 });
      expect(arg.requestDate).toBeInstanceOf(Date);
    });

    it('первая заявка получает номер 1; заданный номер не меняется', async () => {
      await service.create({ title: 'А' });
      expect(model.create.mock.calls[0][0].num).toBe(1);
      await service.create({ title: 'Б', num: 500 });
      expect(model.create.mock.calls[1][0].num).toBe(500);
    });

    it('clientUid уже есть — возвращает существующую заявку без создания', async () => {
      const id = new Types.ObjectId();
      dup = { _id: id, title: 'Дубль' };
      current = dup;
      const res = await service.create({ title: 'Дубль', clientUid: 'u1' });
      expect(model.create).not.toHaveBeenCalled();
      expect(res.id).toBe(String(id));
    });

    it('«Получено» при создании запрещено', async () => {
      await expect(service.create({ title: 'X', statusLabel: '☑️ Получено' })).rejects.toThrow(/Принять/);
      expect(model.create).not.toHaveBeenCalled();
    });

    it('«Оплачено» → status ordered, paid, paidAt', async () => {
      await service.create({ title: 'X', statusLabel: '💰 Оплачено' });
      const arg = model.create.mock.calls[0][0];
      expect(arg).toMatchObject({ status: 'ordered', paid: true });
      expect(arg.paidAt).toBeInstanceOf(Date);
    });

    it('приоритет по подписи', async () => {
      await service.create({ title: 'X', priorityLabel: 'Срочно' });
      expect(model.create.mock.calls[0][0].priority).toBe('urgent');
    });

    it('неверная дата счёта → BadRequest', async () => {
      await expect(service.create({ title: 'X', invoiceDate: 'abc' })).rejects.toThrow(/Дата счёта/);
    });

    it('тип счёта кладётся в sheetExtra, а не в корень', async () => {
      await service.create({ title: 'X', invoiceType: 'УПД' });
      const arg = model.create.mock.calls[0][0];
      expect(arg.sheetExtra).toEqual({ invoiceType: 'УПД' });
      expect(Object.keys(arg)).not.toContain('sheetExtra.invoiceType');
    });

    it('заказ заказчика не найден → BadRequest', async () => {
      await expect(service.create({ title: 'X', salesOrderId: String(new Types.ObjectId()) })).rejects.toThrow('Заказ не найден');
    });

    it('привязка к заказу пишет подпись заказа в orderLabel', async () => {
      const so = new Types.ObjectId();
      colls.salesorders = [{ _id: so, orderNo: '15', customer: 'ООО Ромашка' }];
      await service.create({ title: 'X', salesOrderId: String(so) });
      expect(model.create.mock.calls[0][0]).toMatchObject({ salesOrderId: so, orderLabel: 'Заказ № 15 · ООО Ромашка' });
    });

    it('поставщик берётся из существующей организации', async () => {
      const org = new Types.ObjectId();
      colls.organizations = [{ _id: org, name: 'ООО Метиз', type: ['supplier'] }];
      await service.create({ title: 'X', supplierName: 'ООО Метиз' });
      expect(model.create.mock.calls[0][0].supplierId).toEqual(org);
    });

    it('артикул заявки уходит на склад (adoptArticle) только при материале и артикуле', async () => {
      const mid = new Types.ObjectId();
      await service.create({ title: 'X', materialId: String(mid), article: 'A-1' });
      expect(stock.adoptArticle).toHaveBeenCalledWith(mid, 'A-1', expect.stringContaining('заявка'));
      stock.adoptArticle.mockClear();
      await service.create({ title: 'Y', article: 'A-2' });
      expect(stock.adoptArticle).not.toHaveBeenCalled();
    });

    it('фото, которых нет в базе → NotFound', async () => {
      colls.photos = [];
      await expect(service.create({ title: 'X', photoIds: [String(new Types.ObjectId())] })).rejects.toThrow('Фото не найдено');
    });

    it('пишет автора при валидном userId', async () => {
      const uid = String(new Types.ObjectId());
      await service.create({ title: 'X' }, uid);
      expect(model.create.mock.calls[0][0].createdBy).toEqual(new Types.ObjectId(uid));
    });
  });

  describe('update', () => {
    it('мусорный id → BadRequest', async () => {
      await expect(service.update('abc', { title: 'X' })).rejects.toThrow(BadRequestException);
    });

    it('заявка не найдена → NotFound', async () => {
      model.updateOne.mockReturnValue(chain({ matchedCount: 0 }));
      await expect(service.update(String(new Types.ObjectId()), { title: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('ставит editedInApp и меняет поля', async () => {
      current = reqDoc();
      await service.update(String(current._id), { title: '  Гайка ', qty: 5 });
      expect(setOf()).toMatchObject({ title: 'Гайка', qty: 5, editedInApp: true });
    });

    it('пустой текст очищает поле ($unset)', async () => {
      current = reqDoc();
      await service.update(String(current._id), { notes: '' });
      expect(model.updateOne.mock.calls[0][1].$unset).toHaveProperty('notes');
    });

    it('priceHint: null — сумма стирается (null, а не 0)', async () => {
      current = reqDoc();
      await service.update(String(current._id), { priceHint: null as never });
      expect(setOf().priceHint).toBeNull();
    });

    it('«Получено» через правку запрещено, если ещё не получена', async () => {
      current = reqDoc({ status: 'ordered' });
      await expect(service.update(String(current._id), { statusLabel: '☑️ Получено' })).rejects.toThrow(/Принять/);
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('уже полученная заявка может сохранять статус «Получено»', async () => {
      current = reqDoc({ status: 'received' });
      await service.update(String(current._id), { statusLabel: '☑️ Получено', notes: 'ок' });
      expect(model.updateOne).toHaveBeenCalledTimes(1);
    });

    it('снятие оплаты убирает paidAt', async () => {
      current = reqDoc({ status: 'ordered', paid: true });
      await service.update(String(current._id), { statusLabel: '⚙️ В работе' });
      expect(setOf()).toMatchObject({ status: 'ordered', paid: false });
      expect(model.updateOne.mock.calls[0][1].$unset).toHaveProperty('paidAt');
    });

    it('оплата ставит paid и paidAt', async () => {
      current = reqDoc({ status: 'requested' });
      await service.update(String(current._id), { statusLabel: '💰 Оплачено' });
      expect(setOf()).toMatchObject({ status: 'ordered', paid: true });
      expect(setOf().paidAt).toBeInstanceOf(Date);
    });

    it('invoiceDate: пустая строка очищает дату', async () => {
      current = reqDoc();
      await service.update(String(current._id), { invoiceDate: '' });
      expect(model.updateOne.mock.calls[0][1].$unset).toHaveProperty('invoiceDate');
    });

    it('замена фото пишется отдельным запросом с strict:false', async () => {
      const pid = new Types.ObjectId();
      colls.photos = [{ _id: pid }];
      current = reqDoc();
      await service.update(String(current._id), { photoIds: [String(pid)] });
      const photoCall = model.updateOne.mock.calls.find((c) => c[1].$set?.photoIds);
      expect(photoCall?.[2]).toEqual({ strict: false });
    });
  });

  describe('remove / restore', () => {
    it('remove: мягкое удаление с editedInApp', async () => {
      const id = String(new Types.ObjectId());
      await expect(service.remove(id)).resolves.toEqual({ id, deleted: true });
      expect(setOf().deletedAt).toBeInstanceOf(Date);
      expect(setOf().editedInApp).toBe(true);
    });

    it('remove несуществующей → NotFound', async () => {
      model.updateOne.mockReturnValue(chain({ matchedCount: 0 }));
      await expect(service.remove(String(new Types.ObjectId()))).rejects.toThrow(NotFoundException);
    });

    it('remove: мусорный id → BadRequest', async () => {
      await expect(service.remove('x')).rejects.toThrow(BadRequestException);
    });

    it('restore обнуляет deletedAt и возвращает заявку', async () => {
      const id = new Types.ObjectId();
      current = reqDoc({ _id: id });
      const res = await service.restore(String(id));
      expect(setOf()).toEqual({ deletedAt: null, editedInApp: true });
      expect(res.id).toBe(String(id));
    });

    it('restore не из корзины → NotFound', async () => {
      model.updateOne.mockReturnValue(chain({ matchedCount: 0 }));
      await expect(service.restore(String(new Types.ObjectId()))).rejects.toThrow('Заявки нет в корзине');
    });
  });

  describe('get / list', () => {
    it('get несуществующей → NotFound', async () => {
      await expect(service.get(String(new Types.ObjectId()))).rejects.toThrow(NotFoundException);
    });

    it('get: подписи статуса и приоритета, названия поставщика и компании', async () => {
      const sup = new Types.ObjectId(), own = new Types.ObjectId();
      colls.organizations = [{ _id: sup, name: 'ООО Метиз' }, { _id: own, name: 'Наша', shortName: 'НК' }];
      current = reqDoc({ status: 'ordered', paid: true, priority: 'urgent', supplierId: sup, companyId: own, sheetExtra: { invoiceType: 'УПД' } });
      const r = await service.get(String(current._id));
      expect(r).toMatchObject({ statusLabel: '💰 Оплачено', priorityLabel: 'Срочно', invoiceType: 'УПД', photos: [], photo: null, materialPhoto: null });
      expect(r.id).toBe(String(current._id));
    });

    it('list: форма ответа {items,total,page,limit,sum,counts}', async () => {
      model.find.mockReturnValue(chain([reqDoc()]));
      model.countDocuments.mockReturnValue(chain(7));
      model.aggregate
        .mockReturnValueOnce(chain([{ _id: null, sum: 1234 }]))
        .mockReturnValueOnce(chain([
          { _id: { s: 'requested', p: false }, n: 3 },
          { _id: { s: 'ordered', p: true }, n: 2 },
          { _id: { s: 'ordered', p: false }, n: 1 },
        ]));
      const r = await service.list({ page: 2, limit: 5 });
      expect(r).toMatchObject({ total: 7, page: 2, limit: 5, sum: 1234 });
      expect(r.items).toHaveLength(1);
      expect(r.counts).toEqual({ all: 6, requested: 3, paid: 2, ordered: 1 });
    });

    it('list: по умолчанию лимит 1000, нет суммы → 0', async () => {
      const r = await service.list();
      expect(r).toMatchObject({ page: 1, limit: 1000, sum: 0, counts: { all: 0 } });
    });

    it('list: корзина и обычный режим', async () => {
      await service.list({});
      expect(model.find.mock.calls[0][0].deletedAt).toBeNull();
      await service.list({ deleted: '1' });
      expect(model.find.mock.calls[1][0].deletedAt).toEqual({ $ne: null });
    });

    it('list: статусы через запятую; «paid» и «ordered» различаются', async () => {
      await service.list({ status: 'paid,ordered,cancelled' });
      const f = model.find.mock.calls[0][0];
      expect(f.$and[0].$or).toEqual([
        { status: 'ordered', paid: true },
        { status: 'ordered', paid: { $ne: true } },
        { status: 'cancelled' },
      ]);
    });

    it('list: счётчики считаются без фильтра по статусу', async () => {
      await service.list({ status: 'paid' });
      const countsMatch = model.aggregate.mock.calls[1][0][0].$match;
      expect(countsMatch.$and).toBeUndefined();
    });

    it('list: период по requestDate', async () => {
      await service.list({ from: '2026-01-01', to: '2026-01-31' });
      const f = model.find.mock.calls[0][0];
      expect(f.requestDate.$gte).toEqual(new Date(Date.UTC(2026, 0, 1)));
      expect(f.requestDate.$lt).toEqual(new Date(Date.UTC(2026, 1, 1)));
    });

    it('list: поиск — каждое слово отдельным условием И', async () => {
      await service.list({ search: 'болт м10' });
      const f = model.find.mock.calls[0][0];
      expect(f.$and).toHaveLength(2);
      expect(f.$and[0].$or.length).toBeGreaterThanOrEqual(7);
    });

    it('list: поиск по номеру добавляет условие num', async () => {
      await service.list({ search: '№42' });
      const or = model.find.mock.calls[0][0].$and[0].$or as Array<Record<string, unknown>>;
      expect(or).toContainEqual({ num: 42 });
    });

    it('list: сортировка по умолчанию -requestDate, запасной порядок по num и _id', async () => {
      await service.list({});
      const sortArg = (model.find.mock.results[0].value as ReturnType<typeof chain>).sort.mock.calls[0][0];
      expect(Object.keys(sortArg)).toEqual(['requestDate', 'num', '_id']);
      expect(sortArg.requestDate).toBe(-1);
    });

    it('list: нельзя сортировать по постороннему полю', async () => {
      await expect(service.list({ sort: 'secret' })).rejects.toThrow(BadRequestException);
    });

    it('list: needsFill исключает отменённые и ищет наши компании', async () => {
      colls.organizations = [{ _id: new Types.ObjectId(), isOurCompany: true }];
      await service.list({ needsFill: '1' });
      const f = model.find.mock.calls[0][0];
      expect(f.$and).toContainEqual({ status: { $ne: 'cancelled' } });
    });
  });

  describe('receive', () => {
    it('мусорный id → BadRequest', async () => {
      await expect(service.receive('x', {})).rejects.toThrow(BadRequestException);
    });

    it('заявка не найдена → NotFound', async () => {
      await expect(service.receive(String(new Types.ObjectId()), {})).rejects.toThrow(NotFoundException);
    });

    it('уже получена → Conflict', async () => {
      current = reqDoc({ status: 'received' });
      await expect(service.receive(String(current._id), {})).rejects.toThrow(ConflictException);
    });

    it('повтор с тем же clientUid идемпотентен — возвращает заявку', async () => {
      current = reqDoc({ status: 'received', receiveUid: 'r1' });
      const res = await service.receive(String(current._id), { clientUid: 'r1' });
      expect(res.id).toBe(String(current._id));
      expect(stock.move).not.toHaveBeenCalled();
    });

    it('нулевое количество → BadRequest', async () => {
      current = reqDoc({ qty: 0 });
      await expect(service.receive(String(current._id), {})).rejects.toThrow('Укажите количество');
    });

    it('приход на склад по материалу заявки + статус received', async () => {
      const mid = new Types.ObjectId();
      current = reqDoc({ materialId: mid, num: 9 });
      await service.receive(String(current._id), { clientUid: 'r2' }, 'user1');
      expect(stock.createItem).not.toHaveBeenCalled();
      expect(stock.move).toHaveBeenCalledWith(String(mid), expect.objectContaining({ type: 'in', qty: 10, documentRef: `SupplyRequest:${current._id}`, clientUid: 'r2' }), 'user1');
      expect(setOf()).toMatchObject({ status: 'received', receivedQty: 10, receivedTo: 'stock', costCenter: 'workshop', receiveUid: 'r2', editedInApp: true });
    });

    it('нет материала — заводит позицию склада по наименованию', async () => {
      const newId = String(new Types.ObjectId());
      stock.createItem.mockResolvedValue({ id: newId });
      current = reqDoc({ unit: 'шт', article: 'A-7' });
      await service.receive(String(current._id), { qty: 4 });
      expect(stock.createItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'Болт М10', unit: 'шт', article: 'A-7' }));
      expect(stock.move).toHaveBeenCalledWith(newId, expect.objectContaining({ qty: 4 }), undefined);
      expect(setOf().materialId).toEqual(new Types.ObjectId(newId));
      expect(stock.adoptArticle).toHaveBeenCalled();
    });

    it('нет материала и нет наименования → BadRequest', async () => {
      current = reqDoc({ title: '  ' });
      await expect(service.receive(String(current._id), {})).rejects.toThrow('У заявки нет наименования');
    });

    it('центр затрат: по умолчанию workshop, с заказом — order, явный важнее', async () => {
      const mid = new Types.ObjectId();
      current = reqDoc({ materialId: mid, salesOrderId: new Types.ObjectId() });
      await service.receive(String(current._id), {});
      expect(setOf(0).costCenter).toBe('order');
      current = reqDoc({ materialId: mid });
      await service.receive(String(current._id), { costCenter: 'office', costObject: ' Склад 2 ' });
      expect(setOf(1)).toMatchObject({ costCenter: 'office', costObject: 'Склад 2' });
    });

    it('toStock=false — без прихода на склад, пометка direct', async () => {
      current = reqDoc();
      await service.receive(String(current._id), { toStock: false });
      expect(stock.move).not.toHaveBeenCalled();
      expect(stock.createItem).not.toHaveBeenCalled();
      expect(setOf()).toMatchObject({ status: 'received', receivedTo: 'direct', receivedQty: 10 });
    });

    it('частичный приход: заявка остаётся открытой на остаток', async () => {
      const mid = new Types.ObjectId();
      current = reqDoc({ materialId: mid, qty: 10, receivedQty: 2 });
      await service.receive(String(current._id), { qty: 3, partial: true });
      expect(stock.move).toHaveBeenCalledWith(String(mid), expect.objectContaining({ qty: 3, note: expect.stringContaining('(часть)') }), undefined);
      const set = setOf();
      expect(set).toMatchObject({ qty: 7, receivedQty: 5 });
      expect(set).not.toHaveProperty('status');
    });

    it('partial при qty равном остатку — полный приход', async () => {
      current = reqDoc({ materialId: new Types.ObjectId(), qty: 10 });
      await service.receive(String(current._id), { qty: 10, partial: true });
      expect(setOf().status).toBe('received');
    });
  });
});
