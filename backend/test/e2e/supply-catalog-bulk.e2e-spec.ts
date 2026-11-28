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

  it('директор оформляет корзину, ограничения раздела, склада и прав записи сохраняются', async () => {
    const login = async (name: string, role: string) => {
      const account = { username: 'bulk-' + name, password: 'bulk-test-pass' };
      await http().post('/api/admin/users').set(auth()).send({ ...account, role }).expect(201);
      const result = await http().post('/api/auth/login').send(account).expect(200);
      return authHeader(result.body.access);
    };
    const director = await login('director', 'director');
    const body = { clientUid: 'bulk-director', items: [{ materialId: String(mFree), qty: 2 }] };
    const endpoint = '/api/supply/requests/bulk';
    const result = await http().post(endpoint).set(director).send(body).expect(201);
    expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0]).toMatchObject({ status: 'requested', qty: 2 });
    const blocked = { ...body, clientUid: 'bulk-blocked' };
    await http().post(endpoint).set(await login('observer', 'user')).send(blocked).expect(403);
    for (const [name, limits] of [
      ['section', { appSections: ['stock'] }],
      ['zone', { appSections: ['requests'], stockCategoryIds: [String(new Types.ObjectId())] }],
    ] as const) {
      const role = await http().post('/api/roles').set(auth()).send({ label: 'Директор ' + name, baseRole: 'director', ...limits }).expect(201);
      await http().post(endpoint).set(await login(name, role.body.name)).send(blocked).expect(403);
    }
    expect(await db().collection('supplyrequests').countDocuments({ clientUid: /^bulk-blocked:/ })).toBe(0);

    const { body: custom } = await http().post('/api/roles').set(auth()).send({ label: 'Оформитель корзины', baseRole: 'user', appSections: ['requests', 'stock'] }).expect(201);
    expect(custom).toMatchObject({ requestCartCreate: false, requestCartCreateOverride: null });
    const clerk = await login('clerk', custom.name);
    const patch = async (id: string, value: boolean | null) => (await http().patch('/api/roles/' + id).set(auth()).send({ requestCartCreate: value }).expect(200)).body;
    expect(await patch(custom.id, true)).toMatchObject({ requestCartCreate: true, requestCartCreateOverride: true });
    await http().post(endpoint).set(clerk).send({ ...body, clientUid: 'bulk-clerk' }).expect(201);
    await http().patch('/api/stock/items/' + mFree).set(clerk).send({ notes: 'правка склада' }).expect(403);
    const roles = (await http().get('/api/roles').set(auth()).expect(200)).body;
    expect(roles.find((r: { id: string }) => r.id === custom.id)).toMatchObject({ requestCartCreate: true });
    expect(await patch(custom.id, null)).toMatchObject({ requestCartCreate: false, requestCartCreateOverride: null });
    await http().post(endpoint).set(clerk).send(blocked).expect(403);
    const directorRole = roles.find((r: { name: string }) => r.name === 'director');
    expect(await patch(directorRole.id, false)).toMatchObject({ requestCartCreate: false, requestCartCreateOverride: false });
    const me = (await http().get('/api/auth/me').set(director).expect(200)).body;
    expect((me.user || me).requestCartCreate).toBe(false);
    await http().post(endpoint).set(director).send(blocked).expect(403);
    expect(await db().collection('supplyrequests').countDocuments({ clientUid: /^bulk-blocked:/ })).toBe(0);
  });
});
