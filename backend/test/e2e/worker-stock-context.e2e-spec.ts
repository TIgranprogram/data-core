import request from 'supertest';
import { Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';

/** C271: только изолированная test-БД; прод и чужые БД не трогаем. */
describe('C271 — ADRESNYI kontekst materiala: HTTP i Mongo (worker)', () => {
  let ctx: TestContext, admin: string, manager: string, observer: string;
  let ownItem: string, foreignItem: string, ownCategory: string, foreignCategory: string, ownZone: string;
  const http = () => request(ctx.app.getHttpServer());
  const auth = (token = admin) => authHeader(token);
  const db = () => ctx.connection.db!;
  const account = async (name: string, role: string) => {
    const username = `c271-${name}`;
    await http().post('/api/admin/users').set(auth()).send({ username, role, password: 'c271-test-password' }).expect(201);
    return (await http().post('/api/auth/login').send({ username, password: 'c271-test-password' }).expect(200)).body;
  };

  beforeAll(async () => {
    const testDb = process.env.MONGO_DB_TEST ?? 'datacore-test';
    if (!testDb.startsWith('datacore-test')) throw Error('C271: только изолированная datacore-test* БД');
    ctx = await createTestApp({ strictValidation: true });
    admin = (await loginAsAdmin(ctx.app)).access;
    ownItem = (await http().post('/api/stock/items').set(auth()).send({ name: 'C271 своя труба', unit: 'м', categoryName: 'C271 трубы' }).expect(201)).body.id;
    foreignItem = (await http().post('/api/stock/items').set(auth()).send({ name: 'C271 чужой лист', unit: 'м²', categoryName: 'C271 листы' }).expect(201)).body.id;
    const categories = (await http().get('/api/stock/categories').set(auth()).expect(200)).body.items;
    ownCategory = categories.find((row: { name: string }) => row.name === 'C271 трубы').id;
    foreignCategory = categories.find((row: { name: string }) => row.name === 'C271 листы').id;
    ownZone = (await http().post('/api/stockzones').set(auth()).send({ name: 'C271 своя зона', categoryIds: [ownCategory] }).expect(201)).body.id;
    const worker = (await http().post('/api/roles').set(auth()).send({ label: 'C271 кладовщик', baseRole: 'manager',
      appSections: ['stock'], money: false, warehouseIds: [ownZone], stockCategoryIds: [ownCategory] }).expect(201)).body;
    manager = (await account('manager', worker.name)).access;
    const observerRole = (await http().post('/api/roles').set(auth()).send({ label: 'C271 наблюдатель', baseRole: 'user',
      appSections: ['stock'], warehouseIds: [ownZone], stockCategoryIds: [ownCategory] }).expect(201)).body;
    observer = (await account('observer', observerRole.name)).access;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('POST создаёт узкую заявку, строгая идемпотентность по UUID, чужой материал и readonly недоступны', async () => {
    const url = `/api/stock/items/${ownItem}/request`, uuid = randomUUID();
    const first = await http().post(url).set(auth(manager)).send({ qty: 7, clientUid: uuid }).expect(201);
    expect(first.body).toMatchObject({ materialId: ownItem, qty: 7, unit: 'м', status: 'requested' });
    expect(typeof first.body.id).toBe('string'); expect(typeof first.body.num).toBe('number');
    for (const key of ['price', 'sum', 'total', 'supplierId', 'categoryId', 'requestDate', 'paid']) expect(first.body).not.toHaveProperty(key);
    const repeat = await http().post(url).set(auth(manager)).send({ qty: 7, clientUid: uuid.toUpperCase() }).expect(201);
    expect(repeat.body.id).toBe(first.body.id);
    await http().post(url).set(auth(manager)).send({ qty: 8, clientUid: uuid }).expect(409);
    for (const body of [{ qty: '7', clientUid: randomUUID() }, { qty: 0, clientUid: randomUUID() },
      { qty: 7, clientUid: 'not-uuid' }, { qty: 7, clientUid: randomUUID(), price: 1 }, {}]) {
      await http().post(url).set(auth(manager)).send(body).expect(400);
    }
    await http().post(url).query({ unknown: '1' }).set(auth(manager)).send({ qty: 2, clientUid: randomUUID() }).expect(400);
    await http().post(url).set(auth(observer)).send({ qty: 2, clientUid: randomUUID() }).expect(403);
    await http().post(`/api/stock/items/${foreignItem}/request`).set(auth(manager)).send({ qty: 2, clientUid: randomUUID() }).expect(403);
    await http().post('/api/stock/items/000000000000000000000000/request').set(auth(manager)).send({ qty: 2, clientUid: randomUUID() }).expect(404);
    const docs = await db().collection('supplyrequests').find({ materialId: new Types.ObjectId(first.body.materialId) }).toArray();
    expect(docs).toHaveLength(1); // повтор и все rejects без записи
  });

  it('C262 off закрывает новый POST, общий requests раздел у stock-роли остаётся закрытым', async () => {
    const flag = 'c262.supply.requests.api';
    await http().put(`/api/feature-flags/${flag}`).set(auth()).send({ enabledByDefault: false }).expect(200);
    await http().post(`/api/stock/items/${ownItem}/request`).set(auth(manager)).send({ qty: 1, clientUid: randomUUID() }).expect(409);
    await http().put(`/api/feature-flags/${flag}`).set(auth()).send({ enabledByDefault: true }).expect(200);
    await http().post('/api/supply/requests').set(auth(manager)).send({ title: 'C271 вне раздела', unit: 'м', qty: 1 }).expect(403);
  });

  it('GET адресных броней: строгая пагинация, безопасные поля и scope; старый список не задет', async () => {
    await http().post('/api/stock/batch').set(auth()).send({ type: 'in', lines: [{ materialId: ownItem, qty: 20 }] }).expect(201);
    for (const groupName of ['C271 бронь 1', 'C271 бронь 2', 'C271 бронь 3']) {
      await http().post('/api/stock/reserve-list').set(auth()).send({ groupName, lines: [{ materialId: ownItem, qty: 3 }], clientUid: randomUUID() }).expect(201);
    }
    const url = `/api/stock/items/${ownItem}/reservations`;
    const list = await http().get(url).set(auth(manager)).query({ page: 1, limit: 2 }).expect(200);
    expect(list.body).toMatchObject({ page: 1, limit: 2, total: 3 });
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items[0]).toMatchObject({ materialId: ownItem, qty: 3, unit: 'м', salesOrderId: null,
      salesOrderLineId: null, salesOrder: null, hanging: null });
    expect(typeof list.body.items[0].id).toBe('string');
    expect(typeof list.body.items[0].orderId).toBe('string');
    expect((await http().get(url).set(auth(observer)).query({ page: 2, limit: 2 }).expect(200)).body.items).toHaveLength(1);
    for (const query of [{ page: 0 }, { limit: 101 }, { page: 1.5 }, { limit: '' }, { unknown: '1' }]) {
      await http().get(url).set(auth(manager)).query(query).expect(400);
    }
    await http().get(`/api/stock/items/${foreignItem}/reservations`).set(auth(manager)).expect(403);
    expect((await http().get('/api/stock/reservations').set(auth(manager)).expect(200)).body.items.length).toBeGreaterThan(0);
  });
});
