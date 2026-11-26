import request from 'supertest';
import { Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';

/** C271: только изолированная test-БД; прод и чужые БД не трогаем. */
describe('C271 — адресный контекст материала: HTTP и Mongo', () => {
  let ctx: TestContext, admin: string, manager: string, observer: string, requestEditor: string;
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
    const requestRole = (await http().post('/api/roles').set(auth()).send({ label: 'C275 редактор заявок', baseRole: 'manager',
      appSections: ['requests'], warehouseIds: [ownZone], stockCategoryIds: [ownCategory] }).expect(201)).body;
    requestEditor = (await account('request-editor', requestRole.name)).access;
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

  it('гонка сохраняет одну заявку, повтор читает её текущий остаток', async () => {
    const url = `/api/stock/items/${ownItem}/request`;
    const input = { qty: 10, clientUid: randomUUID() };
    const send = (body = input) => http().post(url).set(auth(manager)).set('Idempotency-Key', input.clientUid).send(body);
    const [first, second] = await Promise.all([send().expect(201), send().expect(201)]);
    expect(first.body).toEqual(second.body);
    const requests = db().collection('supplyrequests');
    const id = new Types.ObjectId(first.body.id);
    const saved = await requests.findOne({ _id: id });
    expect(saved?.requestedBy).toMatch(/^[0-9a-f]{24}$/);
    expect(String(saved?.createdBy)).toBe(saved?.requestedBy);
    expect(await requests.countDocuments({ clientUid: saved?.clientUid })).toBe(1);
    await requests.updateOne({ _id: id }, { $set: { qty: 7, receivedQty: 3 } });
    expect((await send().expect(201)).body).toMatchObject({ id: first.body.id, qty: 7 });
    await send({ ...input, qty: 11 }).expect(409);
    await requests.updateOne({ _id: id }, { $set: { materialId: new Types.ObjectId(foreignItem) } });
    await send().expect(409);
    await requests.updateOne({ _id: id }, { $set: { materialId: new Types.ObjectId(ownItem) } });

    const flagUrl = '/api/feature-flags/c262.supply.requests.api';
    await http().put(flagUrl).set(auth()).send({ enabledByDefault: false }).expect(200);
    await send().expect(409);
    await http().get(`/api/stock/items/${ownItem}/requests`).set(auth(observer)).expect(200);
    await http().put(flagUrl).set(auth()).send({ enabledByDefault: true }).expect(200);
    const materials = db().collection('materials');
    const material = { _id: new Types.ObjectId(ownItem) };
    await materials.updateOne(material, { $set: { deletedAt: new Date() } });
    await send().expect(404);
    await http().get(`/api/stock/items/${ownItem}/requests`).set(auth(observer)).expect(404);
    await materials.updateOne(material, { $set: { deletedAt: null } });

    const audit = await db().collection('auditlogs').find({ action: 'supply.request.created', entityType: 'SupplyRequest', entityId: id }).toArray();
    expect(audit).toHaveLength(1);
    expect(String(audit[0].userId)).toBe(saved?.requestedBy);
    expect(audit[0]).toMatchObject({ userName: 'c271-manager', details: { after: first.body } });
  });

  it('адресные страницы возвращают старую бронь закрытого заказа за глобальным лимитом', async () => {
    const materialId = new Types.ObjectId(ownItem);
    const otherMaterialId = new Types.ObjectId(foreignItem);
    const salesOrderId = new Types.ObjectId();
    const targetId = new Types.ObjectId();
    const batchId = new Types.ObjectId();
    const createdAt = new Date('2025-01-01T00:00:00.000Z');
    const base = { status: 'active', isActive: true, deletedAt: null, qty: 7, issuedQty: 3, batchId };
    const reservations = db().collection('reservations');
    await db().collection('salesorders').insertOne({ _id: salesOrderId, orderNo: 'C271-закрыт', stage: 'closed', amount: 999 });
    await reservations.insertMany([
      { ...base, _id: targetId, materialId, createdAt: new Date('2020-01-01T00:00:00.000Z'), salesOrderId, groupName: 'Назначение' },
      ...Array.from({ length: 102 }, () => ({ ...base, materialId, createdAt })),
      ...Array.from({ length: 2001 }, () => ({ ...base, materialId: otherMaterialId, createdAt })),
      { ...base, materialId, status: 'cancelled', createdAt },
      { ...base, materialId, isActive: false, createdAt },
      { ...base, materialId, deletedAt: createdAt, createdAt },
    ]);
    const read = (page: number) => http().get(`/api/stock/items/${ownItem}/reservations`).set(auth(observer)).query({ page, limit: 100 }).expect(200);
    const [first, second] = await Promise.all([read(1), read(2)]);
    expect(first.body.total).toBe(second.body.total);
    expect(first.body.total).toBe(106);
    const items = [...first.body.items, ...second.body.items];
    expect(new Set(items.map(item => item.id)).size).toBe(106);
    expect(items.every(item => item.materialId === ownItem)).toBe(true);
    expect(items.at(-1)).toMatchObject({ id: String(targetId), qty: 7, unit: 'м', groupName: 'Назначение', salesOrder: 'C271-закрыт', hanging: expect.any(String) });
    expect(items.at(-1)).not.toHaveProperty('amount');
  });

  it('GET ожиданий возвращает все страницы с узкой проекцией для обеих native ролей', async () => {
    const materialId = new Types.ObjectId(ownItem);
    const supplierId = new Types.ObjectId();
    const archivedSupplierId = new Types.ObjectId();
    const invoiceId = new Types.ObjectId();
    const archivedInvoiceId = new Types.ObjectId();
    const requestDate = new Date('2025-02-01T00:00:00.000Z');
    const deliveryDate = new Date('2025-02-16T00:00:00.000Z');
    const deletedAt = new Date();
    await db().collection('organizations').insertMany([
      { _id: supplierId, inn: '2710000001', name: 'Поставщик C271', shortName: 'C271', amount: 1000 },
      { _id: archivedSupplierId, inn: '2710000002', name: 'Архивный поставщик', deletedAt },
    ]);
    await db().collection('supplyinvoices').insertMany([
      { _id: invoiceId, deliveryDate, amount: 900, note: 'Финансовая заметка', attachments: ['invoice.pdf'] },
      { _id: archivedInvoiceId, deliveryDate, deletedAt },
    ]);
    const base = { materialId, requestDate, unit: 'м', qty: 1, status: 'in_progress', deletedAt: null };
    const paidId = new Types.ObjectId();
    const unknownId = new Types.ObjectId();
    const records = Array.from({ length: 101 }, (_, index) => ({ ...base, _id: new Types.ObjectId(), num: 1000 + index }));
    await db().collection('supplyrequests').insertMany([
      ...records,
      { ...base, _id: paidId, num: 1101, unit: 'шт', qty: 7, receivedQty: 3, status: 'ordered', paid: true,
        supplierId, invoiceId, invoiceNo: 'C271-1', sum: 700, priceHint: 100, catalogCurrentPrice: 110, sheetExtra: { amount: 700 } },
      { ...base, _id: unknownId, num: 1102, supplierId: archivedSupplierId, invoiceId: archivedInvoiceId },
      { ...base, status: 'received', num: 1103 },
      { ...base, status: 'cancelled', num: 1104 },
      { ...base, deletedAt, num: 1105 },
      { ...base, materialId: new Types.ObjectId(foreignItem), num: 1106 },
    ]);
    const url = `/api/stock/items/${ownItem}/requests`;
    const prior = await db().collection('supplyrequests').countDocuments({ materialId, requestDate: { $ne: requestDate }, deletedAt: null });
    const first = await http().get(url).set(auth(manager)).query({ page: 1, limit: 100 }).expect(200);
    const second = await http().get(url).set(auth(observer)).query({ page: 2, limit: 100 }).expect(200);
    expect(first.body).toMatchObject({ total: 103 + prior, page: 1, limit: 100 });
    expect(second.body).toMatchObject({ total: 103 + prior, page: 2, limit: 100 });
    const items = [...first.body.items, ...second.body.items];
    expect(new Set(items.map(item => item.id)).size).toBe(103 + prior);
    const keys = ['id', 'invoiceDeliveryDate', 'invoiceId', 'invoiceNo', 'materialId', 'num', 'qty', 'status', 'statusLabel', 'supplierName', 'unit'];
    for (const item of items) expect(Object.keys(item).sort()).toEqual(keys);
    const seededIds = [unknownId, paidId, ...records.map(doc => doc._id)].map(String).sort().reverse();
    expect(items.filter(item => item.num >= 1000).map(item => item.id)).toEqual(seededIds);
    expect(items.find(item => item.id === String(paidId))).toEqual({ id: String(paidId), materialId: ownItem, num: 1101,
      qty: 7, unit: 'шт', status: 'paid', statusLabel: '💰 Оплачено', supplierName: 'C271', invoiceId: String(invoiceId),
      invoiceNo: 'C271-1', invoiceDeliveryDate: deliveryDate.toISOString() });
    expect(items.find(item => item.id === String(unknownId))).toMatchObject({ supplierName: null, invoiceNo: null, invoiceDeliveryDate: null });
    await http().get(url).set(auth(manager)).query({ limit: 101 }).expect(400);
    await http().get(url).set(auth(manager)).query({ status: 'paid' }).expect(400);
    await http().get(`/api/stock/items/${foreignItem}/requests`).set(auth(observer)).expect(403);
    await http().get('/api/stock/items/invalid/requests').set(auth(manager)).expect(400);
  });

  it('C275 — примечание заявки: авторизация, параллельный возврат и единичный аудит', async () => {
    const requests = db().collection('supplyrequests');
    const invoiceId = new Types.ObjectId();
    const id = new Types.ObjectId();
    const foreignId = new Types.ObjectId();
    const paidAt = new Date('2026-11-05T00:00:00Z');
    const base = { notes: '$Текущее', title: 'Позиция принятого счёта', qty: 7, receivedQty: 3, priceHint: 175,
      invoiceId, status: 'received', paid: true, paidAt, receivedAt: paidAt, deletedAt: null };
    await db().collection('supplyinvoices').insertOne({ _id: invoiceId, status: 'paid', amount: 175, deletedAt: null });
    await requests.insertMany([
      { ...base, _id: id, materialId: new Types.ObjectId(ownItem), categoryId: new Types.ObjectId(ownCategory) },
      { ...base, _id: foreignId, materialId: new Types.ObjectId(foreignItem), categoryId: new Types.ObjectId(foreignCategory) },
    ]);
    const projection = { notes: 0, updatedAt: 0, updatedBy: 0, editedInApp: 0 };
    const before = await requests.findOne({ _id: id }, { projection });
    const key = randomUUID();
    const change = { expected: base.notes, value: 'Прежнее примечание' };
    const send = (target = id, token = requestEditor) => http().patch(`/api/supply/requests/${target}/restore-note`)
      .set(auth(token)).set('Idempotency-Key', key).send(change);
    await send(foreignId).expect(403);
    await send(id, observer).expect(403);

    const flagUrl = '/api/feature-flags/c262.supply.requests.api';
    try {
      await http().put(flagUrl).set(auth()).send({ enabledByDefault: false }).expect(200);
      await send().expect(409);
      expect((await requests.findOne({ _id: id }))?.notes).toBe(base.notes);
    } finally {
      await http().put(flagUrl).set(auth()).send({ enabledByDefault: true }).expect(200);
    }

    const attempts = await Promise.all([send(), send()]);
    expect(attempts.map(attempt => attempt.status).sort()).toEqual([200, 409]);
    expect(attempts.find(attempt => attempt.status === 200)?.body).toMatchObject({ id: String(id), notes: change.value });
    await send().expect(409);
    expect((await requests.findOne({ _id: id }))?.notes).toBe(change.value);
    expect((await requests.findOne({ _id: foreignId }))?.notes).toBe(base.notes);
    expect(await requests.findOne({ _id: id }, { projection })).toEqual(before);
    expect(await db().collection('supplyinvoices').findOne({ _id: invoiceId })).toEqual({ _id: invoiceId, status: 'paid', amount: 175, deletedAt: null });
    expect(await db().collection('stockmovements').countDocuments({ documentRef: `SupplyRequest:${id}` })).toBe(0);
    const events = await db().collection('auditlogs').find({ action: 'supply.request.updated', entityType: 'SupplyRequest', entityId: id }).toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userName: 'c271-request-editor', details: { after: { notes: change.value } } });
  });

  it('C275 — история заявки проверяет склад и доступна для своей записи в корзине', async () => {
    const own = new Types.ObjectId();
    const foreign = new Types.ObjectId();
    const missing = new Types.ObjectId();
    const requests = db().collection('supplyrequests');
    await requests.insertMany([
      { _id: own, categoryId: new Types.ObjectId(ownCategory), deletedAt: null },
      { _id: foreign, materialId: new Types.ObjectId(foreignItem), deletedAt: null },
    ]);
    const log = { entityType: 'SupplyRequest', action: 'supply.request.updated', createdAt: new Date() };
    await db().collection('auditlogs').insertMany([
      { ...log, entityId: own, details: { after: { notes: 'Примечание заявки своего склада' } } },
      { ...log, entityId: foreign, details: { after: { notes: 'Примечание заявки другого склада' } } },
      { ...log, entityId: missing, details: { after: { notes: 'Примечание заявки без записи' } } },
      { ...log, details: { id: 'c275-legacy', after: { notes: 'Примечание старой заявки' } } },
    ]);
    const history = (entityId: Types.ObjectId | string) => http().get('/api/audit-logs/record').set(auth(requestEditor))
      .query({ entityType: 'SupplyRequest', entityId: String(entityId) });
    const live = (await history(own).expect(200)).body;
    expect(live.total).toBe(1);
    expect(live.items[0].changes).toEqual([{ field: 'notes', from: null, to: 'Примечание заявки своего склада' }]);
    await requests.updateOne({ _id: own }, { $set: { deletedAt: new Date() } });
    expect((await history(own).expect(200)).body).toEqual(live);
    await history(foreign).expect(403);
    await history(missing).expect(403);
    await history('c275-legacy').expect(403);
  });
});
