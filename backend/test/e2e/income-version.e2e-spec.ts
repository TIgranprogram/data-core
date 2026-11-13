import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** C049-1: позиция заказа — вторая правка устаревшей версии получает 409 STALE и ничего не затирает. */
describe('C049-1: версия позиции заказа (PATCH /incomes/:id)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(admin.access);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    for (const c of ['salesorders', 'incomes']) await db().collection(c).deleteMany({});
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('две правки с одной версией: первая 200, вторая 409 STALE; без версии — как раньше', async () => {
    const line = (await http().post('/api/incomes').set(auth()).send({ title: 'Скамья В1', qty: 2, unit: 'шт', unitPrice: 100 }).expect(201)).body;
    expect(line.version).toBe(0);

    const a = (await http().patch(`/api/incomes/${line.id}`).set(auth()).send({ qty: 3, version: 0 }).expect(200)).body;
    expect(a).toMatchObject({ qty: 3, version: 1 });

    const b = await http().patch(`/api/incomes/${line.id}`).set(auth()).send({ qty: 9, version: 0 }).expect(409);
    expect(b.body.code).toBe('STALE');
    expect((await http().get(`/api/incomes/${line.id}`).set(auth()).expect(200)).body).toMatchObject({ qty: 3, version: 1 });

    // клиент без версии (внешний ключ, старая вкладка) — пишет, версия растёт
    const c = (await http().patch(`/api/incomes/${line.id}`).set(auth()).send({ qty: 4 }).expect(200)).body;
    expect(c).toMatchObject({ qty: 4, version: 2 });
  });

  it('служебная правка шапки заказа не меняет версию позиций', async () => {
    const order = (await http().post('/api/salesorders').set(auth()).send({ orderNo: 'В-2', customer: 'Школа', stage: 'new' }).expect(201)).body.id as string;
    const line = (await http().post('/api/incomes').set(auth()).send({ orderId: order, title: 'Урна В2', qty: 1, unit: 'шт', unitPrice: 50 }).expect(201)).body;
    await http().patch(`/api/salesorders/${order}`).set(auth()).send({ customer: 'Школа №2' }).expect(200);
    const after = (await http().get(`/api/incomes/${line.id}`).set(auth()).expect(200)).body;
    expect(after.customer).toBe('Школа №2');
    expect(after.version).toBe(line.version);
  });
});
