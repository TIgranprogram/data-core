import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DesignService } from './design.service';

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
  aggregate = () => this.chain(() => {
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
  updateOne = (f: Row, u: Row) => this.chain(() => {
    const row = this.rows.find((d) => match(d, f));
    if (!row) return { matchedCount: 0 };
    for (const [k, v] of Object.entries(u.$set ?? {})) {
      if (k.includes('.')) { const [a, b] = k.split('.'); row[a] = { ...(row[a] ?? {}), [b]: v }; } else row[k] = v;
    }
    for (const k of Object.keys(u.$unset ?? {})) {
      if (k.includes('.')) { const [a, b] = k.split('.'); if (row[a]) delete row[a][b]; } else delete row[k];
    }
    return { matchedCount: 1 };
  });
}

describe('DesignService', () => {
  let tasks: Coll, orders: Coll, incomes: Coll, persons: Coll, products: Coll, photos: Coll;
  let service: DesignService;
  let seq: number;
  const id = () => new Types.ObjectId();
  let orderId: Types.ObjectId, prodId: Types.ObjectId, personId: Types.ObjectId, line1: Types.ObjectId, line2: Types.ObjectId;

  beforeEach(() => {
    [tasks, orders, incomes, persons, products, photos] = [new Coll(), new Coll(), new Coll(), new Coll(), new Coll(), new Coll()];
    tasks.uniqueSparse = 'openIncomeId';
    seq = 0;
    const by: Record<string, Coll> = { salesorders: orders, incomes, persons, products, photos };
    const connection = { db: { collection: (n: string) => by[n] } };
    const counters = { nextSeq: jest.fn(async () => ++seq) };
    service = new DesignService(connection as never, tasks as never, counters as never);
    orderId = id(); prodId = id(); personId = id(); line1 = id(); line2 = id();
    orders.rows.push({ _id: orderId, orderNo: '20-26', deletedAt: null, shipDate: new Date('2026-12-20'), productionDeadline: new Date('2026-12-01'), priority: 'urgent' });
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
    expect(r.items.map((i) => i.title)).toEqual(['Чертежи 3410 ЗНП 20-26 поз 7', 'Урна']);
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
    expect(all.counts).toEqual({ queue: 1, work: 0, done: 1, paused: 0, all: 2 });
    expect((await service.list({ status: 'queue' })).items.map((i) => i.title)).toEqual(['Два']);
    await expect(service.list({ status: 'xx' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
