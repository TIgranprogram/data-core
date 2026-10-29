import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkRouteService } from './work-route.service';
import { WorkService } from './work.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const same = (a: unknown, b: unknown) => String(a) === String(b);

/** Мини-фильтр: равенство (null = нет значения), $ne, $in, $nin, $gte, $or, $and — этого хватает сервису. */
function match(d: Row, f: Row): boolean {
  return Object.entries(f).every(([k, v]) => {
    if (k === '$or') return (v as Row[]).some((x) => match(d, x));
    if (k === '$and') return (v as Row[]).every((x) => match(d, x));
    const cur = k.includes('.') ? k.split('.').reduce((o: any, p) => (Array.isArray(o) ? o.map((x) => x?.[p]) : o?.[p]), d) : d[k]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const has = (x: unknown) => (Array.isArray(cur) ? cur.some((c) => same(c, x)) : same(cur, x));
    if (v && typeof v === 'object' && !(v instanceof Types.ObjectId) && !(v instanceof Date) && !(v instanceof RegExp)) {
      if ('$ne' in v) return v.$ne === null ? cur != null : !has(v.$ne);
      if ('$in' in v) return (v.$in as unknown[]).some((x) => has(x));
      if ('$nin' in v) return !(v.$nin as unknown[]).some((x) => (x === null ? cur == null : has(x)));
      if ('$gte' in v) return cur != null && +cur >= +v.$gte;
    }
    if (v === null) return cur == null;
    if (v instanceof RegExp) return v.test(String(cur ?? ''));
    return has(v);
  });
}

/** Коллекция в памяти: и «модель» Mongoose (цепочки), и сырая коллекция драйвера. */
class Coll {
  rows: Row[] = [];
  uniqueSparse?: string;
  private chain(result: () => unknown) {
    const c: Row = {};
    for (const m of ['sort', 'skip', 'limit', 'lean', 'setOptions', 'project']) c[m] = () => c;
    c.exec = async () => result();
    c.toArray = async () => result();
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return c;
  }
  find = (f: Row = {}) => this.chain(() => this.rows.filter((d) => match(d, f)));
  findOne = (f: Row = {}) => this.chain(() => this.rows.find((d) => match(d, f)) ?? null);
  countDocuments = (f: Row = {}) => this.chain(() => this.rows.filter((d) => match(d, f)).length);
  aggregate = (pipe: Row[] = []) => this.chain(() => {
    const g = new Map<string, Row>();
    for (const r of this.rows.filter((d) => match(d, pipe[0].$match))) {
      const key = `${r.status}|${r.stepKey}`;
      const e = g.get(key) ?? { _id: { status: r.status, key: r.stepKey }, n: 0 };
      e.n++; g.set(key, e);
    }
    return [...g.values()];
  });
  private lock(row: Row | undefined, value: unknown) {
    const u = this.uniqueSparse;
    if (u && value && this.rows.some((r) => r !== row && same(r[u], value))) throw Object.assign(new Error('E11000'), { code: 11000 });
  }
  async create(d: Row) {
    if (this.uniqueSparse) this.lock(undefined, d[this.uniqueSparse]);
    const row = { _id: new Types.ObjectId(), deletedAt: null, createdAt: new Date(), ...d };
    this.rows.push(row);
    return { ...row, toObject: () => row };
  }
  updateOne = (f: Row, u: Row) => this.chain(() => {
    const row = this.rows.find((d) => match(d, f));
    if (!row) return { matchedCount: 0 };
    if (this.uniqueSparse && u.$set?.[this.uniqueSparse]) this.lock(row, u.$set[this.uniqueSparse]);
    Object.assign(row, u.$set ?? {});
    for (const k of Object.keys(u.$unset ?? {})) delete row[k];
    for (const [k, v] of Object.entries<Row>(u.$push ?? {})) row[k] = [...(row[k] ?? []), ...v.$each].slice(v.$slice);
    return { matchedCount: 1 };
  });
}

