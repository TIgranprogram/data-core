import request from 'supertest';
import { Types } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * Заказы, этап 3 (ORDERS-3): отмена и перенос позиций, зависимости, права менеджера в производстве,
 * перенос договора между заказами, шаг назад по этапу — только admin с причиной.
 */
describe('Заказы: отмена и перенос позиций', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  let mgr = '', dir = '';
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const A = () => authHeader(admin.access);
  const M = () => ({ Authorization: `Bearer ${mgr}` });
  const D = () => ({ Authorization: `Bearer ${dir}` });

  const login = async (role: string) => {
    const username = `oc-${role}-${Date.now()}`;
    await http().post('/api/admin/users').set(A()).send({ username, password: 'role-pass-123', role }).expect(201);
    return (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access as string;
  };
  const order = async (no: string, stage = 'production') => (await http().post('/api/salesorders').set(A()).send({ orderNo: no, customer: 'Школа', stage }).expect(201)).body.id as string;
  const line = async (orderId: string, title: string, qty = 2, unitPrice = 100) => (await http().post('/api/incomes').set(A()).send({ orderId, title, qty, unit: 'шт', unitPrice }).expect(201)).body.id as string;
  const money = async (orderId: string) => (await http().get(`/api/incomes?orderId=${orderId}`).set(A()).expect(200)).body.money;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    for (const c of ['salesorders', 'incomes', 'designtasks', 'worktasks', 'reservations']) await db().collection(c).deleteMany({});
    mgr = await login('manager');
    dir = await login('user'); // наблюдатель: пишущие маршруты закрыты (директор по иерархии ролей проходит как менеджер, кнопки ему скрывает экран)
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('менеджер отменяет позицию в производстве: нужна причина, суммы уменьшаются, строка остаётся с причиной', async () => {
    const o = await order('ОК-1');
    const l1 = await line(o, 'Лавочка'), l2 = await line(o, 'Урна');
    expect((await money(o)).sum).toBe(400);
    await http().post(`/api/incomes/${l1}/cancel`).set(M()).send({}).expect(400);
    const res = (await http().post(`/api/incomes/${l1}/cancel`).set(M()).send({ reason: 'Загрузилась не в тот договор' }).expect(200)).body;
    expect(res.cancelledAt).toBeTruthy();
    expect((await money(o)).sum).toBe(200);
    // в карточке заказа отменённая строка есть, в обычном списке — нет
    const card = (await http().get(`/api/salesorders/${o}`).set(A()).expect(200)).body;
    expect(card.lines.find((x: { id: string }) => x.id === l1)).toMatchObject({ status: 'cancelled', cancelReason: 'Загрузилась не в тот договор' });
    expect((await http().get('/api/incomes').set(A()).expect(200)).body.items.some((x: { id: string }) => x.id === l1)).toBe(false);
    await http().post(`/api/incomes/${l1}/cancel`).set(M()).send({ reason: 'ещё раз' }).expect(409);
    // вернуть
    await http().post(`/api/incomes/${l1}/restore-cancelled`).set(M()).expect(200);
    expect((await money(o)).sum).toBe(400);
    void l2;
  });

  it('зависимости: без cascade — 409 со списком, с cascade — бронь/задачи сняты', async () => {
    const o = await order('ОК-2');
    const l = await line(o, 'Скамья');
    const task = (await db().collection('designtasks').insertOne({ seq: 9001, status: 'queue', orderId: new Types.ObjectId(o), incomeId: new Types.ObjectId(l), openIncomeId: new Types.ObjectId(l), deletedAt: null, title: 'Чертёж' })).insertedId;
    const dep = (await http().get(`/api/salesorders/${o}/dependencies`).set(A()).expect(200)).body;
    expect(dep.designTasks).toBe(1);
    expect(dep.lines[0].designTasks).toHaveLength(1);
    const refused = await http().post(`/api/incomes/${l}/cancel`).set(M()).send({ reason: 'ошибка загрузки' }).expect(409);
    expect(refused.body.details.designTasks).toHaveLength(1);
    await http().post(`/api/incomes/${l}/cancel`).set(M()).send({ reason: 'ошибка загрузки', cascade: true }).expect(200);
    const t = await db().collection('designtasks').findOne({ _id: task });
    expect(t).toMatchObject({ status: 'cancelled' });
    expect(t!.openIncomeId).toBeUndefined();
  });

  it('позиция с оплатой или отгрузкой не отменяется и не переносится — причина видна', async () => {
    const o = await order('ОК-3'), o2 = await order('ОК-3Б');
    const l = await line(o, 'Оплаченная');
    await http().post(`/api/incomes/${l}/payments`).set(A()).send({ date: '2026-10-01', amount: 50, method: 'нал' }).expect(200);
    const r = await http().post(`/api/incomes/${l}/cancel`).set(M()).send({ reason: 'ошибка', cascade: true }).expect(409);
    expect(r.body.message).toMatch(/оплата/);
    await http().post(`/api/incomes/${l}/move`).set(M()).send({ toOrderId: o2 }).expect(409);
  });

  it('перенос позиции: ссылки (задача проектирования) переехали, номер строки — следующий', async () => {
    const o = await order('ОК-4'), o2 = await order('ОК-4Б');
    await line(o2, 'Уже есть');
    const l = await line(o, 'Переезжает');
    await db().collection('designtasks').insertOne({ seq: 9002, status: 'work', orderId: new Types.ObjectId(o), incomeId: new Types.ObjectId(l), deletedAt: null });
    const moved = (await http().post(`/api/incomes/${l}/move`).set(M()).send({ toOrderId: o2 }).expect(200)).body;
    expect(moved.orderId).toBe(o2);
    expect(moved.lineNo).toBe(2);
    expect(moved.orderNo).toBe('ОК-4Б');
    expect((await db().collection('designtasks').findOne({ incomeId: new Types.ObjectId(l) }))!.orderId.toString()).toBe(o2);
    await http().post(`/api/incomes/${l}/move`).set(M()).send({ toOrderId: o2 }).expect(409); // уже там
  });

  it('роли: наблюдатель не отменяет (403); менеджер в «Готов к отгрузке» — 409, админ — можно', async () => {
    const o = await order('ОК-5', 'ready');
    const l = await line(o, 'Готовая');
    await http().post(`/api/incomes/${l}/cancel`).set(D()).send({ reason: 'нельзя' }).expect(403);
    const r = await http().post(`/api/incomes/${l}/cancel`).set(M()).send({ reason: 'нельзя ли' }).expect(409);
    expect(r.body.message).toMatch(/администратор/);
    await http().post(`/api/incomes/${l}/cancel`).set(A()).send({ reason: 'админ отменил' }).expect(200);
  });

  it('перенос договора в другой заказ: нужна цель; повтор — 409', async () => {
    const a = await order('ОК-6'), b = await order('ОК-6Б');
    await db().collection('salesorders').updateOne({ _id: new Types.ObjectId(a) }, { $set: { productionNo: '90-26' } });
    await db().collection('salesorders').updateOne({ _id: new Types.ObjectId(b) }, { $set: { productionNo: '91-26' } });
    await http().post('/api/production-orders/90-26/move-contract').set(M()).send({ contractId: a, toProductionNo: '99-26' }).expect(404);
    await http().post('/api/production-orders/90-26/move-contract').set(D()).send({ contractId: a, toProductionNo: '91-26' }).expect(403);
    await http().post('/api/production-orders/90-26/move-contract').set(M()).send({ contractId: a, toProductionNo: '91-26' }).expect(200);
    expect((await db().collection('salesorders').findOne({ _id: new Types.ObjectId(a) }))!.productionNo).toBe('91-26');
    await http().post('/api/production-orders/90-26/move-contract').set(M()).send({ contractId: a, toProductionNo: '91-26' }).expect(409);
  });

  it('этап назад: менеджер — 403, админ без причины — 400, с причиной — 200; вперёд — свободно', async () => {
    const o = await order('ОК-7', 'ready');
    await http().patch(`/api/salesorders/${o}`).set(M()).send({ stage: 'production', stageReason: 'ошиблись' }).expect(403);
    await http().patch(`/api/salesorders/${o}`).set(A()).send({ stage: 'production' }).expect(400);
    await http().patch(`/api/salesorders/${o}`).set(A()).send({ stage: 'production', stageReason: 'ошиблись с этапом' }).expect(200);
    await http().patch(`/api/salesorders/${o}`).set(M()).send({ stage: 'ready' }).expect(200);
  });
});
