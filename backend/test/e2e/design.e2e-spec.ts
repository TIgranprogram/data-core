import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * «Проектирование» (ПРЖ-3): /api/design-tasks + приоритет заказа + изделие в позициях заказа.
 * Задача на позицию (from-order без дублей, 409 на вторую открытую), свободная задача, правила статусов,
 * срок/приоритет из заказа, «Кто проектировал» при завершении, корзина, D-N не повторяется.
 */
describe('Design tasks (Проектирование)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  let orderId = '', lineId = '', personId = '', productId = '';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['salesorders', 'incomes', 'designtasks', 'persons', 'products']) await db().collection(c).deleteMany({});
    const p = await db().collection('persons').insertOne({ lastName: 'Иванов', firstName: 'Пётр', deletedAt: null });
    personId = String(p.insertedId);
    const pr = await db().collection('products').insertOne({ name: 'Скамья', sku: '3410', photoIds: [], deletedAt: null });
    productId = String(pr.insertedId);
    orderId = (await http().post('/api/salesorders').set(auth()).send({ orderNo: '20-26', customer: 'ООО Парк', productionDeadline: '2026-12-01', shipDate: '2026-12-20', priority: 'urgent' }).expect(201)).body.id;
    lineId = (await http().post('/api/incomes').set(auth()).send({ orderId, title: 'Скамья парковая Цвет: графит', qty: 2, unitPrice: 1000, productId }).expect(201)).body.id;
    await http().post('/api/incomes').set(auth()).send({ orderId, title: 'Урна', qty: 1 }).expect(201);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('заказ: priority принимается, отдаётся, фильтруется; в позициях есть product {id,name,sku,photoId}', async () => {
    await http().patch(`/api/salesorders/${orderId}`).set(auth()).send({ priority: 'asap' }).expect(400);
    const o = (await http().get(`/api/salesorders/${orderId}`).set(auth()).expect(200)).body;
    expect(o.priority).toBe('urgent');
    expect(o.lines.find((l: { id: string }) => l.id === lineId).product).toMatchObject({ id: productId, name: 'Скамья', sku: '3410', photoId: null });
    const l = (await http().get('/api/salesorders').query({ priority: 'urgent', sort: 'priority' }).set(auth()).expect(200)).body;
    expect(l.items.map((x: { id: string }) => x.id)).toContain(orderId);
    expect((await http().get('/api/salesorders').query({ priority: 'low' }).set(auth()).expect(200)).body.total).toBe(0);
  });

  let taskId = '';
  it('from-order: задача на каждую позицию, повтор — 0 новых; срок и приоритет из заказа', async () => {
    const r = (await http().post('/api/design-tasks/from-order').set(auth()).send({ orderId }).expect(200)).body;
    expect(r).toMatchObject({ created: 2, skipped: 0 });
    const t = r.items.find((x: { sku: string | null }) => x.sku === '3410');
    taskId = t.id;
    expect(t).toMatchObject({ status: 'queue', title: expect.stringContaining('Чертежи 3410 ЗНП 20-26'), priority: 'urgent', priorityFromOrder: true, deadlineFromOrder: true });
    expect(t.deadline.slice(0, 10)).toBe('2026-12-01');
    expect((await http().post('/api/design-tasks/from-order').set(auth()).send({ orderId }).expect(200)).body).toMatchObject({ created: 0, skipped: 2 });
    await http().post('/api/design-tasks').set(auth()).send({ incomeId: lineId }).expect(409);
  });

  it('правила статусов и завершение: designerId изделия заполняется исполнителем', async () => {
    await http().patch(`/api/design-tasks/${taskId}`).set(auth()).send({ status: 'work' }).expect(400);
    await http().patch(`/api/design-tasks/${taskId}`).set(auth()).send({ status: 'paused' }).expect(400);
    await http().patch(`/api/design-tasks/${taskId}`).set(auth()).send({ status: 'work', assigneeId: personId }).expect(200);
    const done = (await http().patch(`/api/design-tasks/${taskId}`).set(auth()).send({ status: 'done' }).expect(200)).body;
    expect(done.completedAt).toBeTruthy();
    expect(String((await db().collection('products').findOne({ sku: '3410' }))!.designerId)).toBe(personId);
    // после «Завершено» на позицию можно новую
    await http().post('/api/design-tasks').set(auth()).send({ incomeId: lineId }).expect(201);
  });

  it('свободная задача, список с counts, поиск, корзина; D-N не повторяется', async () => {
    await http().post('/api/design-tasks').set(auth()).send({ priority: 'high' }).expect(400);
    const free = (await http().post('/api/design-tasks').set(auth()).send({ title: 'Эскиз стенда', deadline: '15.11.2026', priority: 'high' }).expect(201)).body;
    expect(free).toMatchObject({ title: 'Эскиз стенда', priority: 'high', priorityFromOrder: false });
    const l = (await http().get('/api/design-tasks').query({ status: 'queue' }).set(auth()).expect(200)).body;
    expect(l.counts).toMatchObject({ done: 1, all: l.counts.queue + l.counts.work + l.counts.done + l.counts.paused });
    expect(l.items.every((x: { status: string }) => x.status === 'queue')).toBe(true);
    expect((await http().get('/api/design-tasks').query({ search: 'Эскиз' }).set(auth()).expect(200)).body.total).toBe(1);
    await http().delete(`/api/design-tasks/${free.id}`).set(auth()).expect(200);
    await http().get(`/api/design-tasks/${free.id}`).set(auth()).expect(404);
    await http().post(`/api/design-tasks/${free.id}/restore`).set(auth()).expect(200);
    const next = (await http().post('/api/design-tasks').set(auth()).send({ title: 'Ещё' }).expect(201)).body;
    expect(Number(next.code.slice(2))).toBeGreaterThan(Number(free.code.slice(2)));
  });
});
