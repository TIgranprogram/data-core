import request from 'supertest';
import { Types } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * Заказ производства: договоры с одним productionNo — один заказ. Список (одна строка), карточка
 * со сквозной нумерацией, «К производству», запрет вывода договора с отгрузкой, этап «ко всем договорам».
 */
describe('Production orders (заказы производства)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  let a = '', b = '', solo = '';
  const line = async (orderId: string, title: string, qty: number, unit = 'шт') => (await http().post('/api/incomes').set(auth()).send({ orderId, title, qty, unit }).expect(201)).body.id as string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['salesorders', 'incomes', 'shipments', 'auditlogs', 'stockmovements']) await db().collection(c).deleteMany({});
    a = (await http().post('/api/salesorders').set(auth()).send({ orderNo: 'ПО-1', customer: 'Школа 1', productionNo: '21-26', stage: 'production', shipDate: '2026-07-01' }).expect(201)).body.id;
    b = (await http().post('/api/salesorders').set(auth()).send({ orderNo: 'ПО-2', customer: 'Школа 2', productionNo: '21-26', stage: 'new', shipDate: '2026-06-01' }).expect(201)).body.id;
    solo = (await http().post('/api/salesorders').set(auth()).send({ orderNo: 'ПО-3', customer: 'Школа 3', stage: 'new' }).expect(201)).body.id;
    await line(a, 'Лавочка парковая', 2);
    await line(a, 'Урна', 1);
    await line(b, 'лавочка  парковая', 3);
    await line(solo, 'Столб', 1);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('список: два договора с одним № — одна строка; договор без № — отдельная; счётчики по объединённым', async () => {
    const r = (await http().get('/api/production-orders').set(auth()).expect(200)).body;
    expect(r.total).toBe(2);
    const g = r.items.find((x: { productionNo: string | null }) => x.productionNo === '21-26');
    expect(g).toMatchObject({ key: '21-26', orderNos: ['ПО-1', 'ПО-2'], lineCount: 3, stage: 'new', stagesDiffer: true });
    expect(g.customers).toEqual(['Школа 1', 'Школа 2']);
    expect(new Date(g.deadline).toISOString().slice(0, 10)).toBe('2026-06-01');
    const s = r.items.find((x: { productionNo: string | null }) => x.productionNo === null);
    expect(s).toMatchObject({ key: solo, orderNos: ['ПО-3'] });
    expect(r.counts).toMatchObject({ all: 2, active: 2, new: 2, production: 0 });
    expect((await http().get('/api/production-orders').query({ search: 'ПО-2' }).set(auth()).expect(200)).body.items[0].orderNos).toEqual(['ПО-1', 'ПО-2']);
    await http().get('/api/production-orders').query({ sort: 'productionNo' }).set(auth()).expect(200);
  });

  it('карточка: сквозная нумерация по порядку входа, «К производству» суммирует, по договору без № — ключ id', async () => {
    const r = (await http().get('/api/production-orders/21-26').set(auth()).expect(200)).body;
    expect(r.orders.map((o: { orderNo: string }) => o.orderNo)).toEqual(['ПО-1', 'ПО-2']);
    expect(r.orders.flatMap((o: { lines: Array<{ seqNo: number }> }) => o.lines.map((l) => l.seqNo))).toEqual([1, 2, 3]);
    expect(r.toProduce).toHaveLength(2);
    expect(r.toProduce[0]).toMatchObject({ qty: 5, unit: 'шт', seqNos: [1, 3] });
    const one = (await http().get(`/api/production-orders/${solo}`).set(auth()).expect(200)).body;
    expect(one).toMatchObject({ productionNo: null, key: solo });
    await http().get('/api/production-orders/99-99').set(auth()).expect(404);
    const lk = (await http().get(`/api/salesorders/${b}/lines-lookup`).set(auth()).expect(200)).body;
    expect(lk[0]).toMatchObject({ productionNo: '21-26', seqNo: 3 });
    const lookup = (await http().get('/api/salesorders/lookup').query({ lines: '1' }).set(auth()).expect(200)).body.items.find((x: { id: string }) => x.id === b);
    expect(lookup.lines[0].seqNo).toBe(3);
  });

  it('этап «ко всем договорам»: подтягивает только отстающие, пишет историю', async () => {
    const r = (await http().post('/api/production-orders/21-26/stage').set(auth()).send({ stage: 'production' }).expect(200)).body;
    expect(r.changed).toEqual([b]);
    expect(r).toMatchObject({ stage: 'production', stagesDiffer: false });
    const r2 = (await http().post('/api/production-orders/21-26/stage').set(auth()).send({ stage: 'ready' }).expect(200)).body;
    expect(r2.changed.sort()).toEqual([a, b].sort());
    await http().post('/api/production-orders/21-26/stage').set(auth()).send({ stage: 'cancelled' }).expect(400);
    const h = (await http().get(`/api/salesorders/${b}/history`).set(auth()).expect(200)).body;
    expect(JSON.stringify(h)).toContain('Готов к отгрузке');
  });

  it('договор с отгрузкой/выдачей нельзя вывести из заказа (409); без них — можно, порядок входа обновляется', async () => {
    await http().post(`/api/salesorders/${b}/shipments`).set(auth()).send({ lines: [{ incomeId: (await db().collection('incomes').findOne({ orderId: new Types.ObjectId(b) }))!._id.toString(), qty: 1 }], reason: 'часть' }).expect(201);
    const r = await http().patch(`/api/salesorders/${b}`).set(auth()).send({ productionNo: '' }).expect(409);
    expect(r.body.message).toContain('Договор уже в работе');
    await http().patch(`/api/salesorders/${b}`).set(auth()).send({ productionNo: '22-26' }).expect(409);
    // договор без движений: вышел из заказа и снова вошёл — в конец
    await http().patch(`/api/salesorders/${a}`).set(auth()).send({ productionNo: '' }).expect(200);
    const left = (await http().get('/api/production-orders/21-26').set(auth()).expect(200)).body;
    expect(left.orders.map((o: { orderNo: string }) => o.orderNo)).toEqual(['ПО-2']);
    await http().patch(`/api/salesorders/${a}`).set(auth()).send({ productionNo: '21-26' }).expect(200);
    const back = (await http().get('/api/production-orders/21-26').set(auth()).expect(200)).body;
    expect(back.orders.map((o: { orderNo: string }) => o.orderNo)).toEqual(['ПО-2', 'ПО-1']);
    expect(back.orders[0].lines[0].seqNo).toBe(1);
  });

  it('номер отгрузки при общем № заказа: ОТГ-<заказ>-<договор>-<n>', async () => {
    const list = (await http().get(`/api/salesorders/${b}/shipments`).set(auth()).expect(200)).body;
    expect(list.items[0].number).toBe('ОТГ-21-26-ПО-2-1');
  });
});
