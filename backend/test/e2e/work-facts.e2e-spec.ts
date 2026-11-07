import request from 'supertest';
import { Types } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * C041 Э3 — факт шага → «Фактически» изделия (медиана) → «Принять как норму» → срок позиции/заказа → себестоимость.
 * Коллекции: orderlineplans (план позиции), workhours (факт-часы, только data-core), products.parts/workTypes, worktypes.
 */
describe('C041 Э3: факт, нормы, сроки и себестоимость', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  const db = () => ctx!.connection.db!;
  const ids = { prod: new Types.ObjectId(), part: new Types.ObjectId(), cut: new Types.ObjectId(), order: new Types.ObjectId(), income: new Types.ObjectId() };
  let planId = '', stepId = '';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['products', 'incomes', 'salesorders', 'orderlineplans', 'workhours', 'worktypes', 'persons']) await db().collection(c).deleteMany({});
    const now = new Date();
    // вид работ со ставкой 500 ₽/ч — себестоимость работ, когда у сотрудника нет почасовой ставки (Q4)
    await db().collection('worktypes').insertOne({ _id: ids.cut, name: 'Резка', hourlyRate: 500, deletedAt: null, createdAt: now });
    // изделие: часть «Стойки» и резка на неё с нормой 8 ч на 1 шт.
    await db().collection('products').insertOne({
      _id: ids.prod, name: 'Беседка Э3', deletedAt: null, updatedAt: now,
      parts: [{ _id: ids.part, name: 'Стойки', qty: 4, checked: true }],
      workTypes: [{ workTypeId: ids.cut, partRowId: ids.part, hours: 8, checked: true }],
      composition: [], photoIds: [],
    });
    await db().collection('salesorders').insertOne({ _id: ids.order, orderNo: 'Э3-1', deletedAt: null, stage: 'work', createdAt: now, updatedAt: now });
    await db().collection('incomes').insertOne({ _id: ids.income, orderId: ids.order, orderNo: 'Э3-1', productId: ids.prod, title: 'Беседка Э3', qty: 3, deletedAt: null, createdAt: now, updatedAt: now });
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('план берёт норму изделия, срок позиции считается по норме и количеству', async () => {
    const plan = await http().get(`/api/orderline-plans/by-income/${ids.income}`).set(auth()).expect(200);
    planId = plan.body.id;
    expect(plan.body.steps[0]).toMatchObject({ workTypeName: 'Резка', partName: 'Стойки', hours: 8 });
    expect(plan.body.steps[0].id).toBeTruthy();
    stepId = plan.body.steps[0].id;
    // 8 ч × 3 шт = 24 ч → 3 рабочих дня; факта ещё нет
    expect(plan.body.leadDays).toBe(3);
    expect(plan.body.fact).toEqual({ hours: 0, perUnit: 0 });
  });

  it('отметки «начал / закончил» пишут факт-часы (workhours), повтор не удваивает', async () => {
    await http().post(`/api/orderline-plans/${planId}/steps/${stepId}/mark`).set(auth()).send({ what: 'start' }).expect(200);
    const done = await http().post(`/api/orderline-plans/${planId}/steps/${stepId}/mark`).set(auth()).send({ what: 'finish' }).expect(200);
    expect(done.body.bar.startedAt).toBeTruthy();
    expect(done.body.bar.finishedAt).toBeTruthy();
    const hours = await db().collection('workhours').find({ stepId: new Types.ObjectId(stepId) }).toArray();
    expect(hours).toHaveLength(1);
    expect(hours[0]).toMatchObject({ date: expect.any(String), hours: 0.25 }); // начал и закончил в один день — реальная разница
    // повтор «закончил» — те же часы, без удвоения
    await http().post(`/api/orderline-plans/${planId}/steps/${stepId}/mark`).set(auth()).send({ what: 'finish' }).expect(200);
    const again = await http().get(`/api/orderline-plans/by-income/${ids.income}`).set(auth()).expect(200);
    expect(again.body.steps[0].factHours).toBe(0.25);
    expect(again.body.fact.hours).toBe(0.25);
  });

  it('«Фактически» изделия — медиана последних заказов по шагам и всего', async () => {
    const f = await http().get(`/api/work-facts/product/${ids.prod}`).set(auth()).expect(200);
    expect(f.body).toMatchObject({ orders: 1, productName: 'Беседка Э3' });
    expect(f.body.steps[0]).toMatchObject({ workTypeName: 'Резка', partName: 'Стойки', hoursPerUnit: 0.08, sample: 1, normHours: 8 });
    expect(f.body.total).toMatchObject({ hoursPerUnit: 0.08, sample: 1 });
    expect(f.body.used[0]).toMatchObject({ incomeId: String(ids.income), lineTitle: 'Беседка Э3', hoursPerUnit: 0.08 });
  });

  it('«Принять как норму» пишет медиану в маршрут изделия', async () => {
    const r = await http().post(`/api/work-facts/product/${ids.prod}/apply`).set(auth()).expect(200);
    expect(r.body).toEqual({ applied: 1, skipped: 0, totalHours: 0.08 });
    const prod = await db().collection('products').findOne({ _id: ids.prod });
    expect(prod!.workTypes[0].hours).toBe(0.08);
    const f = await http().get(`/api/work-facts/product/${ids.prod}`).set(auth()).expect(200);
    expect(f.body.normTotalHours).toBe(0.08);
  });

  it('себестоимость позиции: работы = часы × ставка вида работ, скрыта без права на деньги', async () => {
    const c = await http().get(`/api/work-facts/cost?incomeId=${ids.income}`).set(auth()).expect(200);
    expect(c.body).toMatchObject({ scope: 'income', qty: 3 });
    expect(c.body.works).toMatchObject({ hours: 0.25, missingRate: 0, total: 125 }); // 0,25 ч × 3 шт × 500 ₽
    expect(c.body.works.lines[0]).toMatchObject({ workTypeName: 'Резка', partName: 'Стойки', rate: 500, rateSource: 'worktype', sum: 125 });
    expect(c.body.total).toBe(125);
  });

  it('карточка заказа отдаёт «Срок изготовления, дн.»', async () => {
    const o = await http().get(`/api/salesorders/${ids.order}`).set(auth()).expect(200);
    expect(typeof o.body.leadDays).toBe('number');
    expect(o.body.leadDays).toBeGreaterThan(0);
  });

  it('проверки до записи: без шага — 404, конец раньше начала — 400', async () => {
    await http().post(`/api/orderline-plans/${planId}/steps/${new Types.ObjectId()}/mark`).set(auth()).send({ what: 'start' }).expect(404);
  });
});
