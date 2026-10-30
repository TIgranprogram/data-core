import request from 'supertest';
import { Types } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** Гонки на складе: параллельные списания и брони одного остатка не уводят его в минус и не бронируют лишнего. */
describe('Склад: параллельные операции с одним остатком', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);

  const mkItem = async (name: string, qty: number) => {
    const it = (await http().post('/api/stock/items').set(auth()).send({ name, unit: 'шт', categoryName: 'Метизы' }).expect(201)).body;
    await http().post(`/api/stock/items/${it.id}/move`).set(auth()).send({ type: 'in', qty }).expect(201);
    return it.id as string;
  };
  const state = async (id: string) => {
    const si = await db().collection('storageitems').findOne({ materialId: new Types.ObjectId(id) });
    return { quantity: Number(si!.quantity), reserved: Number(si!.reservedQty ?? 0) };
  };
  const move = (id: string, body: object) => http().post(`/api/stock/items/${id}/move`).set(auth()).send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['materials', 'storageitems', 'stockmovements', 'reservations', 'warehouses']) await db().collection(c).deleteMany({});
    await db().collection('warehouses').insertOne({ name: 'Главный склад', type: 'main', isActive: true, isDefault: true, deletedAt: null, createdAt: new Date() });
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('два параллельных списания по 8 из 10: одно проходит, второе отказ, остаток 2, не минус, ни одного 500', async () => {
    const id = await mkItem('Болт гонка-1', 10);
    const res = await Promise.all([move(id, { type: 'out', qty: 8 }), move(id, { type: 'out', qty: 8 })]);
    const codes = res.map((r) => r.status).sort();
    expect(codes.filter((c) => c >= 500)).toEqual([]);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 400 || c === 409)).toHaveLength(1);
    expect(await state(id)).toMatchObject({ quantity: 2 });
    const outs = await db().collection('stockmovements').find({ materialId: new Types.ObjectId(id), type: 'out' }).toArray();
    expect(outs).toHaveLength(1);
    expect(outs.reduce((a, m) => a + Number(m.qty), 0)).toBeLessThanOrEqual(10);
  });

  it('пять параллельных списаний по 3 из 10: выдано не больше 10, итог не отрицательный и сходится с журналом', async () => {
    const id = await mkItem('Болт гонка-2', 10);
    const res = await Promise.all(Array.from({ length: 5 }, () => move(id, { type: 'out', qty: 3 })));
    expect(res.filter((r) => r.status >= 500)).toEqual([]);
    const ok = res.filter((r) => r.status === 201).length;
    expect(ok).toBeLessThanOrEqual(3);
    const st = await state(id);
    expect(st.quantity).toBeGreaterThanOrEqual(0);
    expect(st.quantity).toBe(10 - ok * 3);
    const outs = await db().collection('stockmovements').find({ materialId: new Types.ObjectId(id), type: 'out' }).toArray();
    expect(outs.reduce((a, m) => a + Number(m.qty), 0)).toBe(ok * 3);
    expect(ok).toBe(3); // 10 хватает ровно на три списания по 3
  });

  it('параллельные списания пакетом («Операции») по 6 из 10: выдано не больше остатка', async () => {
    const id = await mkItem('Болт гонка-3', 10);
    const b = () => http().post('/api/stock/batch').set(auth()).send({ type: 'out', lines: [{ materialId: id, qty: 6 }] });
    const res = await Promise.all([b(), b()]);
    expect(res.filter((r) => r.status >= 500)).toEqual([]);
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await state(id)).toMatchObject({ quantity: 4 });
  });

  it('две параллельные брони по 7 на остаток 10: бронь одна, reservedQty 7, не 14', async () => {
    const id = await mkItem('Болт гонка-4', 10);
    const res = await Promise.all([move(id, { type: 'reserve', qty: 7, note: 'Заказ А' }), move(id, { type: 'reserve', qty: 7, note: 'Заказ Б' })]);
    expect(res.filter((r) => r.status >= 500)).toEqual([]);
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(res.filter((r) => r.status === 400 || r.status === 409)).toHaveLength(1);
    expect(await state(id)).toEqual({ quantity: 10, reserved: 7 });
    const active = await db().collection('reservations').find({ materialId: new Types.ObjectId(id), status: 'active' }).toArray();
    expect(active.reduce((a, r) => a + Number(r.qty), 0)).toBe(7);
  });

  it('две параллельные брони по 5 на остаток 10 — обе проходят, свободно 0; третья после этого — 400', async () => {
    const id = await mkItem('Болт гонка-5', 10);
    const res = await Promise.all([move(id, { type: 'reserve', qty: 5, note: 'Заказ А' }), move(id, { type: 'reserve', qty: 5, note: 'Заказ Б' })]);
    expect(res.map((r) => r.status)).toEqual([201, 201]);
    expect(await state(id)).toEqual({ quantity: 10, reserved: 10 });
    await move(id, { type: 'reserve', qty: 1 }).expect(400);
  });

  it('бронь и списание одновременно по 8 из 10: остаток не отрицательный, бронь не выше остатка', async () => {
    const id = await mkItem('Болт гонка-6', 10);
    const res = await Promise.all([move(id, { type: 'reserve', qty: 8, note: 'Заказ' }), move(id, { type: 'out', qty: 8 })]);
    expect(res.filter((r) => r.status >= 500)).toEqual([]);
    const st = await state(id);
    expect(st.quantity).toBeGreaterThanOrEqual(0);
    expect(st.reserved).toBeLessThanOrEqual(st.quantity);
  });
});