describe('WorkService', () => {
  let tasks: Coll, orders: Coll, incomes: Coll, persons: Coll, products: Coll, worktypes: Coll;
  let service: WorkService, routes: WorkRouteService;
  let seq: number;
  const id = () => new Types.ObjectId();
  let orderId: Types.ObjectId, cut: Types.ObjectId, weld: Types.ObjectId, paint: Types.ObjectId, gone: Types.ObjectId;
  let withRoute: Types.ObjectId, noRoute: Types.ObjectId, line1: Types.ObjectId, line2: Types.ObjectId, line3: Types.ObjectId;

  beforeEach(() => {
    [tasks, orders, incomes, persons, products, worktypes] = [new Coll(), new Coll(), new Coll(), new Coll(), new Coll(), new Coll()];
    tasks.uniqueSparse = 'openIncomeId';
    seq = 0;
    const by: Record<string, Coll> = { salesorders: orders, incomes, persons, products, worktypes, photos: new Coll(), productmodules: new Coll(), materials: new Coll() };
    const connection = { db: { collection: (n: string) => by[n] } };
    routes = new WorkRouteService(connection as never);
    service = new WorkService(connection as never, tasks as never, { nextSeq: jest.fn(async () => ++seq) } as never, routes);
    [orderId, cut, weld, paint, gone, withRoute, noRoute, line1, line2, line3] = Array.from({ length: 10 }, id);
    orders.rows.push({ _id: orderId, orderNo: '109-П', deletedAt: null });
    worktypes.rows.push({ _id: cut, name: 'Резка', deletedAt: null }, { _id: weld, name: 'Сварка', deletedAt: null }, { _id: paint, name: 'Покраска', deletedAt: null }, { _id: gone, name: 'Старая', deletedAt: new Date() });
    products.rows.push(
      { _id: withRoute, name: 'Скамья', sku: '3410', deletedAt: null, workTypes: [{ workTypeId: cut }, { workTypeId: gone }, { workTypeId: weld, note: 'MIG' }, { workTypeId: paint }] },
      { _id: noRoute, name: 'Урна', sku: '1200', deletedAt: null },
    );
    incomes.rows.push(
      { _id: line1, orderId, lineNo: 1, title: 'Скамья парковая', productId: withRoute, qty: 10, deletedAt: null },
      { _id: line2, orderId, lineNo: 2, title: 'Урна. Цвет: чёрный', productId: noRoute, deletedAt: null },
      { _id: line3, orderId, lineNo: 3, title: 'Беседка (изделия ещё нет)', deletedAt: null },
    );
  });

  it('запуск: маршрут изделия без удалённых видов работ — карточка на первом шаге', async () => {
    const r = await service.launch({ lineIds: [String(line1)] });
    expect(r).toMatchObject({ created: 1, skipped: 0, refused: [], warnings: [] });
    expect(r.items[0]).toMatchObject({ code: 'W-1', status: 'work', stepIndex: 0, currentStep: 'Резка', generic: false, qty: 10, orderNo: '109-П' });
    expect(r.items[0].route.map((s) => [s.name, s.state])).toEqual([['Резка', 'current'], ['Сварка', 'next'], ['Покраска', 'next']]);
    expect(r.items[0].route[1].note).toBe('MIG');
    expect(tasks.rows[0].openIncomeId).toEqual(line1);
  });

  it('запуск заказа: позиция без изделия не запускается (причина), изделие без маршрута — «Изготовление» с предупреждением', async () => {
    const r = await service.launch({ orderId: String(orderId) });
    expect(r.created).toBe(2);
    expect(r.refused).toEqual([{ incomeId: String(line3), lineNo: 3, title: 'Беседка (изделия ещё нет)', reason: 'Нет изделия — сначала сопоставьте позицию с продукцией' }]);
    const generic = r.items.find((i) => i.incomeId === String(line2))!;
    expect(generic).toMatchObject({ generic: true, currentStep: 'Изготовление', stepKey: 'generic' });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].text).toMatch(/Изготовление/);
  });

  it('повторный запуск — «Уже в работе (W-N)», дублей нет; пустой запрос и чужая позиция — 400', async () => {
    await service.launch({ lineIds: [String(line1)] });
    const again = await service.launch({ orderId: String(orderId), lineIds: [String(line1)] });
    expect(again).toMatchObject({ created: 0, skipped: 1 });
    expect(again.refused[0].reason).toBe('Уже в работе (W-1)');
    expect(tasks.rows).toHaveLength(1);
    await expect(service.launch({})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.launch({ lineIds: [String(id())] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('перевод: следующий, на любой шаг, назад, в «Ждёт запуска»; с последнего шага — «Готово»', async () => {
    const t = (await service.launch({ lineIds: [String(line1)] })).items[0];
    expect(await service.move(t.id, { to: 'next' })).toMatchObject({ stepIndex: 1, currentStep: 'Сварка', status: 'work' });
    expect(await service.move(t.id, { stepIndex: 0 })).toMatchObject({ stepIndex: 0, currentStep: 'Резка' });
    expect(await service.move(t.id, { to: 'waiting' })).toMatchObject({ status: 'waiting', stepIndex: null, currentStep: null, stepKey: '' });
    expect(await service.move(t.id, { to: 'next' })).toMatchObject({ status: 'work', stepIndex: 0 });
    await service.move(t.id, { stepIndex: 2 });
    const done = await service.move(t.id, { to: 'next' });
    expect(done).toMatchObject({ status: 'done', stepIndex: 3, currentStep: null });
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(done.route.every((s) => s.state === 'done')).toBe(true);
    expect(tasks.rows[0].openIncomeId).toBeUndefined();
    expect(tasks.rows[0].moves.length).toBe(7);
    await expect(service.move(t.id, { to: 'next' })).rejects.toThrow('уже готово');
    await expect(service.move(t.id, { stepIndex: 9 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.move(t.id, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('«Готово» закрывает весь маршрут; из готового можно вернуть на шаг, пока позицию не запустили заново', async () => {
    const t = (await service.launch({ lineIds: [String(line1)] })).items[0];
    const done = await service.finish(t.id, String(id()));
    expect(done).toMatchObject({ status: 'done', stepIndex: 3 });
    expect(await service.finish(t.id)).toMatchObject({ status: 'done' });
    // позицию запустили заново — старую уже не вернуть
    await service.launch({ lineIds: [String(line1)] });
    await expect(service.move(t.id, { stepIndex: 1 })).rejects.toBeInstanceOf(ConflictException);
    await service.remove(tasks.rows[1]._id.toString());
    expect(await service.move(t.id, { stepIndex: 1 })).toMatchObject({ status: 'work', currentStep: 'Сварка' });
    expect(tasks.rows[0].completedAt).toBeUndefined();
  });

  it('отмена: нужна причина, отменённое не двигается, позицию можно запустить заново', async () => {
    const t = (await service.launch({ lineIds: [String(line1)] })).items[0];
    await expect(service.cancel(t.id, { reason: '  ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(await service.cancel(t.id, { reason: 'Расторгли договор' })).toMatchObject({ status: 'cancelled', cancelReason: 'Расторгли договор' });
    await expect(service.move(t.id, { to: 'next' })).rejects.toThrow('отменено');
    expect((await service.launch({ lineIds: [String(line1)] })).created).toBe(1);
    const fin = (await service.launch({ lineIds: [String(line2)] })).items[0];
    await service.finish(fin.id);
    await expect(service.cancel(fin.id, { reason: 'x' })).rejects.toThrow('Готовое');
  });

  it('доска: колонки по маршрутам, счётчики, фильтр по колонке; готовое старше 7 дней и отменённое скрыты', async () => {
    const a = (await service.launch({ lineIds: [String(line1)] })).items[0];
    await service.launch({ lineIds: [String(line2)] });
    await service.move(a.id, { stepIndex: 1 });
    const board = await service.list({});
    expect(board.columns.map((c) => [c.key, c.title, c.count])).toEqual([
      ['waiting', 'Ждёт запуска', 0], [String(cut), 'Резка', 0], [String(weld), 'Сварка', 1], [String(paint), 'Покраска', 0], ['generic', 'Изготовление', 1], ['done', 'Готово', 0],
    ]);
    expect(board.counts).toMatchObject({ work: 2, done: 0, all: 2 });
    expect((await service.list({ workTypeId: String(weld) })).items.map((i) => i.code)).toEqual(['W-1']);
    expect((await service.list({ workTypeId: 'generic' })).items.map((i) => i.code)).toEqual(['W-2']);
    // готовое
    await service.finish(a.id);
    tasks.rows[0].completedAt = new Date(Date.now() - 10 * 86400000);
    expect((await service.list({})).items.map((i) => i.code)).toEqual(['W-2']);
    expect((await service.list({ status: 'done' })).items.map((i) => i.code)).toEqual(['W-1']);
    expect((await service.list({ doneDays: '30' })).items.map((i) => i.code)).toEqual(['W-1', 'W-2']);
    await expect(service.list({ status: 'bad' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('исполнитель: уволенного и несуществующего назначить нельзя; сотрудники выбираются по виду работ', async () => {
    const t = (await service.launch({ lineIds: [String(line1)] })).items[0];
    const ivan = id(), fired = id(), vac = id();
    persons.rows.push(
      { _id: ivan, lastName: 'Иванов', firstName: 'Пётр', status: 'active', workTypeIds: [weld, paint], workTypeId: weld, deletedAt: null },
      { _id: fired, lastName: 'Сидоров', firstName: 'Олег', status: 'fired', workTypeId: weld, deletedAt: null },
      { _id: vac, lastName: 'Орлов', firstName: 'Ян', status: 'vacation', workTypeId: weld, deletedAt: null },
    );
    await expect(service.patch(t.id, { assigneeId: String(fired) })).rejects.toThrow('уволен');
    await expect(service.patch(t.id, { assigneeId: String(id()) })).rejects.toBeInstanceOf(BadRequestException);
    expect(await service.patch(t.id, { assigneeId: String(ivan), note: 'Срочно' })).toMatchObject({ assignee: { name: 'Иванов Пётр' }, note: 'Срочно' });
    expect(await service.patch(t.id, { assigneeId: null })).toMatchObject({ assigneeId: null });
    const people = await service.people({ workTypeId: String(paint) });
    expect(people.items.map((p) => [p.name, p.workTypeIds.length])).toEqual([['Иванов Пётр', 2]]);
  });

  it('маршрут изделия: запись целиком, порядок сохраняется, повтор вида работ — 400, пустой — убрать', async () => {
    await expect(routes.set(String(noRoute), { steps: [{ workTypeId: String(weld) }, { workTypeId: String(weld) }] })).rejects.toThrow('уже есть в маршруте');
    await expect(routes.set(String(noRoute), { steps: [{ workTypeId: String(gone) }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(await routes.get(String(noRoute))).toMatchObject({ hasRoute: false, note: 'Не задано, как делается', steps: [] });
    const r = await routes.set(String(noRoute), { steps: [{ workTypeId: String(paint) }, { workTypeId: String(cut), note: ' рез ' }] });
    expect(r).toMatchObject({ hasRoute: true, note: null });
    expect(r.steps.map((s) => [s.name, s.note])).toEqual([['Покраска', null], ['Резка', 'рез']]);
    await expect(routes.set(String(noRoute), { steps: [{ workTypeId: String(cut), lineId: String(id()) }] })).rejects.toThrow('Часть состава');
    expect((await routes.set(String(noRoute), { steps: [] })).hasRoute).toBe(false);
    expect(products.rows.find((p) => same(p._id, noRoute))!.workTypes).toBeUndefined();
    // удалённый вид работ в базе остался — показываем остальное и считаем пропуски
    expect(await routes.get(String(withRoute))).toMatchObject({ droppedSteps: 1 });
  });
});
