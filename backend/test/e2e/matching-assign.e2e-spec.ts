import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * Сопоставление договоров (CONTRACT-MATCHING §7 КМ3/КМ4/КМ8) и категория паспорта (PASSPORT-CATEGORY):
 * assign блокируется несопоставленными позициями (400 + unmatched), повтор — 409, роль user читает очередь, но не правит,
 * PUT passport-defaults без passportCategory снимает ручную категорию.
 */
describe('Matching + assign + passport category', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  let userTok = '';
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(admin.access);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    for (const c of ['salesorders', 'incomes', 'productaliases', 'products']) await db().collection(c).deleteMany({});
    const username = `mt-user-${Date.now()}`;
    await http().post('/api/admin/users').set(auth()).send({ username, password: 'role-pass-123', role: 'user' }).expect(201);
    userTok = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('assign: несопоставленная позиция — 400 с unmatched; после «не изделие»/подтверждения — 200; повтор — 409; назначенный не ломается', async () => {
    const o = (await http().post('/api/salesorders').set(auth()).send({ orderNo: 'МТ-1', customer: 'Школа', stage: 'new' }).expect(201)).body.id;
    const empty = (await http().post('/api/salesorders').set(auth()).send({ orderNo: 'МТ-0', customer: 'Пусто', stage: 'new' }).expect(201)).body.id;
    const prod = (await http().post('/api/showcase').set(auth()).send({ sku: 'MT-P1', name: 'Лавочка', type: 'Благоустройство' }).expect(201)).body.id;
    const l1 = (await http().post('/api/incomes').set(auth()).send({ orderId: o, title: 'Монтаж', qty: 1, unit: 'шт' }).expect(201)).body.id;
    const l2 = (await http().post('/api/incomes').set(auth()).send({ orderId: o, title: 'Изделие без аналога ZZ', qty: 1, unit: 'шт' }).expect(201)).body.id;

    const bad = await http().post('/api/production-orders/assign').set(auth()).send({ contractIds: [o] }).expect(400);
    expect(bad.body.unmatched[0]).toMatchObject({ orderId: o, total: 2, unmatched: 2 });
    expect(bad.body.message).toMatch(/не сопоставлено 2 из 2/);
    await http().post('/api/production-orders/assign').set(auth()).send({ contractIds: [empty] }).expect(400); // нет позиций

    await http().post('/api/matching/none').set(auth()).send({ lineId: l1 }).expect(200);
    await http().post('/api/production-orders/assign').set(auth()).send({ contractIds: [o] }).expect(400); // осталась одна
    await http().post('/api/matching/confirm').set(auth()).send({ lineId: l2, productId: prod }).expect(200);
    await http().post('/api/matching/confirm').set(auth()).send({ lineId: l2, productId: prod }).expect(200); // повтор не падает
    const ok = (await http().post('/api/production-orders/assign').set(auth()).send({ contractIds: [o] }).expect(200)).body;
    expect(JSON.stringify(ok)).toMatch(/-\d\d/);
    await http().post('/api/production-orders/assign').set(auth()).send({ contractIds: [o] }).expect(409);
  });

  it('роль user: очередь и счётчик читает, подтверждать — 403', async () => {
    const o = (await http().post('/api/salesorders').set(auth()).send({ orderNo: 'МТ-2', customer: 'Лицей', stage: 'new' }).expect(201)).body.id;
    const l = (await http().post('/api/incomes').set(auth()).send({ orderId: o, title: 'Урна', qty: 1, unit: 'шт' }).expect(201)).body.id;
    const u = { Authorization: `Bearer ${userTok}` };
    const q = await http().get('/api/matching/unmatched').set(u);
    expect(q.status).toBe(200);
    expect(q.body).toHaveProperty('items');
    expect((await http().get('/api/matching/unmatched/count').set(u)).status).toBe(200);
    await http().post('/api/matching/none').set(u).send({ lineId: l }).expect(403);
  });

  it('PUT passport-defaults: ручная категория ставится, а тело без passportCategory её снимает', async () => {
    const p = (await http().post('/api/showcase').set(auth()).send({ sku: 'MT-P2', name: 'Турник', type: 'Спорт' }).expect(201)).body.id;
    await http().put(`/api/showcase/${p}/passport-defaults`).set(auth()).send({ passportCategory: 'TRN', isKit: true }).expect(200);
    const a = (await http().get(`/api/showcase/${p}`).set(auth()).expect(200)).body;
    expect(a.passportDefaults.passportCategory).toBe('TRN');
    expect(a.passportCategory.own.code).toBe('TRN');
    await http().put(`/api/showcase/${p}/passport-defaults`).set(auth()).send({ isKit: true }).expect(200);
    const b = (await http().get(`/api/showcase/${p}`).set(auth()).expect(200)).body;
    expect(b.passportDefaults.passportCategory ?? null).toBeNull();
    expect(b.passportCategory?.own ?? null).toBeNull();
    await http().put(`/api/showcase/${p}/passport-defaults`).set(auth()).send({ passportCategory: 'XXX' }).expect(400);
  });
});
