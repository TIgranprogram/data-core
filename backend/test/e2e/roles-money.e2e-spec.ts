import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * Иерархия ролей и деньги (решение пользователя 2026-10-20, common/roles-hierarchy.ts):
 * директор ⊃ бухгалтер ⊃ менеджер ⊃ наблюдатель; суммы, оплаты и платёжный календарь — админ / директор / бухгалтер / менеджер (2026-10-29); ФОТ — без менеджера; наблюдатель денег не видит.
 */
describe('Roles hierarchy + money visibility', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    for (const role of ['user', 'manager', 'accountant', 'director']) {
      const username = `rm-${role}-${Date.now()}`;
      await http().post('/api/admin/users').set(as(admin.access)).send({ username, password: 'role-pass-123', role }).expect(201);
      tokens[role] = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
    }
    await http().post('/api/supply/requests').set(as(admin.access)).send({ title: 'Болт с ценой', qty: 2, priceHint: 1500, clientUid: 'rm-1' }).expect(201);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('наблюдатель: заявки видит без сумм, платёжный календарь — 403', async () => {
    const list = (await http().get('/api/supply/requests').query({ search: 'Болт с ценой' }).set(as(tokens.user)).expect(200)).body;
    expect(list.items[0].title).toBe('Болт с ценой');
    expect(list.items[0].priceHint).toBeUndefined();
    expect(list.sum).toBeUndefined();
    await http().get('/api/finance/summary').set(as(tokens.user)).expect(403);
  });

  it('менеджер: видит и вписывает суммы, календарь открыт; настройки финансов и ФОТ — 403', async () => {
    const list = (await http().get('/api/supply/requests').query({ search: 'Болт с ценой' }).set(as(tokens.manager)).expect(200)).body;
    expect(list.items[0].priceHint).toBe(1500);
    const created = (await http().post('/api/supply/requests').set(as(tokens.manager)).send({ title: 'Гайка', qty: 1, priceHint: 999, clientUid: 'rm-2' }).expect(201)).body;
    expect((await http().get(`/api/supply/requests/${created.id}`).set(as(admin.access)).expect(200)).body.priceHint).toBe(999);
    await http().get('/api/finance/summary').set(as(tokens.manager)).expect(200);
    await http().get('/api/finance/settings').set(as(tokens.manager)).expect(403);
    await http().get('/api/payroll/summary').set(as(tokens.manager)).expect(403);
  });

  it('бухгалтер: видит суммы и календарь; пользователей — нет', async () => {
    const list = (await http().get('/api/supply/requests').query({ search: 'Болт с ценой' }).set(as(tokens.accountant)).expect(200)).body;
    expect(list.items[0].priceHint).toBe(1500);
    await http().get('/api/finance/summary').set(as(tokens.accountant)).expect(200);
    await http().get('/api/admin/users').set(as(tokens.accountant)).expect(403);
  });

  it('директор: всё, что у бухгалтера и менеджера (календарь, правка заявок), но не пользователи', async () => {
    await http().get('/api/finance/summary').set(as(tokens.director)).expect(200);
    await http().post('/api/supply/requests').set(as(tokens.director)).send({ title: 'Шайба', qty: 1, clientUid: 'rm-3' }).expect(201);
    await http().get('/api/admin/users').set(as(tokens.director)).expect(403);
  });

  it('И.1/И.2: история записи «было → стало» (суммы — деньги-ролям и менеджеру), общая история — директору', async () => {
    const r = (await http().post('/api/supply/requests').set(as(admin.access)).send({ title: 'Уголок история', qty: 3, priceHint: 700, clientUid: 'rm-h1' }).expect(201)).body;
    await http().patch(`/api/supply/requests/${r.id}`).set(as(admin.access)).send({ qty: 5, priceHint: 900 }).expect(200);
    const q = { entityType: 'SupplyRequest', entityId: r.id };
    const full = (await http().get('/api/audit-logs/record').query(q).set(as(tokens.director)).expect(200)).body;
    expect(full.items[0].changes).toEqual(expect.arrayContaining([{ field: 'qty', from: 3, to: 5 }, { field: 'priceHint', from: 700, to: 900 }]));
    expect(full.items[full.items.length - 1].first).toBe(true);
    const mgr = (await http().get('/api/audit-logs/record').query(q).set(as(tokens.manager)).expect(200)).body;
    expect(mgr.items[0].changes).toEqual(expect.arrayContaining([{ field: 'qty', from: 3, to: 5 }, { field: 'priceHint', from: 700, to: 900 }]));
    // общая история: директору — да, менеджеру — нет; фильтр по разделу и одной записи
    const app1 = (await http().get('/api/audit-logs/app').query({ entityType: 'SupplyRequest' }).set(as(tokens.director)).expect(200)).body;
    expect(app1.items.some((x: { entityId: string; title: string }) => x.entityId === r.id && x.title.includes('Уголок история'))).toBe(true);
    const one = (await http().get('/api/audit-logs/app').query({ id: app1.items[0].id }).set(as(tokens.director)).expect(200)).body;
    expect(one.items).toHaveLength(1);
    await http().get('/api/audit-logs/app').query({ entityType: 'User' }).set(as(tokens.director)).expect(400);
    await http().get('/api/audit-logs/app').set(as(tokens.manager)).expect(403);
    expect((await http().get('/api/audit-logs/app/users').set(as(tokens.director)).expect(200)).body.length).toBeGreaterThan(0);
    // заказчик (id не ObjectId) — история тоже пишется и читается
    await http().post('/api/partners').set(as(admin.access)).send({ kind: 'customer', name: 'ЗАО История' }).expect(201);
    await http().patch(`/api/partners/${encodeURIComponent('c:ЗАО История')}`).set(as(admin.access)).send({ phone: '+7 1' }).expect(200);
    const ph = (await http().get('/api/audit-logs/record').query({ entityType: 'Partner', entityId: 'c:ЗАО История' }).set(as(tokens.manager)).expect(200)).body;
    expect(ph.items[0].changes).toEqual(expect.arrayContaining([{ field: 'phone', from: null, to: '+7 1' }]));
  });
});
