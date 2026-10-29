import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * SK-8c — свои роли («Кладовщик»: права как у менеджера, разделы Склад + Заявки) — сквозная проверка по API;
 * SK-6c — «Выдать по заказу» с количеством по строкам (lines).
 */
describe('Свои роли (SK-8c) и «Выдать по заказу» по строкам (SK-6c)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  let roleId = '';
  let roleCode = '';
  let keeper = '';
  let manager = '';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('создание роли: код задаёт сервер (r-…), name в запросе — 400, без «права как у» и с admin — 400', async () => {
    await http().post('/api/roles').set(as(admin.access)).send({ name: 'storekeeper', label: 'Кладовщик', baseRole: 'manager' }).expect(400);
    await http().post('/api/roles').set(as(admin.access)).send({ label: 'Кладовщик' }).expect(400);
    await http().post('/api/roles').set(as(admin.access)).send({ label: 'Кладовщик', baseRole: 'admin' }).expect(400);
    const r = (await http().post('/api/roles').set(as(admin.access))
      .send({ label: 'Кладовщик', baseRole: 'manager', appSections: ['stock', 'requests'] }).expect(201)).body;
    expect(r.name).toMatch(/^r-[0-9a-f]+$/);
    expect(r).toMatchObject({ label: 'Кладовщик', baseRole: 'manager', appSections: ['stock', 'requests'] });
    roleId = r.id; roleCode = r.name;
  });

  it('сотрудник со своей ролью: вход, /auth/me — baseRole, roleLabel, sections; неизвестная роль — 400', async () => {
    await http().post('/api/admin/users').set(as(admin.access)).send({ username: `bad-role-${Date.now()}`, password: 'role-pass-123', role: 'r-nope00' }).expect(400);
    const username = `keeper-${Date.now()}`;
    await http().post('/api/admin/users').set(as(admin.access)).send({ username, password: 'role-pass-123', role: roleCode }).expect(201);
    const login = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body;
    keeper = login.access;
    const me = (await http().get('/api/auth/me').set(as(keeper)).expect(200)).body;
    const u = me.user ?? me;
    expect(u).toMatchObject({ role: roleCode, baseRole: 'manager', roleLabel: 'Кладовщик' });
    expect([...(u.sections ?? me.sections)].sort()).toEqual(['requests', 'stock']);

    const mgrName = `mgr-${Date.now()}`;
    await http().post('/api/admin/users').set(as(admin.access)).send({ username: mgrName, password: 'role-pass-123', role: 'manager' }).expect(201);
    manager = (await http().post('/api/auth/login').send({ username: mgrName, password: 'role-pass-123' }).expect(200)).body.access;
    const mm = (await http().get('/api/auth/me').set(as(manager)).expect(200)).body;
    expect(mm.user ?? mm).toMatchObject({ role: 'manager', baseRole: 'manager' });
  });

  it('Кладовщик: приход и выдача на складе проходят, бронь — тоже; деньги снабжения видит', async () => {
    const item = (await http().post('/api/stock/items').set(as(keeper)).send({ name: 'Болт кладовщика М6', unit: 'шт', categoryName: 'Метизы' }).expect(201)).body;
    await http().post('/api/stock/batch').set(as(keeper)).send({ type: 'in', lines: [{ materialId: item.id, qty: 20 }] }).expect(201);
    await http().post('/api/stock/batch').set(as(keeper)).send({ type: 'out', lines: [{ materialId: item.id, qty: 3 }] }).expect(201);
    expect((await http().get(`/api/stock/items/${item.id}`).set(as(keeper)).expect(200)).body).toMatchObject({ quantity: 17 });
    await http().post('/api/stock/reserve-list').set(as(keeper)).send({ groupName: 'Проба', lines: [{ materialId: item.id, qty: 1 }] }).expect(201);

    await http().post('/api/supply/requests').set(as(admin.access)).send({ title: 'Гайка с ценой SK8c', qty: 2, priceHint: 1500, clientUid: 'sk8c-1' }).expect(201);
    for (const t of [keeper, manager]) {
      const list = (await http().get('/api/supply/requests').query({ search: 'Гайка с ценой SK8c' }).set(as(t)).expect(200)).body;
      expect(list.items[0].title).toBe('Гайка с ценой SK8c');
      expect(list.items[0].priceHint).toBe(1500);
      await http().get('/api/payroll/summary').set(as(t)).expect(403);
    }
    await http().get('/api/admin/users').set(as(keeper)).expect(403);
  });

  it('переименование: название меняется, код и права — нет; код и baseRole встроенной роли менять нельзя', async () => {
    await http().patch(`/api/roles/${roleId}`).set(as(admin.access)).send({ label: 'Кладовщик склада' }).expect(200);
    const me = (await http().get('/api/auth/me').set(as(keeper)).expect(200)).body;
    expect(me.user ?? me).toMatchObject({ role: roleCode, baseRole: 'manager', roleLabel: 'Кладовщик склада' });
    const all = (await http().get('/api/roles').set(as(admin.access)).expect(200)).body;
    const list = Array.isArray(all) ? all : all.items;
    const mgr = list.find((x: { name: string }) => x.name === 'manager');
    await http().patch(`/api/roles/${mgr.id}`).set(as(admin.access)).send({ baseRole: 'director' }).expect(400);
  });

  it('удаление назначенной роли — 409; встроенной — 409', async () => {
    const res = await http().delete(`/api/roles/${roleId}`).set(as(admin.access)).expect(409);
    expect(String(res.body.message)).toMatch(/назначена/);
    const all = (await http().get('/api/roles').set(as(admin.access)).expect(200)).body;
    const list = Array.isArray(all) ? all : all.items;
    await http().delete(`/api/roles/${list.find((x: { name: string }) => x.name === 'manager').id}`).set(as(admin.access)).expect(409);
    // неназначенная своя роль удаляется
    const spare = (await http().post('/api/roles').set(as(admin.access)).send({ label: 'Инженер', baseRole: 'manager' }).expect(201)).body;
    await http().delete(`/api/roles/${spare.id}`).set(as(admin.access)).expect(204);
  });

  it('SK-6c: «Выдать по заказу» с lines — qty меньше брони оставляет остаток активным, больше брони — 400', async () => {
    const t = as(admin.access);
    const order = (await http().post('/api/salesorders').set(t).send({ orderNo: 'SK6C-1' }).expect(201)).body;
    const item = (await http().post('/api/stock/items').set(t).send({ name: 'Уголок SK6C', unit: 'м', categoryName: 'Металл' }).expect(201)).body;
    await http().post('/api/stock/batch').set(t).send({ type: 'in', lines: [{ materialId: item.id, qty: 30 }] }).expect(201);
    const r = (await http().post('/api/stock/reserve-list').set(t).send({ groupName: 'Под заказ', salesOrderId: order.id, lines: [{ materialId: item.id, qty: 10 }] }).expect(201)).body;
    const line = r.lines[0];

    await http().post('/api/stock/reservations/issue-order').set(t).send({ salesOrderId: order.id, lines: [{ reservationId: line.id, qty: 11 }] }).expect(400);
    await http().post('/api/stock/reservations/issue-order').set(t).send({ salesOrderId: order.id, lines: [{ reservationId: line.id, qty: 4 }], clientUid: 'sk6c-1' }).expect(200);
    // повтор с тем же clientUid ничего не меняет
    await http().post('/api/stock/reservations/issue-order').set(t).send({ salesOrderId: order.id, lines: [{ reservationId: line.id, qty: 4 }], clientUid: 'sk6c-1' }).expect(200);
    const d = (await http().get(`/api/stock/reservations/group/${r.batchId}`).set(t).expect(200)).body;
    expect(d.lines[0]).toMatchObject({ status: 'active', left: 6, issued: 4 });
    expect((await http().get(`/api/stock/items/${item.id}`).set(t)).body).toMatchObject({ quantity: 26, reservedQty: 6 });
  });
});
