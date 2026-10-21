import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * Иерархия ролей и деньги (решение пользователя 2026-10-20, common/roles-hierarchy.ts):
 * директор ⊃ бухгалтер ⊃ менеджер ⊃ наблюдатель; суммы и платёжный календарь — только админ / директор / бухгалтер.
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
    for (const role of ['manager', 'accountant', 'director']) {
      const username = `rm-${role}-${Date.now()}`;
      await http().post('/api/admin/users').set(as(admin.access)).send({ username, password: 'role-pass-123', role }).expect(201);
      tokens[role] = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
    }
    await http().post('/api/supply/requests').set(as(admin.access)).send({ title: 'Болт с ценой', qty: 2, priceHint: 1500, clientUid: 'rm-1' }).expect(201);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('менеджер: заявки видит без сумм, сумму вписать не может; платёжный календарь — 403', async () => {
    const list = (await http().get('/api/supply/requests').query({ search: 'Болт с ценой' }).set(as(tokens.manager)).expect(200)).body;
    expect(list.items[0].title).toBe('Болт с ценой');
    expect(list.items[0].priceHint).toBeUndefined();
    expect(list.sum).toBeUndefined();
    const created = (await http().post('/api/supply/requests').set(as(tokens.manager)).send({ title: 'Гайка', qty: 1, priceHint: 999, clientUid: 'rm-2' }).expect(201)).body;
    const raw = (await http().get(`/api/supply/requests/${created.id}`).set(as(admin.access)).expect(200)).body;
    expect(raw.priceHint ?? 0).toBe(0);
    await http().get('/api/finance/summary').set(as(tokens.manager)).expect(403);
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
});
