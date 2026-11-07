import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** C036: каталог «вся номенклатура» (view=all, $unionWith на Mongo 4.4) и заявки пачкой. */
describe('Supply catalog view=all + requests/bulk', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  const sup = new Types.ObjectId(), mOffer = new Types.ObjectId(), mFree = new Types.ObjectId(), mFree2 = new Types.ObjectId();

  beforeAll(async () => {
    ctx = await createTestApp(); app = ctx.app; token = await loginAsAdmin(app);
    for (const c of ['supplieritems', 'materials', 'supplyrequests', 'organizations', 'storageitems']) await db().collection(c).deleteMany({});
    await db().collection('organizations').insertOne({ _id: sup, name: 'Поставщик C036', deletedAt: null });
    await db().collection('materials').insertMany([
      { _id: mOffer, name: 'С предложением', article: 'C36-A', deletedAt: null },
      { _id: mFree, name: 'Без предложения 1', article: 'C36-B', deletedAt: null },
      { _id: mFree2, name: 'Без предложения 2', article: 'C36-C', deletedAt: null },
    ]);
    await db().collection('supplieritems').insertOne({ supplierId: sup, materialId: mOffer, article: 'S1', name: 'Оффер', priceHint: 10, deletedAt: null, priceHistory: [] });
  });
  afterAll(async () => { await ctx?.cleanup(); });

  const names = (r: { body: { items: { name: string }[] } }) => r.body.items.map((i) => i.name).sort();

  it('view=all: предложение + материалы без предложения, total сходится', async () => {
    const r = await http().get('/api/supply/catalog/items?view=all').set(auth()).expect(200);
    expect(r.body.total).toBe(3);
    expect(names(r)).toEqual(expect.arrayContaining(['Без предложения 1', 'Без предложения 2', 'Оффер']));
    expect(r.body.items.some((i: { kind?: string }) => i.kind === 'material')).toBe(true);
  });

  it('view=all&supplierId=none: только материалы без предложений', async () => {
    const r = await http().get('/api/supply/catalog/items?view=all&supplierId=none').set(auth()).expect(200);
    expect(r.body.total).toBe(2);
    expect(names(r)).toEqual(['Без предложения 1', 'Без предложения 2']);
    expect(r.body.items.every((i: { kind?: string }) => i.kind === 'material')).toBe(true);
  });

  it('без view=all материалы без предложений не видны', async () => {
    const r = await http().get('/api/supply/catalog/items').set(auth()).expect(200);
    expect(r.body.total).toBe(1);
  });

  it('requests/bulk: 2 строки → 2 заявки; повтор clientUid — без новых', async () => {
    const body = { clientUid: 'c036-bulk-1', items: [{ materialId: String(mFree), qty: 2 }, { materialId: String(mFree2), qty: 5, supplierId: String(sup) }] };
    const r = await http().post('/api/supply/requests/bulk').set(auth()).send(body).expect(201);
    expect(r.body.total).toBe(2);
    expect(await db().collection('supplyrequests').countDocuments({ clientUid: /^c036-bulk-1:/ })).toBe(2);
    const again = await http().post('/api/supply/requests/bulk').set(auth()).send(body);
    expect(await db().collection('supplyrequests').countDocuments({ clientUid: /^c036-bulk-1:/ })).toBe(2);
    if (again.status < 300) expect(again.body.items.map((i: { id: string }) => i.id).sort()).toEqual(r.body.items.map((i: { id: string }) => i.id).sort());
  });

  it('requests/bulk: дубль позиции в пачке и пустой список — 400', async () => {
    const line = { materialId: String(mFree), qty: 1 };
    await http().post('/api/supply/requests/bulk').set(auth()).send({ clientUid: 'c036-dup', items: [line, line] }).expect(400);
    await http().post('/api/supply/requests/bulk').set(auth()).send({ clientUid: 'c036-empty', items: [] }).expect(400);
  });
});
