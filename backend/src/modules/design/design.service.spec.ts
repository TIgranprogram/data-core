import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DesignBoardController } from './design-board.controller';
import { DesignController } from './design.controller';
import { DesignStickerController } from './design-sticker.controller';
import { DesignBoardService } from './design-board.service';
import { DesignService } from './design.service';
import { DesignStickerService } from './design-sticker.service';
import { DesignExtrasService } from './design-extras.service';
import { APP_SECTION_KEY } from '../../common/decorators/app-section.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const same = (a: unknown, b: unknown) => String(a) === String(b);

/** Мини-фильтр: равенство (null = нет значения), $ne, $in, $or — этого хватает сервису. */
function match(d: Row, f: Row): boolean {
  return Object.entries(f).every(([k, v]) => {
    if (k === '$or') return (v as Row[]).some((x) => match(d, x));
    const cur = d[k];
    if (v && typeof v === 'object' && !(v instanceof Types.ObjectId) && !(v instanceof Date) && !(v instanceof RegExp)) {
      if ('$ne' in v) return v.$ne === null ? cur != null : !same(cur, v.$ne);
      if ('$in' in v) return (v.$in as unknown[]).some((x) => same(x, cur));
    }
    if (v === null) return cur == null;
    if (v instanceof RegExp) return v.test(String(cur ?? ''));
    return same(cur, v);
  });
}

/** Коллекция в памяти: и «модель» Mongoose (цепочки), и сырая коллекция драйвера. */
class Coll {
  rows: Row[] = [];
  uniqueSparse?: string;
  private chain(result: () => unknown) {
    const c: Row = {};
    for (const m of ['sort', 'skip', 'limit', 'lean', 'setOptions']) c[m] = () => c;
    c.exec = async () => result();
    c.toArray = async () => result();
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return c;
  }
  find = (f: Row = {}) => this.chain(() => this.rows.filter((d) => match(d, f)));
  findOne = (f: Row = {}) => this.chain(() => this.rows.find((d) => match(d, f)) ?? null);
  countDocuments = (f: Row = {}) => this.chain(() => this.rows.filter((d) => match(d, f)).length);
  aggregate = (pipe: Row[] = []) => this.chain(() => {
    const grp = pipe.find((x) => x.$group)?.$group as Row | undefined;
    const idKey = grp?._id;
    if (typeof idKey === 'string' && idKey !== '$status') { // incomes: число строк по полю
      const k = idKey.slice(1), g = new Map<string, number>();
      for (const r of this.rows.filter((x) => x.deletedAt == null)) g.set(String(r[k]), (g.get(String(r[k])) ?? 0) + 1);
      return [...g].map(([_id, n]) => ({ _id: this.rows.find((r) => String(r[k]) === _id)![k], n }));
    }
    if (idKey && typeof idKey === 'object') { // задачи: по заказу и статусу + затронутые позиции
      const g = new Map<string, Row>();
      for (const r of this.rows.filter((x) => x.deletedAt == null && x.orderId != null)) {
        const key = String(r.orderId) + '|' + r.status;
        const e = g.get(key) ?? { _id: { orderId: r.orderId, status: r.status }, n: 0, lines: [] };
        e.n++; if (r.incomeId && !e.lines.some((l: unknown) => same(l, r.incomeId))) e.lines.push(r.incomeId);
        g.set(key, e);
      }
      return [...g.values()];
    }
    const g: Record<string, number> = {};
    for (const r of this.rows.filter((x) => x.deletedAt == null)) g[r.status] = (g[r.status] ?? 0) + 1;
    return Object.entries(g).map(([_id, n]) => ({ _id, n }));
  });
  async create(d: Row) {
    const u = this.uniqueSparse;
    if (u && d[u] && this.rows.some((r) => same(r[u], d[u]))) throw Object.assign(new Error('E11000'), { code: 11000 });
    const row = { _id: new Types.ObjectId(), deletedAt: null, createdAt: new Date(), ...d };
    this.rows.push(row);
    return { ...row, toObject: () => row };
  }
  distinct = async (k: string, f: Row) => [...new Set(this.rows.filter((d) => match(d, f)).map((d) => d[k]))];
  failUpdate = false;
  updateOne = (f: Row, u: Row, o: Row = {}) => this.chain(() => {
    if (this.failUpdate) throw new Error('mongo недоступен');
    const row = this.rows.find((d) => match(d, f));
    if (!row && o.upsert) { this.rows.push({ _id: new Types.ObjectId(), ...f, ...(u.$setOnInsert ?? {}), ...(u.$set ?? {}) }); return { upsertedCount: 1 }; }
    if (!row) return { matchedCount: 0 };
    for (const [k, v] of Object.entries(u.$set ?? {})) {
      if (k.includes('.')) { const [a, b] = k.split('.'); row[a] = { ...(row[a] ?? {}), [b]: v }; } else row[k] = v;
    }
    for (const [k, v] of Object.entries(u.$addToSet ?? {})) if (!(row[k] ?? []).some((x: unknown) => same(x, v))) row[k] = [...(row[k] ?? []), v];
    for (const [k, v] of Object.entries(u.$pull ?? {})) row[k] = (row[k] ?? []).filter((x: unknown) => !same(x, v));
    for (const k of Object.keys(u.$unset ?? {})) {
      if (k.includes('.')) { const [a, b] = k.split('.'); if (row[a]) delete row[a][b]; } else delete row[k];
    }
    return { matchedCount: 1 };
  });
}

