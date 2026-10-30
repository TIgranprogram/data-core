import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** Оплата позиции глазами экрана: те же тела запросов, что шлёт pwa/sections/orders.js. Аудит 2026-10-30: правка позиции стирала платежи. */
describe('Оплата позиции и форма', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  const db = () => ctx!.connection.db!;
  const get = async (id: string) => (await http().get(`/api/incomes/${id}`).set(auth()).expect(200)).body;
  const line = async () => (await http().post('/api/incomes').set(auth()).send({ title: 'Скамья', qty: 1, unitPrice: 100000, shipDate: '2026-10-01' }).expect(201)).body;
  const formBody = (r: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    title: r.title, qty: r.qty, unitPrice: r.unitPrice, color: '', notes: '', shipDate: '2026-10-01', paidDate: r.paidDate ? String(r.paidDate).slice(0, 10) : '', ...over,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    await db().collection('incomes').deleteMany({});
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('аванс переживает сохранение формы: платёж на месте, позиция не «оплачена целиком»', async () => {
    const r = await line();
    const paid = (await http().post(`/api/incomes/${r.id}/payments`).set(auth()).send({ date: '2026-10-05', amount: 30000 }).expect(200)).body;
    expect(paid.paidAmount).toBe(30000);
    await http().patch(`/api/incomes/${r.id}`).set(auth()).send(formBody(paid, { color: 'серый' })).expect(200);
    const after = await get(r.id);
    expect(after.color).toBe('серый');
    expect(after.paidAmount).toBe(30000);
    expect(after.payments).toHaveLength(1);
  });

  it('форма без поля даты при платежах сохраняется; изменённая дата — 400 с понятным текстом', async () => {
    const r = await line();
    const paid = (await http().post(`/api/incomes/${r.id}/payments`).set(auth()).send({ date: '2026-10-05', amount: 10000 }).expect(200)).body;
    const { paidDate: _skip, ...noDate } = formBody(paid);
    await http().patch(`/api/incomes/${r.id}`).set(auth()).send(noDate).expect(200);
    const bad = await http().patch(`/api/incomes/${r.id}`).set(auth()).send(formBody(paid, { paidDate: '2026-10-06' })).expect(400);
    expect(JSON.stringify(bad.body)).toContain('Дату оплаты');
    expect((await get(r.id)).paidAmount).toBe(10000);
  });

  it('«Отменить оплату» снимает и платежи, и оплату старого вида', async () => {
    const r = await line();
    await http().post(`/api/incomes/${r.id}/payments`).set(auth()).send({ date: '2026-10-05', amount: 100000 }).expect(200);
    await http().patch(`/api/incomes/${r.id}`).set(auth()).send({ payments: [] }).expect(200);
    const a = await get(r.id);
    expect(a.paidAmount ?? 0).toBe(0);
    expect(a.paidDate ?? null).toBeNull();
    const old = await line();
    await http().patch(`/api/incomes/${old.id}`).set(auth()).send({ paidDate: '2026-10-05' }).expect(200);
    expect((await get(old.id)).paidAmount).toBe(100000);
    await http().patch(`/api/incomes/${old.id}`).set(auth()).send({ payments: [] }).expect(200);
    expect((await get(old.id)).paidDate ?? null).toBeNull();
  });

  it('повтор с тем же clientUid не даёт второго платежа; два разных параллельно — оба или 409, без потери', async () => {
    const r = await line();
    const body = { date: '2026-10-05', amount: 1000, clientUid: 'pay-1' };
    await http().post(`/api/incomes/${r.id}/payments`).set(auth()).send(body).expect(200);
    await http().post(`/api/incomes/${r.id}/payments`).set(auth()).send(body).expect(200);
    expect((await get(r.id)).payments).toHaveLength(1);
    const two = await Promise.all([1, 2].map((n) => http().post(`/api/incomes/${r.id}/payments`).set(auth()).send({ date: '2026-10-06', amount: n * 100 })));
    const ok = two.filter((x) => x.status === 200).length;
    expect(two.every((x) => x.status === 200 || x.status === 409)).toBe(true);
    const a = await get(r.id);
    expect(a.payments).toHaveLength(1 + ok);
  });

  it('удаление платежа: сумма не совпала — 409, совпала — удаляется', async () => {
    const r = await line();
    await http().post(`/api/incomes/${r.id}/payments`).set(auth()).send({ date: '2026-10-05', amount: 500 }).expect(200);
    await http().delete(`/api/incomes/${r.id}/payments/0`).query({ amount: 777 }).set(auth()).expect(409);
    await http().delete(`/api/incomes/${r.id}/payments/0`).query({ amount: 500 }).set(auth()).expect(200);
    expect((await get(r.id)).payments ?? []).toHaveLength(0);
  });
});
