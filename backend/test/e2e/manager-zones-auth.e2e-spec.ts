import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, TEST_ADMIN_PASSWORD, TEST_ADMIN_USERNAME, type AuthTokens } from '../setup/admin.fixture';

/** Менеджер и деньги снабжения (ФОТ закрыт), зоны/сотрудники, remember/refresh. */
describe('Manager money, zones, auth remember', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  const tok: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp(); app = ctx.app; admin = await loginAsAdmin(app);
    for (const role of ['manager', 'director', 'user']) {
      const username = `mz-${role}-${Date.now()}`;
      await http().post('/api/admin/users').set(as(admin.access)).send({ username, password: 'role-pass-123', role }).expect(201);
      tok[role] = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
    }
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('менеджер: сохраняет priceHint заявки и amount счёта, ставит «оплачено»; /payroll — 403', async () => {
    const m = tok.manager;
    const req = (await http().post('/api/supply/requests').set(as(m)).send({ title: 'Болт М', qty: 1, unit: 'шт', supplierName: 'Крепёж М', priceHint: 120, clientUid: 'mz-1' }).expect(201)).body;
    expect((await http().get(`/api/supply/requests/${req.id}`).set(as(m)).expect(200)).body.priceHint).toBe(120);
    const inv = (await http().post('/api/supply/invoices').set(as(m)).send({ requestIds: [req.id] }).expect(201)).body.items[0];
    const org = await db().collection('organizations').findOne({ name: 'Крепёж М' });
    const p = await http().patch(`/api/supply/invoices/${inv.id}`).set(as(m)).send({ no: 'М-1', date: '2026-10-29', amount: 120, issue: true, payerCompanyId: String(org!._id) }).expect(200);
    expect(p.body.amount).toBe(120);
    const paid = await http().post(`/api/supply/invoices/${inv.id}/pay`).set(as(m)).expect(200);
    expect(paid.body.status).toBe('paid');
    await http().get('/api/payroll/summary').set(as(m)).expect(403);
    await http().get('/api/payroll/payments').set(as(m)).expect(403);
  });

  it('менеджер: PATCH priceHint существующей заявки проходит (200)', async () => {
    const req = (await http().post('/api/supply/requests').set(as(tok.manager)).send({ title: 'Гайка М', qty: 1, unit: 'шт', priceHint: 10, clientUid: 'mz-2' }).expect(201)).body;
    await http().patch(`/api/supply/requests/${req.id}`).set(as(tok.manager)).send({ priceHint: 15 }).expect(200);
    expect((await http().get(`/api/supply/requests/${req.id}`).set(as(admin.access)).expect(200)).body.priceHint).toBe(15);
  });

  it('зоны: director проходит PUT /staff/:id/zones, manager — 403', async () => {
    await http().post('/api/zones').set(as(admin.access)).send({ code: 'mz_zone', name: 'Зона М' }).expect(201);
    const pid = new Types.ObjectId();
    await db().collection('persons').insertOne({ _id: pid, firstName: 'Иван', lastName: 'Зонов', phone: '+7 900', deletedAt: null, createdAt: new Date(), updatedAt: new Date() });
    await http().put(`/api/staff/${pid}/zones`).set(as(tok.manager)).send({ zoneCodes: ['mz_zone'] }).expect(403);
    const r = await http().put(`/api/staff/${pid}/zones`).set(as(tok.director)).send({ zoneCodes: ['mz_zone'] }).expect(200);
    expect(r.body.zoneCodes).toEqual(['mz_zone']);
    await http().put(`/api/staff/${pid}/zones`).set(as(tok.director)).send({ zoneCodes: ['нет_такой'] }).expect(400);
  });

  it('/staff для user: 200, без phone и login', async () => {
    const r = await http().get('/api/staff').set(as(tok.user)).expect(200);
    const row = r.body.items.find((x: { name: string }) => x.name.includes('Зонов'));
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('phone');
    expect(row).not.toHaveProperty('login');
    expect(row).not.toHaveProperty('hasLogin');
    expect(row.zoneCodes).toEqual(['mz_zone']);
    const full = (await http().get('/api/staff').set(as(tok.director)).expect(200)).body.items.find((x: { name: string }) => x.name.includes('Зонов'));
    expect(full.phone).toBe('+7 900');
  });

  it('login remember=false: cookie без maxAge; refresh отдаёт новый refresh-cookie (тоже сессионный)', async () => {
    const res = await http().post('/api/auth/login').send({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD, remember: false }).expect(200);
    const cookie = ((res.headers['set-cookie'] as unknown as string[]) ?? []).find((c) => c.startsWith('refreshToken='))!;
    expect(cookie).toBeDefined();
    expect(cookie).not.toMatch(/Max-Age|Expires/i);
    const refresh = cookie.split('refreshToken=')[1].split(';')[0];
    await new Promise((r) => setTimeout(r, 1100)); // iat другой -> токен другой
    const r2 = await http().post('/api/auth/refresh').set(as(refresh)).send({}).expect(200);
    const c2 = ((r2.headers['set-cookie'] as unknown as string[]) ?? []).find((c) => c.startsWith('refreshToken='))!;
    expect(c2).toBeDefined();
    expect(c2).not.toMatch(/Max-Age|Expires/i);
    expect(c2.split('refreshToken=')[1].split(';')[0]).not.toBe(refresh);
    expect(r2.body.access).toBeDefined();
    // remember по умолчанию — cookie с maxAge
    const def = await http().post('/api/auth/login').send({ username: TEST_ADMIN_USERNAME, password: TEST_ADMIN_PASSWORD }).expect(200);
    expect(((def.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('refreshToken=')))).toMatch(/Max-Age|Expires/i);
  });
});
