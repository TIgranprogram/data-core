import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * План позиции заказа (C041 Э1): get-or-create из изделия, PUT с rev (409), «Проверено», «и в продукцию»,
 * запуск по плану. НЕ запускался (нет Docker при написании).
 */
describe('Order line plans (состав позиции)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  let orderId = '', line = '', product = '', cut = '', weld = '';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['salesorders', 'incomes', 'worktasks', 'products', 'worktypes', 'orderlineplans']) await db().collection(c).deleteMany({});
    cut = String((await db().collection('worktypes').insertOne({ name: 'Резка', isActive: true, hourlyRate: 0, deletedAt: null })).insertedId);
    weld = String((await db().collection('worktypes').insertOne({ name: 'Сварка', isActive: true, hourlyRate: 0, deletedAt: null })).insertedId);
    product = String((await db().collection('products').insertOne({ name: 'Беседка', sku: '5000', photoIds: [], deletedAt: null, updatedAt: new Date('2026-11-01T00:00:00Z') })).insertedId);
    await http().put(`/api/work-routes/${product}`).set(auth()).send({ steps: [{ workTypeId: cut }] }).expect(200);
    orderId = (await http().post('/api/salesorders').set(auth()).send({ orderNo: '41-26', productionNo: '41-26', customer: 'ООО Парк' }).expect(201)).body.id;
    line = (await http().post('/api/incomes').set(auth()).send({ orderId, title: 'Беседка', qty: 1, unitPrice: 1000, productId: product }).expect(201)).body.id;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  let plan: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  it('GET by-income: план создаётся из изделия, повтор — тот же', async () => {
    plan = (await http().get(`/api/orderline-plans/by-income/${line}`).set(auth()).expect(200)).body;
    expect(plan).toMatchObject({ rev: 1, origin: 'product', productName: 'Беседка', diff: { changed: false } });
    expect(plan.steps.map((s: { workTypeName: string; partName: string }) => [s.workTypeName, s.partName])).toEqual([['Резка', 'Изделие целиком']]);
    expect((await http().get(`/api/orderline-plans/by-income/${line}`).set(auth()).expect(200)).body.id).toBe(plan.id);
  });

  it('PUT: части и работы, новая часть уходит в справочник; старый rev — 409', async () => {
    const saved = (await http().put(`/api/orderline-plans/${plan.id}`).set(auth()).send({
      rev: 1, parts: [{ id: 'p1', name: 'Навес', qty: 1 }],
      steps: [{ workTypeId: cut, partRowId: 'p1', hours: 2 }, { workTypeId: weld, partRowId: null, hours: 1 }],
    }).expect(200)).body;
    expect(saved).toMatchObject({ rev: 2, diff: { changed: true } });
    expect(saved.steps.map((s: { partName: string }) => s.partName)).toEqual(['Навес', 'Изделие целиком']);
    expect((await http().get('/api/dicts/productParts').set(auth()).expect(200)).body.items.map((i: { name: string }) => i.name)).toContain('Навес');
    await http().put(`/api/orderline-plans/${plan.id}`).set(auth()).send({ rev: 1, parts: [], steps: [] }).expect(409);
    plan = saved;
  });

  it('check: галочка у шага', async () => {
    const r = (await http().post(`/api/orderline-plans/${plan.id}/check`).set(auth()).send({ kind: 'step', rowId: plan.steps[0].id, checked: true }).expect(200)).body;
    expect(r.steps[0]).toMatchObject({ checked: true, checkedByName: expect.any(String) });
    plan = r;
  });

  it('apply-to-product: изделие получает части и маршрут; повтор со старой датой — 409', async () => {
    const r = (await http().post(`/api/orderline-plans/${plan.id}/apply-to-product`).set(auth()).send({ productUpdatedAt: plan.productUpdatedAt }).expect(200)).body;
    expect(r.plan.diff.changed).toBe(false);
    const route = (await http().get(`/api/work-routes/${product}`).set(auth()).expect(200)).body;
    expect(route.parts.map((p: { name: string }) => p.name)).toEqual(['Навес']);
    expect(route.steps.map((s: { name: string; hours: number }) => [s.name, s.hours])).toEqual([['Резка', 2], ['Сварка', 1]]);
    await http().post(`/api/orderline-plans/${plan.id}/apply-to-product`).set(auth()).send({ productUpdatedAt: plan.productUpdatedAt }).expect(409);
    plan = r.plan;
  });

  it('launch по плану: снимок со stepId/partName/hours, непроверенное — warnings; повтор GET — флаг «запущено»', async () => {
    const r = (await http().post('/api/work-tasks/launch').set(auth()).send({ lineIds: [line] }).expect(200)).body;
    expect(r.created).toBe(1);
    expect(r.warnings[0].text).toContain('без галочки');
    const task = await db().collection('worktasks').findOne({});
    expect(task!.route.map((s: { partName: string; hours: number; stepId: unknown }) => [s.partName, s.hours, !!s.stepId])).toEqual([['Навес', 2, true], ['Изделие целиком', 1, true]]);
    expect((await http().get(`/api/orderline-plans/by-income/${line}`).set(auth()).expect(200)).body).toMatchObject({ task: { status: 'work' }, changedAfterLaunch: false });
  });
});
