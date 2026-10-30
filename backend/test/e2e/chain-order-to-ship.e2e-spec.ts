import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

type Row = { incomeId: string; qty: number; shipped: number; left: number; canShip: boolean; missing: string[]; work: { status: string } | null };

/**
 * Цепочка «заказ → позиции → проектирование → запуск в работу → выполнено → отгрузка».
 * Сверяем итог: этап заказа, состояние позиции (готовность, остаток), очередь паспортов.
 */
describe('Цепочка: заказ до отгрузки', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  let orderId = '', benchId = '', urnId = '', benchProduct = '', urnProduct = '', personId = '';
  const queueOf = async () => (await http().get('/api/passports/queue').query({ limit: 500 }).set(auth()).expect(200)).body.items.filter((i: { orderId: string }) => i.orderId === orderId) as Array<{ incomeId: string; passportState: string; work: { status: string } | null }>;
  const rows = async () => (await http().get(`/api/salesorders/${orderId}/shipments`).set(auth()).expect(200)).body.remaining as Row[];
  const rowOf = async (id: string) => (await rows()).find((r) => r.incomeId === id)!;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['salesorders', 'incomes', 'designtasks', 'designorders', 'worktasks', 'worktypes', 'shipments', 'productpassports', 'persons', 'products']) await db().collection(c).deleteMany({});
    personId = String((await db().collection('persons').insertOne({ lastName: 'Иванов', firstName: 'Пётр', deletedAt: null })).insertedId);
    benchProduct = String((await db().collection('products').insertOne({ name: 'Скамья', sku: '3410', photoIds: [], deletedAt: null })).insertedId);
    urnProduct = String((await db().collection('products').insertOne({ name: 'Урна', sku: '1200', photoIds: [], deletedAt: null })).insertedId);
    orderId = (await http().post('/api/salesorders').set(auth()).send({ orderNo: 'ЦП-1', productionNo: 'ЦП-1', customer: 'ООО Парк', shipDate: '2026-12-20' }).expect(201)).body.id;
    benchId = (await http().post('/api/incomes').set(auth()).send({ orderId, title: 'Скамья', qty: 2, unitPrice: 1000, productId: benchProduct }).expect(201)).body.id;
    urnId = (await http().post('/api/incomes').set(auth()).send({ orderId, title: 'Урна', qty: 1, productId: urnProduct }).expect(201)).body.id;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('заказ создан с двумя позициями, этап не «отгружен», отгружено 0', async () => {
    const card = (await http().get(`/api/salesorders/${orderId}`).set(auth()).expect(200)).body;
    expect(card.lines).toHaveLength(2);
    expect(card.stage).not.toBe('shipped');
    expect(card.shipmentCount ?? 0).toBe(0);
    expect(await rowOf(benchId)).toMatchObject({ qty: 2, shipped: 0, left: 2 });
  });

  it('до проектирования позиции нет в очереди паспортов', async () => {
    expect(await queueOf()).toEqual([]);
  });

  it('проектирование: from-order создаёт задачи, «Завершено» — позиции появляются в очереди паспортов «нет паспорта»', async () => {
    const r = (await http().post('/api/design-tasks/from-order').set(auth()).send({ orderId }).expect(200)).body;
    expect(r).toMatchObject({ created: 2, skipped: 0 });
    for (const t of r.items) {
      await http().patch(`/api/design-tasks/${t.id}`).set(auth()).send({ status: 'work', assigneeId: personId }).expect(200);
      const done = (await http().patch(`/api/design-tasks/${t.id}`).set(auth()).send({ status: 'done' }).expect(200)).body;
      expect(done.status).toBe('done');
    }
    const q = await queueOf();
    expect(q.map((i) => i.incomeId).sort()).toEqual([benchId, urnId].sort());
    for (const i of q) expect(i).toMatchObject({ passportState: 'none', work: null });
    // изделие получило конструктора
    expect(String((await db().collection('products').findOne({ sku: '3410' }))!.designerId)).toBe(personId);
  });

  it('запуск в работу: задачи созданы, позиции в очереди несут задание; отгружать «рано» (подсказка), повтор запуска ничего не плодит', async () => {
    const r = (await http().post('/api/work-tasks/launch').set(auth()).send({ orderId }).expect(200)).body;
    expect(r).toMatchObject({ created: 2 });
    const again = (await http().post('/api/work-tasks/launch').set(auth()).send({ orderId }).expect(200)).body;
    expect(again.created).toBe(0);
    expect(await db().collection('worktasks').countDocuments({ status: { $ne: 'cancelled' } })).toBe(2);
    for (const i of await queueOf()) expect(i.work).toMatchObject({ status: 'work' });
    const bench = await rowOf(benchId);
    expect(bench.canShip).toBe(false);
    expect(bench.missing.join(' ')).toContain('Ещё в работе');
    expect(bench.work).toMatchObject({ status: 'work' });
  });

  it('отгрузка больше количества в заказе — 400 «осталось 2», отгрузок не создано', async () => {
    const r = await http().post(`/api/salesorders/${orderId}/shipments`).set(auth()).send({ lines: [{ incomeId: benchId, qty: 3 }], reason: 'x' }).expect(400);
    expect(r.body.message).toContain('осталось 2');
    expect((await http().get(`/api/salesorders/${orderId}/shipments`).set(auth()).expect(200)).body.total).toBe(0);
  });

  it('«Выполнено»: все задания done, позиции готовы к отгрузке, в очереди паспортов — задание в статусе done', async () => {
    const tasks = (await http().get('/api/work-tasks').query({ status: 'work' }).set(auth()).expect(200)).body.items as Array<{ id: string }>;
    expect(tasks).toHaveLength(2);
    for (const t of tasks) {
      let st = 'work';
      for (let i = 0; i < 6 && st !== 'done'; i++) st = (await http().post(`/api/work-tasks/${t.id}/move`).set(auth()).send({ to: 'next' }).expect(200)).body.status;
      expect(st).toBe('done');
    }
    expect((await http().get('/api/work-tasks').query({ status: 'done' }).set(auth()).expect(200)).body.total).toBe(2);
    for (const id of [benchId, urnId]) expect(await rowOf(id)).toMatchObject({ canShip: true, missing: [], work: { status: 'done' } });
    const list = (await http().get(`/api/salesorders/${orderId}/shipments`).set(auth()).expect(200)).body;
    expect(list.shippable).toBe(2);
    for (const i of await queueOf()) expect(i.work).toMatchObject({ status: 'done' });
  });

  it('частичная отгрузка: этап «Частично отгружен», остаток позиции уменьшился', async () => {
    const s = (await http().post(`/api/salesorders/${orderId}/shipments`).set(auth()).send({ lines: [{ incomeId: benchId, qty: 1 }], reason: 'вторая скамья позже' }).expect(201)).body;
    expect(s).toMatchObject({ orderStage: 'partly', qtyTotal: 1 });
    expect(await rowOf(benchId)).toMatchObject({ shipped: 1, left: 1, canShip: true });
    expect(await rowOf(urnId)).toMatchObject({ shipped: 0, left: 1 });
    expect((await http().get(`/api/salesorders/${orderId}`).set(auth()).expect(200)).body).toMatchObject({ stage: 'partly', shipmentCount: 1 });
    expect((await db().collection('salesorders').findOne({ orderNo: 'ЦП-1' }))!.stage).toBe('partly');
  });

  it('полная отгрузка остатка: этап «Отгружен», все остатки 0, нельзя отгрузить сверх', async () => {
    const s = (await http().post(`/api/salesorders/${orderId}/shipments`).set(auth()).send({ lines: [{ incomeId: benchId, qty: 1 }, { incomeId: urnId, qty: 1 }] }).expect(201)).body;
    expect(s.orderStage).toBe('shipped');
    for (const id of [benchId, urnId]) expect(await rowOf(id)).toMatchObject({ left: 0, canShip: false });
    expect((await http().get(`/api/salesorders/${orderId}`).set(auth()).expect(200)).body).toMatchObject({ stage: 'shipped', shipmentCount: 2 });
    expect((await db().collection('salesorders').findOne({ orderNo: 'ЦП-1' }))!.stage).toBe('shipped');
    await http().post(`/api/salesorders/${orderId}/shipments`).set(auth()).send({ lines: [{ incomeId: urnId, qty: 1 }] }).expect(400);
  });

  it('очередь паспортов после отгрузки: позиции остаются (паспорта нет), задание done; счётчик «нет паспорта» не меньше 2', async () => {
    const q = await queueOf();
    expect(q).toHaveLength(2);
    for (const i of q) expect(i).toMatchObject({ passportState: 'none', work: { status: 'done' } });
    const all = (await http().get('/api/passports/queue').set(auth()).expect(200)).body;
    expect(all.counts.none).toBeGreaterThanOrEqual(2);
  });

  it('отмена последней отгрузки возвращает этап «Частично отгружен» и остаток', async () => {
    const list = (await http().get(`/api/salesorders/${orderId}/shipments`).set(auth()).expect(200)).body;
    const last = list.items.reduce((a: { seq: number }, b: { seq: number }) => (b.seq > a.seq ? b : a));
    await http().delete(`/api/shipments/${last.id}`).set(auth()).expect(200);
    expect((await http().get(`/api/salesorders/${orderId}`).set(auth()).expect(200)).body.stage).toBe('partly');
    expect(await rowOf(urnId)).toMatchObject({ shipped: 0, left: 1 });
  });
});