describe('DesignService', () => {
  let tasks: Coll, orders: Coll, incomes: Coll, persons: Coll, products: Coll, photos: Coll, marks: Coll, stickers: Coll;
  let service: DesignService, board: DesignBoardService, stickerSvc: DesignStickerService, extras: DesignExtrasService;
  let seq: number;
  const id = () => new Types.ObjectId();
  let orderId: Types.ObjectId, prodId: Types.ObjectId, personId: Types.ObjectId, line1: Types.ObjectId, line2: Types.ObjectId;

  beforeEach(() => {
    [tasks, orders, incomes, persons, products, photos, marks, stickers] = [new Coll(), new Coll(), new Coll(), new Coll(), new Coll(), new Coll(), new Coll(), new Coll()];
    tasks.uniqueSparse = 'openIncomeId';
    seq = 0;
    const by: Record<string, Coll> = { salesorders: orders, incomes, persons, products, photos, designnotes: new Coll() };
    const connection = { db: { collection: (n: string) => by[n] } };
    const counters = { nextSeq: jest.fn(async () => ++seq) };
    service = new DesignService(connection as never, tasks as never, counters as never, marks as never, { safe: async () => true } as never, { recheck: async () => undefined } as never);
    stickerSvc = new DesignStickerService(stickers as never);
    board = new DesignBoardService(connection as never, tasks as never, marks as never, service, stickerSvc);
    extras = new DesignExtrasService(connection as never, tasks as never, stickerSvc);
    orderId = id(); prodId = id(); personId = id(); line1 = id(); line2 = id();
    orders.rows.push({ _id: orderId, orderNo: '109-П', productionNo: '20-26', deletedAt: null, shipDate: new Date('2026-12-20'), productionDeadline: new Date('2026-12-01'), priority: 'urgent' });
    products.rows.push({ _id: prodId, name: 'Скамья', sku: '3410', photoIds: [], deletedAt: null });
    persons.rows.push({ _id: personId, lastName: 'Иванов', firstName: 'Пётр', deletedAt: null });
    incomes.rows.push(
      { _id: line1, orderId, lineNo: 7, title: 'Скамья парковая Цвет: графит', productId: prodId, amount: 5000, deletedAt: null },
      { _id: line2, orderId, lineNo: 8, title: 'Урна. Цвет: чёрный', deletedAt: null },
    );
  });

  it('«в работе» без исполнителя и «приостановлена» без причины — 400', async () => {
    await expect(service.create({ title: 'Свободная', status: 'work' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create({ title: 'Свободная', status: 'paused' })).rejects.toBeInstanceOf(BadRequestException);
    const t = await service.create({ title: 'Свободная' });
    await expect(service.update(t.id, { status: 'work' })).rejects.toThrow('Назначьте исполнителя');
    await expect(service.update(t.id, { status: 'paused', pauseReason: '  ' })).rejects.toThrow('причину');
    const w = await service.update(t.id, { status: 'work', assigneeId: String(personId) });
    expect(w).toMatchObject({ status: 'work', assignee: { name: 'Иванов Пётр', initials: 'ИП' } });
  });

  it('свободная задача: нужно название; свои срок и приоритет; ответ без цен', async () => {
    await expect(service.create({})).rejects.toBeInstanceOf(BadRequestException);
    const t = await service.create({ title: 'Эскиз стенда', deadline: '15.11.2026', priority: 'high' });
    expect(t).toMatchObject({ code: 'D-1', title: 'Эскиз стенда', priority: 'high', priorityFromOrder: false, deadlineFromOrder: false, orderId: null });
    expect(String(t.deadline).length).toBeGreaterThan(0);
    expect(JSON.stringify(t)).not.toMatch(/amount|price|sum/i);
  });

  it('from-order: задача на позицию, повтор — 0 новых; срок (изготовление → отгрузка) и приоритет из заказа', async () => {
    const r = await service.fromOrder({ orderId: String(orderId) });
    expect(r).toMatchObject({ created: 2, skipped: 0 });
    expect(r.items.map((i) => i.title)).toEqual(['Чертежи 3410 № 20-26 поз 7', 'Урна']);
    expect(r.items[0]).toMatchObject({ priority: 'urgent', priorityFromOrder: true, deadlineFromOrder: true, sku: '3410', productName: 'Скамья', lineNo: 7 });
    expect(r.items[0].deadline).toEqual(new Date('2026-12-01'));
    expect(await service.fromOrder({ orderId: String(orderId) })).toMatchObject({ created: 0, skipped: 2, items: [] });
    expect(tasks.rows).toHaveLength(2);
    // выбранные позиции; чужая позиция — 400
    await expect(service.fromOrder({ orderId: String(orderId), lineIds: [String(id())] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('срок и приоритет заказа меняются — задача видит новые, пока их не правили вручную', async () => {
    const [t] = (await service.fromOrder({ orderId: String(orderId) })).items;
    orders.rows[0].productionDeadline = undefined; orders.rows[0].priority = 'low';
    expect(await service.get(t.id)).toMatchObject({ priority: 'low', deadline: new Date('2026-12-20') });
    const m = await service.update(t.id, { priority: 'high', deadline: '01.01.2027' });
    expect(m).toMatchObject({ priority: 'high', priorityFromOrder: false, deadlineFromOrder: false });
    const back = await service.update(t.id, { priority: '', deadline: '' });
    expect(back).toMatchObject({ priority: 'low', priorityFromOrder: true });
  });

  it('вторая открытая задача на позицию — 409; после «Завершено» можно новую', async () => {
    const a = await service.create({ incomeId: String(line1) });
    await expect(service.create({ incomeId: String(line1) })).rejects.toBeInstanceOf(ConflictException);
    await service.update(a.id, { status: 'done' });
    const b = await service.create({ incomeId: String(line1) });
    expect(b.code).toBe('D-2');
    // вернуть завершённую в работу, пока есть открытая, нельзя
    await expect(service.update(a.id, { status: 'queue' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('свободную задачу можно привязать к позиции: заказ и замок встают; занятая позиция и смена привязки — отказ', async () => {
    const free = await service.create({ title: 'Из YouGile', note: 'YouGile D-9' });
    const busy = await service.create({ incomeId: String(line2) });
    await expect(service.update(free.id, { incomeId: String(line2) })).rejects.toBeInstanceOf(ConflictException);
    const linked = await service.update(free.id, { incomeId: String(line1) });
    expect(linked).toMatchObject({ incomeId: String(line1), orderId: String(orderId) });
    await expect(service.create({ incomeId: String(line1) })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.update(free.id, { incomeId: String(line2) })).rejects.toThrow('менять нельзя');
    expect(busy.incomeId).toBe(String(line2));
  });

  it('done: completedAt; пустой designerId изделия получает исполнителя, заполненный — не меняется', async () => {
    const a = await service.create({ incomeId: String(line1), assigneeId: String(personId), status: 'work' });
    const done = await service.update(a.id, { status: 'done' });
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(String(products.rows[0].designerId)).toBe(String(personId));

    const other = id();
    products.rows[0].designerId = other;
    const b = await service.create({ incomeId: String(line1), assigneeId: String(personId) });
    await service.update(b.id, { status: 'done' });
    expect(String(products.rows[0].designerId)).toBe(String(other));
  });

  it('D-N не повторяется после удаления; восстановление возвращает замок позиции', async () => {
    const a = await service.create({ incomeId: String(line1) });
    await service.remove(a.id);
    const b = await service.create({ incomeId: String(line1) });
    expect(b.code).toBe('D-2');
    await expect(service.restore(a.id)).rejects.toBeInstanceOf(ConflictException);
    await service.remove(b.id);
    expect((await service.restore(a.id)).code).toBe('D-1');
  });

  it('список: counts по статусам и фильтр по статусу', async () => {
    const a = await service.create({ title: 'Раз' });
    await service.create({ title: 'Два' });
    await service.update(a.id, { status: 'done' });
    const all = await service.list({});
    expect(all.counts).toEqual({ queue: 1, work: 0, done: 1, paused: 0, cancelled: 0, all: 2, needsAnswer: 0 });
    expect((await service.list({ status: 'queue' })).items.map((i) => i.title)).toEqual(['Два']);
    await expect(service.list({ status: 'xx' })).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('доска заказов (designorders)', () => {
    const order2 = () => {
      const o2 = id(); orders.rows.push({ _id: o2, orderNo: '21-26', customer: 'ООО Ромашка', deletedAt: null, stage: 'new' });
      const l = id(); incomes.rows.push({ _id: l, orderId: o2, lineNo: 1, title: 'Лавка', deletedAt: null });
      return { o2, l };
    };

    it('создание задачи по позиции ставит метку заказа; повтор метку не дублирует', async () => {
      await service.create({ incomeId: String(line1) });
      await service.create({ incomeId: String(line2) });
      expect(marks.rows).toHaveLength(1);
      expect(marks.rows[0]).toMatchObject({ deletedAt: null });
      expect(String(marks.rows[0].orderId)).toBe(String(orderId));
    });

    it('сбой метки не ломает создание задачи (необязательный шаг)', async () => {
      marks.failUpdate = true;
      const t = await service.create({ incomeId: String(line1) });
      expect(t.code).toBe('D-1');
      expect(marks.rows).toHaveLength(0);
    });

    it('гонка за позицию: из двух параллельных созданий одно проходит, второе — 409', async () => {
      const r = await Promise.allSettled([service.create({ incomeId: String(line1) }), service.create({ incomeId: String(line1) })]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const bad = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
      expect(bad.reason).toBeInstanceOf(ConflictException);
    });

    it('создать сразу «завершённой» по позиции нельзя — 400', async () => {
      await expect(service.create({ incomeId: String(line1), status: 'done' })).rejects.toThrow('сразу завершённой');
    });

    it('POST: повтор безопасен; distribute создаёт задачи один раз; неизвестный заказ — 404', async () => {
      expect(await board.addOrder({ orderId: String(orderId) })).toEqual({ orderId: String(orderId), created: 0, skipped: 0 });
      await board.addOrder({ orderId: String(orderId) });
      expect(marks.rows).toHaveLength(1);
      expect(await board.addOrder({ orderId: String(orderId), distribute: true })).toEqual({ orderId: String(orderId), created: 2, skipped: 0 });
      expect(await board.addOrder({ orderId: String(orderId), distribute: true })).toEqual({ orderId: String(orderId), created: 0, skipped: 2 });
      expect(tasks.rows).toHaveLength(2);
      expect(marks.rows).toHaveLength(1);
      await expect(board.addOrder({ orderId: String(id()) })).rejects.toThrow('Заказ не найден');
    });

    it('DELETE: с открытыми задачами — 409; без них — метка гаснет, задачи остаются; добавление после этого — та же запись', async () => {
      await board.addOrder({ orderId: String(orderId), distribute: true });
      await expect(board.removeOrder(String(orderId))).rejects.toBeInstanceOf(ConflictException);
      await expect(board.removeOrder(String(orderId))).rejects.toThrow('открытых задач: 2');
      for (const t of tasks.rows) await service.update(String(t._id), { status: 'done' });
      expect(await board.removeOrder(String(orderId))).toEqual({ orderId: String(orderId), removed: true });
      expect(marks.rows[0].deletedAt).toBeInstanceOf(Date);
      expect(tasks.rows).toHaveLength(2);
      expect((await board.board()).orders).toHaveLength(0);
      const addedAt = marks.rows[0].addedAt;
      await board.addOrder({ orderId: String(orderId) }); // upsert после мягкого удаления: без дубля и без 11000
      expect(marks.rows).toHaveLength(1);
      expect(marks.rows[0]).toMatchObject({ deletedAt: null, addedAt });
    });

    it('GET: метки ∪ заказы с открытыми задачами; завершённые без метки и заказы, удалённые в CRM, не показываются; в базу не пишет', async () => {
      const { o2, l } = order2();
      const o3 = id(); orders.rows.push({ _id: o3, orderNo: '22-26', deletedAt: new Date() }); // удалён в CRM
      await board.addOrder({ orderId: String(orderId) });
      // открытая задача в заказе без метки: «подхват»
      tasks.rows.push({ _id: id(), seq: 50, status: 'queue', orderId: o2, incomeId: l, deletedAt: null });
      // открытая задача в удалённом заказе и завершённая в заказе без метки
      tasks.rows.push({ _id: id(), seq: 51, status: 'queue', orderId: o3, incomeId: id(), deletedAt: null });
      const o4 = id(); orders.rows.push({ _id: o4, orderNo: '23-26', deletedAt: null });
      tasks.rows.push({ _id: id(), seq: 52, status: 'done', orderId: o4, incomeId: id(), deletedAt: null });
      tasks.rows.push({ _id: id(), seq: 53, status: 'queue', title: 'Без заказа', deletedAt: null });
      const before = [marks.rows.length, tasks.rows.length, JSON.stringify(marks.rows)];

      const r = await board.board();
      expect(r.orders.map((o) => o.orderNo)).toEqual(['109-П', '21-26']);
      expect(r.ordersTotal).toBe(2);
      expect(r.orders[0]).toMatchObject({ orderId: String(orderId), customer: null, priority: 'urgent', linesCount: 2, counts: { queue: 0, work: 0, paused: 0, done: 0, free: 2 } });
      expect(r.orders[1]).toMatchObject({ orderNo: '21-26', customer: 'ООО Ромашка', addedAt: null, linesCount: 1, counts: { queue: 1, free: 0 } });
      expect(r.tasks.map((t) => t.seq)).toEqual([50, 53]);
      expect(r.tasksTotal).toBe(2);
      expect([marks.rows.length, tasks.rows.length, JSON.stringify(marks.rows)]).toEqual(before); // GET ничего не пишет
      expect(JSON.stringify(r)).not.toMatch(/amount|price|unitPrice|"sum"/i);
    });

    it('/lines: позиции с задачей и без; цен нет; чужой или удалённый заказ — 404', async () => {
      const a = await service.create({ incomeId: String(line1), assigneeId: String(personId), status: 'work' });
      const r = await board.lines(String(orderId));
      expect(r.lines.map((x) => x.lineNo)).toEqual([7, 8]);
      expect(r.lines[0]).toMatchObject({ incomeId: String(line1), sku: '3410', task: { id: a.id, code: 'D-1', status: 'work', assignee: { name: 'Иванов Пётр' } } });
      expect(r.lines[1].task).toBeNull();
      expect(JSON.stringify(r)).not.toMatch(/amount|price|5000/i);
      await expect(board.lines(String(id()))).rejects.toThrow('Заказ не найден');
    });

    it('права: чтение — все четыре роли, запись — admin и manager; раздел «Проектирование»', () => {
      const roles = (m: keyof DesignBoardController) => Reflect.getMetadata(ROLES_KEY, DesignBoardController.prototype[m]);
      expect(Reflect.getMetadata(APP_SECTION_KEY, DesignBoardController)).toEqual(['design']);
      expect(roles('get')).toEqual(['admin', 'director', 'manager', 'user']);
      expect(roles('lines')).toEqual(['admin', 'director', 'manager', 'user']);
      expect(roles('add')).toEqual(['admin', 'manager']);
      expect(roles('remove')).toEqual(['admin', 'manager']);
    });
  });
  describe('фото и стикеры', () => {
    const user = (uid: Types.ObjectId) => ({ id: String(uid), username: 'u', role: 'user' });
    it('сид системных стикеров идемпотентен; скрыть можно, удалить — нет', async () => {
      await stickerSvc.seedSystem(); await stickerSvc.seedSystem();
      const all = await stickerSvc.list();
      expect(all.map((x) => x.key)).toEqual(['assignee', 'deadline', 'priority', 'order', 'product']);
      await stickerSvc.update(all[1].id, { visible: false });
      await stickerSvc.seedSystem(); // скрытый не возвращается
      expect(stickers.rows.find((r) => r.key === 'deadline')!.visible).toBe(false);
      await expect(stickerSvc.remove(all[0].id)).rejects.toThrow('Системный стикер удалить нельзя');
      await expect(stickerSvc.update(all[0].id, { label: 'Другое' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('значения: число и состояние валидируются, пустое — $unset, чужой id и системный — 400', async () => {
      const num = await stickerSvc.create({ kind: 'number', label: 'Часы план', unit: 'ч' });
      const st = await stickerSvc.create({ kind: 'state', label: 'Чертёж', states: [{ label: 'Эскиз', color: '#ffcc00' }, { label: 'Утверждён' }] });
      await stickerSvc.seedSystem();
      const sys = (await stickerSvc.list()).find((x) => x.kind === 'system')!;
      const t = await service.create({ title: 'Свободная' });
      const stateId = st.states![0].id;
      const r = await extras.setStickers(t.id, { [num.id]: '8,5', [st.id]: stateId });
      expect(r.stickers).toEqual({ [num.id]: 8.5, [st.id]: stateId });
      await expect(extras.setStickers(t.id, { [num.id]: 'abc' })).rejects.toThrow('введите число');
      await expect(extras.setStickers(t.id, { [st.id]: 'нет такого' })).rejects.toThrow('выберите состояние');
      await expect(extras.setStickers(t.id, { [sys.id]: 1 })).rejects.toThrow('считается из полей');
      await expect(extras.setStickers(t.id, { '$where.x': 1 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(extras.setStickers(t.id, { [String(id())]: 1 })).rejects.toThrow('Стикер не найден');
      expect((await extras.setStickers(t.id, { [num.id]: null })).stickers).toEqual({ [st.id]: stateId });
      // удалённый стикер: значение остаётся в задаче, но новое записать нельзя
      await stickerSvc.remove(num.id);
      await expect(extras.setStickers(t.id, { [num.id]: 1 })).rejects.toThrow('Стикер не найден');
    });

    it('доска отдаёт видимые стикеры один раз и stickers/photoIds у задач', async () => {
      await stickerSvc.seedSystem();
      const hide = (await stickerSvc.list())[0];
      await stickerSvc.update(hide.id, { visible: false });
      const t = await service.create({ title: 'Эскиз' });
      const ph = { _id: id(), storageUrl: '/uploads/a.jpg' };
      photos.rows.push(ph);
      await extras.addPhoto(t.id, String(ph._id));
      const r = await board.board();
      expect(r.stickers.map((x) => x.key)).toEqual(['deadline', 'priority', 'order', 'product']);
      expect(r.tasks[0]).toMatchObject({ photoIds: [String(ph._id)], stickers: {}, photo: '/uploads/a.jpg' });
    });

    it('фото: нет файла — 404; повтор не дублирует; удаление; user — только ничья или своя задача', async () => {
      const t = await service.create({ title: 'Эскиз' });
      await expect(extras.addPhoto(t.id, String(id()))).rejects.toThrow('Фото не найдено');
      const ph = { _id: id(), storageUrl: '/uploads/b.jpg' };
      photos.rows.push(ph);
      const uid = id();
      await extras.addPhoto(t.id, String(ph._id), user(uid)); // ничья — можно
      expect((await extras.addPhoto(t.id, String(ph._id), user(uid))).photoIds).toHaveLength(1);
      expect((await extras.removePhoto(t.id, String(ph._id), user(uid))).photoIds).toEqual([]);
      const mine = await service.create({ title: 'Чужая', assigneeId: String(personId) });
      await expect(extras.addPhoto(mine.id, String(ph._id), user(uid))).resolves.toBeDefined(); // вход ни с кем не связан — не ограничиваем
      persons.rows.push({ _id: id(), name: 'Другой', userId: uid }); // вход связан с другим сотрудником
      await expect(extras.addPhoto(mine.id, String(ph._id), user(uid))).rejects.toBeInstanceOf(ForbiddenException);
      persons.rows.pop();
      persons.rows[0].userId = uid; // сотрудник привязан к пользователю
      await expect(extras.addPhoto(mine.id, String(ph._id), user(uid))).resolves.toBeDefined();
      await extras.addPhoto(mine.id, String(ph._id), { id: String(id()), username: 'm', role: 'manager' }); // manager — любая
    });

    it('роли: фото и значения — admin/manager/user, настройки стикеров — admin', () => {
      const roles = (c: object, m: string) => Reflect.getMetadata(ROLES_KEY, (c as { prototype: Record<string, object> }).prototype[m]);
      expect(roles(DesignController, 'addPhoto')).toEqual(['admin', 'manager', 'user']);
      expect(roles(DesignController, 'setStickers')).toEqual(['admin', 'manager', 'user']);
      expect(roles(DesignController, 'update')).toEqual(['admin', 'manager']);
      for (const m of ['create', 'update', 'remove']) expect(roles(DesignStickerController, m)).toEqual(['admin']);
    });
  });
});
