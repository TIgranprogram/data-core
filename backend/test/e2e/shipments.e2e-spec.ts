import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * Отгрузки (ОТГ): остаток, 400 «Осталось N», причина при частичной отгрузке, этап заказа сам
 * (partly → shipped → отмена → partly/ready), история заказа, PDF, очередь паспортов.
 */
describe('Shipments (отгрузки)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  let orderId = '', urnId = '', benchId = '', noQtyId = '';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['salesorders', 'incomes', 'shipments', 'auditlogs']) await db().collection(c).deleteMany({});
    const o = await http().post('/api/salesorders').set(auth()).send({ orderNo: 'ОТГ-1', customer: 'ООО Школа', stage: 'ready' }).expect(201);
    orderId = o.body.id;
    const mk = async (title: string, qty?: number) => (await http().post('/api/incomes').set(auth()).send({ orderId, title, ...(qty ? { qty, unit: 'шт' } : {}) }).expect(201)).body.id as string;
    urnId = await mk('Урна', 15);
    benchId = await mk('Скамья', 4);
    noQtyId = await mk('Без количества');
  });
  afterAll(async () => { await ctx?.cleanup(); });

  let first = '';

  it('нельзя больше остатка (400 «Осталось»), без количества в заказе и без причины при частичной — 400', async () => {
    const r = await http().post(`/api/salesorders/${orderId}/shipments`).set(auth()).send({ lines: [{ incomeId: urnId, qty: 16 }], reason: 'x' }).expect(400);
    expect(r.body.message).toContain('осталось 15');
    await http().post(`/api/salesorders/${orderId}/shipments`).set(auth()).send({ lines: [{ incomeId: noQtyId, qty: 1 }] }).expect(400);
    await http().post(`/api/salesorders/${orderId}/shipments`).set(auth()).send({ lines: [{ incomeId: urnId, qty: 5 }] }).expect(400);
    expect((await http().get(`/api/salesorders/${orderId}/shipments`).set(auth()).expect(200)).body.total).toBe(0);
  });

  it('частичная отгрузка: номер, остаток, этап «Частично отгружен», позиция «отгружено / осталось»', async () => {
    const r = await http().post(`/api/salesorders/${orderId}/shipments`).set(auth()).send({ lines: [{ incomeId: urnId, qty: 5 }], reason: 'остальное в производстве', receiver: 'Иванов' }).expect(201);
    first = r.body.id;
    expect(r.body).toMatchObject({ number: 'ОТГ-ОТГ-1-1', orderStage: 'partly', qtyTotal: 5 });
    const list = (await http().get(`/api/salesorders/${orderId}/shipments`).set(auth()).expect(200)).body;
    expect(list.remaining.find((x: { incomeId: string }) => x.incomeId === urnId)).toMatchObject({ qty: 15, shipped: 5, left: 10 });
    expect(list.remaining.find((x: { incomeId: string }) => x.incomeId === urnId)).toMatchObject({ canShip: true, missing: [], work: null });
    expect(typeof list.shippable).toBe("number");
    const card = (await http().get(`/api/salesorders/${orderId}`).set(auth()).expect(200)).body;
    expect(card).toMatchObject({ stage: 'partly', stageLabel: 'Частично отгружен', shipmentCount: 1 });
    expect(card.lines.find((l: { id: string }) => l.id === urnId)).toMatchObject({ shipped: 5, left: 10 });
    expect((await http().get('/api/salesorders').query({ filter: 'active' }).set(auth()).expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(orderId);
  });

  it('остаток по всем позициям с количеством — этап «Отгружен»; отмена возвращает остаток и этап', async () => {
    const r = await http().post(`/api/salesorders/${orderId}/shipments`).set(auth()).send({ lines: [{ incomeId: urnId, qty: 10 }, { incomeId: benchId, qty: 4 }] }).expect(201);
    expect(r.body).toMatchObject({ number: 'ОТГ-ОТГ-1-2', orderStage: 'shipped' });
    await http().delete(`/api/shipments/${r.body.id}`).set(auth()).expect(200);
    const list = (await http().get(`/api/salesorders/${orderId}/shipments`).set(auth()).expect(200)).body;
    expect(list.stage).toBe('partly');
    expect(list.remaining.find((x: { incomeId: string }) => x.incomeId === benchId).left).toBe(4);
    const back = await http().post(`/api/shipments/${r.body.id}/restore`).set(auth()).expect(200);
    expect(back.body.orderStage).toBe('shipped');
    await http().delete(`/api/shipments/${r.body.id}`).set(auth()).expect(200);
  });

  it('правка примечания, печатная форма PDF, история заказа', async () => {
    await http().patch(`/api/shipments/${first}`).set(auth()).send({ docNo: 'УПД-7' }).expect(200);
    const pdf = await http().get(`/api/shipments/${first}/pdf`).set(auth()).buffer().parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const h = (await http().get(`/api/salesorders/${orderId}/history`).query({ type: 'shipment', search: 'урна' }).set(auth()).expect(200)).body;
    expect(h.items.length).toBeGreaterThan(0);
    const all = (await http().get(`/api/salesorders/${orderId}/history`).query({ type: 'shipment' }).set(auth()).expect(200)).body;
    expect(all.items.some((i: { text: string }) => i.text.includes('Отгрузка отменена'))).toBe(true);
    await http().get(`/api/salesorders/${orderId}/history`).query({ type: 'nope' }).set(auth()).expect(400);
  });

  it('очередь паспортов отвечает формой { items, total, counts }', async () => {
    const q = (await http().get('/api/passports/queue').set(auth()).expect(200)).body;
    expect(q).toEqual(expect.objectContaining({ items: expect.any(Array), total: expect.any(Number), counts: { none: expect.any(Number), draft: expect.any(Number), rework: expect.any(Number), hot: expect.any(Number) } }));
  });
});
