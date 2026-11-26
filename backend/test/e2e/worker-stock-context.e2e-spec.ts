import request from 'supertest';
import { Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { StockCoreService } from '../../src/modules/stock/stock-core.service';

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
      appSections: ['requests'], money: false, warehouseIds: [ownZone], stockCategoryIds: [ownCategory] }).expect(201)).body;
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

  it.each([['restore-note', 'notes'], ['restore-delivery-note', 'deliveryNote']] as const)(
    'C275 — %s: авторизация, параллельный возврат и единичный аудит', async (route, field) => {
    const requests = db().collection('supplyrequests');
    const invoiceId = new Types.ObjectId();
    const id = new Types.ObjectId();
    const foreignId = new Types.ObjectId();
    const paidAt = new Date('2026-11-05T00:00:00Z');
    const base = { notes: 'Сохранённое примечание', deliveryNote: 'Сохранённая доставка', [field]: '$Текущее',
      title: 'Позиция принятого счёта', qty: 7, receivedQty: 3, priceHint: 175,
      invoiceId, status: 'received', paid: true, paidAt, receivedAt: paidAt, deletedAt: null };
    await db().collection('supplyinvoices').insertOne({ _id: invoiceId, status: 'paid', amount: 175, deletedAt: null });
    await requests.insertMany([
      { ...base, _id: id, materialId: new Types.ObjectId(ownItem), categoryId: new Types.ObjectId(ownCategory) },
      { ...base, _id: foreignId, materialId: new Types.ObjectId(foreignItem), categoryId: new Types.ObjectId(foreignCategory) },
    ]);
    const projection = { [field]: 0, updatedAt: 0, updatedBy: 0, editedInApp: 0 };
    const before = await requests.findOne({ _id: id }, { projection });
    // Предыдущий снимок устарел после записи из CRM, которая не попала в этот журнал.
    await db().collection('auditlogs').insertOne({ action: 'supply.request.created', entityType: 'SupplyRequest',
      entityId: id, createdAt: new Date('2026-11-05T00:00:00Z'), details: { after: { [field]: 'До правки CRM', qty: 7, priceHint: 175 } } });
    const key = randomUUID();
    const change = { expected: base[field], value: 'Прежний текст' };
    const send = (target = id, token = requestEditor) => http().patch(`/api/supply/requests/${target}/${route}`)
      .set(auth(token)).set('Idempotency-Key', key).send(change);
    await send(foreignId).expect(403);
    await send(id, observer).expect(403);

    const flagUrl = '/api/feature-flags/c262.supply.requests.api';
    try {
      await http().put(flagUrl).set(auth()).send({ enabledByDefault: false }).expect(200);
      await send().expect(409);
      expect((await requests.findOne({ _id: id }))?.[field]).toBe(base[field]);
    } finally {
      await http().put(flagUrl).set(auth()).send({ enabledByDefault: true }).expect(200);
    }

    const attempts = await Promise.all([send(), send()]);
    expect(attempts.map(attempt => attempt.status).sort()).toEqual([200, 409]);
    expect(attempts.find(attempt => attempt.status === 200)?.body).toMatchObject({ id: String(id), [field]: change.value });
    await send().expect(409);
    expect((await requests.findOne({ _id: id }))?.[field]).toBe(change.value);
    expect((await requests.findOne({ _id: foreignId }))?.[field]).toBe(base[field]);
    expect(await requests.findOne({ _id: id }, { projection })).toEqual(before);
    expect(await db().collection('supplyinvoices').findOne({ _id: invoiceId })).toEqual({ _id: invoiceId, status: 'paid', amount: 175, deletedAt: null });
    expect(await db().collection('stockmovements').countDocuments({ documentRef: `SupplyRequest:${id}` })).toBe(0);
    const events = await db().collection('auditlogs').find({ action: 'supply.request.updated', entityType: 'SupplyRequest', entityId: id }).toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userName: 'c271-request-editor', details: { before: { [field]: change.expected }, after: { [field]: change.value } } });
    const history = await http().get('/api/audit-logs/record').set(auth(requestEditor))
      .query({ entityType: 'SupplyRequest', entityId: String(id) }).expect(200);
    expect(history.body.items[0]).toMatchObject({ first: false, changes: [{ field, from: change.expected, to: change.value }] });
  });

  it('C275 — ошибка вставки истории откатывает изменение доставки', async () => {
    const id = new Types.ObjectId();
    const requests = db().collection('supplyrequests');
    const original = { _id: id, title: 'C275 откат', deliveryNote: '', categoryId: new Types.ObjectId(ownCategory), deletedAt: null };
    await requests.insertOne(original);
    const audit = db().collection('auditlogs');
    const proto = Object.getPrototypeOf(audit) as Pick<typeof audit, 'insertOne'>;
    const insert = proto.insertOne;
    const failAudit = jest.spyOn(proto, 'insertOne').mockImplementation(function (this: typeof audit, doc, options) {
      if (this.collectionName === 'auditlogs' && String(doc.entityId) === String(id)) return Promise.reject(new Error('C275 test: audit unavailable'));
      return insert.call(this, doc, options);
    });
    const save = () => http().patch(`/api/supply/requests/${id}/restore-delivery-note`).set(auth(requestEditor))
      .send({ expected: null, value: 'Новый текст' });
    try {
      await save().expect(500);
      expect(await requests.findOne({ _id: id })).toEqual(original);
      expect(await audit.countDocuments({ entityId: id })).toBe(0);
    } finally { failAudit.mockRestore(); }
    await save().expect(200);
    expect((await requests.findOne({ _id: id }))?.deliveryNote).toBe('Новый текст');
    const history = await http().get('/api/audit-logs/record').set(auth(requestEditor))
      .query({ entityType: 'SupplyRequest', entityId: String(id) }).expect(200);
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0]).toMatchObject({ first: false, changes: [{ field: 'deliveryNote', from: null, to: 'Новый текст' }] });
    await http().patch(`/api/supply/requests/${id}/restore-delivery-note`).set(auth(requestEditor))
      .send({ expected: 'Новый текст', value: null }).expect(200);
    expect((await requests.findOne({ _id: id }))?.deliveryNote).toBeUndefined();
  });

  it('C275 — подтверждённый менеджер не удаляет заявку, но восстанавливает свою запись из корзины', async () => {
    const id = new Types.ObjectId();
    const requests = db().collection('supplyrequests');
    await requests.insertOne({ _id: id, title: 'C275 корзина', categoryId: new Types.ObjectId(ownCategory), deletedAt: null });
    const { token } = (await http().post('/api/auth/confirm').set(auth(requestEditor)).send({ password: 'c271-test-password' }).expect(200)).body;
    const path = `/api/supply/requests/${id}`;
    await http().delete(path).set(auth(requestEditor)).set('X-Confirm-Token', token).expect(403);
    expect((await requests.findOne({ _id: id }))?.deletedAt).toBeNull();
    await http().delete(path).set(auth()).expect(200);
    await http().post(path + '/restore').set(auth(requestEditor)).expect(403);
    await http().post(path + '/restore').set(auth(requestEditor)).set('X-Confirm-Token', token).expect(200);
    expect((await requests.findOne({ _id: id }))?.deletedAt).toBeNull();
  });

  it('C275 — объединение счетов удаляет дубли заявок только от имени администратора', async () => {
    const requests = db().collection('supplyrequests');
    const invoices = db().collection('supplyinvoices');
    const pair = async (duplicates: boolean) => {
      const source = new Types.ObjectId(), target = new Types.ObjectId();
      const line = new Types.ObjectId(), other = new Types.ObjectId();
      const invoice = { status: 'draft', amount: 50, deletedAt: null, supplierId: new Types.ObjectId() };
      const row = { materialId: new Types.ObjectId(ownItem), qty: 2, priceHint: 50, status: 'ordered', deletedAt: null };
      await invoices.insertMany([{ ...invoice, _id: source, no: '101' }, { ...invoice, _id: target, no: '102' }]);
      await requests.insertMany([{ ...row, _id: line, invoiceId: source }, { ...row, _id: other, invoiceId: target, qty: duplicates ? 2 : 3 }]);
      const path = `/api/supply/invoices/${source}`;
      return { source, target, line, other,
        preview: (token = requestEditor) => http().get(`${path}/merge-preview`).set(auth(token)).query({ targetId: String(target) }),
        merge: (strategy: string, token = requestEditor) => http().post(`${path}/merge`).set(auth(token)).send({ targetId: String(target), strategy }),
      };
    };

    const duplicate = await pair(true);
    const patchNumber = (token = requestEditor) => http().patch(`/api/supply/invoices/${duplicate.source}`).set(auth(token)).send({ no: '102' });
    const duplicateInfo = { code: 'INVOICE_NUMBER_EXISTS', existingInvoiceId: String(duplicate.target), existingNo: '102' };
    const draftConflict = (await patchNumber().expect(409)).body;
    expect(draftConflict).toMatchObject(duplicateInfo);
    expect(draftConflict).not.toHaveProperty('existingStatus');
    expect((await patchNumber(admin).expect(409)).body).toMatchObject({ ...duplicateInfo, existingStatus: 'draft' });
    await requests.updateOne({ _id: duplicate.other }, { $set: { materialId: new Types.ObjectId(foreignItem) } });
    const ownTargetLine = await requests.insertOne({ invoiceId: duplicate.target, materialId: new Types.ObjectId(ownItem), status: 'ordered', deletedAt: null });
    expect(JSON.stringify((await patchNumber().expect(403)).body)).not.toContain(String(duplicate.target));
    await requests.deleteOne({ _id: ownTargetLine.insertedId });
    const hidden = (await patchNumber().expect(403)).body;
    expect(JSON.stringify(hidden)).not.toContain(String(duplicate.target));
    await requests.updateOne({ _id: duplicate.other }, { $set: { materialId: new Types.ObjectId(ownItem) } });
    await invoices.updateOne({ _id: duplicate.target }, { $set: { status: 'paid' } });
    const targetPath = '/api/supply/invoices/' + duplicate.target;
    expect((await http().get(targetPath).set(auth(requestEditor)).expect(200)).body).toMatchObject({ id: String(duplicate.target), no: '102', status: 'shipped' });
    expect((await http().get(targetPath).set(auth(admin)).expect(200)).body.status).toBe('paid');
    const paidConflict = (await patchNumber().expect(409)).body;
    expect(paidConflict).toMatchObject(duplicateInfo);
    expect(paidConflict).not.toHaveProperty('existingStatus');
    expect((await patchNumber(admin).expect(409)).body).toMatchObject({ ...duplicateInfo, existingStatus: 'paid' });
    expect(Object.keys(paidConflict).sort()).toEqual(Object.keys(draftConflict).sort());
    expect(paidConflict.message).toBe(draftConflict.message);
    const blocked = 'Эти счета нельзя объединить. Откройте существующий счёт или обратитесь к администратору.';
    expect((await duplicate.preview().expect(400)).body.message).toBe(blocked);
    expect((await duplicate.merge('append').expect(400)).body.message).toBe(blocked);
    expect((await duplicate.preview(admin).expect(400)).body.message).toContain('Оплаченные');
    expect((await duplicate.merge('append', admin).expect(400)).body.message).toContain('Оплаченные');
    await invoices.updateOne({ _id: duplicate.target }, { $set: { status: 'draft', undatedPaymentEvidence: { state: 'pending' } } });
    const undated = (await duplicate.preview().expect(409)).body;
    expect(undated.message).toBe(blocked);
    expect(undated).not.toHaveProperty('code');
    expect((await duplicate.preview(admin).expect(409)).body.code).toBe('UNDATED_PAYMENT_PENDING');
    await invoices.updateOne({ _id: duplicate.target }, { $unset: { undatedPaymentEvidence: '' }, $set: { paymentAccountingVersion: 1, paidAmount: 10 } });
    expect((await duplicate.preview().expect(409)).body.message).toBe(blocked);
    expect((await duplicate.preview(admin).expect(409)).body.message).toContain('платежами');
    await invoices.updateOne({ _id: duplicate.target }, { $unset: { paymentAccountingVersion: '', paidAmount: '' }, $set: { currency: 'USD' } });
    expect((await duplicate.preview().expect(409)).body.message).toBe(blocked);
    expect((await duplicate.preview(admin).expect(409)).body.message).toContain('Валютные');
    await invoices.updateOne({ _id: duplicate.target }, { $unset: { currency: '' } });
    await requests.updateOne({ _id: duplicate.other }, { $set: { status: 'received' } });
    await duplicate.preview().expect(400);
    await duplicate.merge('append').expect(400);
    await requests.updateOne({ _id: duplicate.other }, { $set: { status: 'ordered' } });
    const before = await invoices.find({ _id: { $in: [duplicate.source, duplicate.target] } }).sort({ _id: 1 }).toArray();
    const managerPreview = (await duplicate.preview().expect(200)).body;
    expect(managerPreview).toMatchObject({ duplicates: 1, strategies: ['append', 'replaceLines'] });
    expect(managerPreview.source).not.toHaveProperty('amount');
    expect(managerPreview.target).not.toHaveProperty('amount');
    expect(managerPreview).not.toHaveProperty('resultAmount');
    const managerCard = (await http().get('/api/supply/invoices/' + duplicate.source).set(auth(requestEditor)).expect(200)).body;
    expect(managerCard.requests).toHaveLength(1);
    expect(managerCard.requests[0]).not.toHaveProperty('priceHint');
    const adminPreview = (await duplicate.preview(admin).expect(200)).body;
    expect(adminPreview.strategies).toContain('mergeSameRequest');
    expect(adminPreview).toMatchObject({ source: { amount: 50 }, target: { amount: 50 }, resultAmount: { append: 100, mergeSameRequest: 50, replaceLines: 50 } });
    await duplicate.merge('mergeSameRequest').expect(403);
    expect(await requests.findOne({ _id: duplicate.line })).toMatchObject({ deletedAt: null, invoiceId: duplicate.source });
    expect(await invoices.find({ _id: { $in: [duplicate.source, duplicate.target] } }).sort({ _id: 1 }).toArray()).toEqual(before);
    expect((await duplicate.merge('mergeSameRequest', admin).expect(200)).body.skipped).toBe(1);
    expect((await requests.findOne({ _id: duplicate.line }))?.deletedAt).toBeInstanceOf(Date);

    for (const strategy of ['append', 'replaceLines', 'mergeSameRequest']) {
      const invoicesToMerge = await pair(strategy !== 'mergeSameRequest');
      expect((await invoicesToMerge.preview().expect(200)).body.strategies).toContain(strategy);
      expect((await invoicesToMerge.merge(strategy).expect(200)).body.skipped).toBe(0);
      expect(await requests.findOne({ _id: invoicesToMerge.line })).toMatchObject({ deletedAt: null, invoiceId: invoicesToMerge.target });
      expect((await requests.findOne({ _id: invoicesToMerge.other }))?.deletedAt).toBeNull();
    }
  });

  it('C275 — поля заявки и перенос поставки сохраняются независимо от реквизитов счёта', async () => {
    const path = '/api/supply/requests';
    const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    const original = { requestDate: day(8), invoiceDate: day(5), neededBy: day(2), notes: 'К первым воротам' };
    const dates = { requestDate: `${original.requestDate}T00:00:00.000Z`, invoiceDate: `${original.invoiceDate}T00:00:00.000Z` };
    const { body: row } = await http().post(path).set(auth(requestEditor))
      .send({ title: 'C275 проверка дат', qty: 4, materialId: ownItem, statusLabel: 'В работе', ...original }).expect(201);
    expect(row).toMatchObject({ ...dates, neededBy: `${original.neededBy}T00:00:00.000Z`, notes: original.notes });
    const card = `${path}/${row.id}`;
    const feed = async () => (await http().get('/api/today?scope=all').set(auth(requestEditor)).expect(200)).body.feed;
    expect(await feed()).toContainEqual(expect.objectContaining({ id: row.id, due: original.neededBy }));
    await http().patch(card).set(auth(requestEditor)).send({ neededBy: day(1) }).expect(200);
    expect(await feed()).toContainEqual(expect.objectContaining({ id: row.id, due: day(1) }));
    const { body: saved } = await http().get(card).set(auth(requestEditor)).expect(200);
    expect(saved).toMatchObject({ ...dates, neededBy: `${day(1)}T00:00:00.000Z`, qty: 4, notes: original.notes });
    await http().patch(card).set(auth(requestEditor)).send({ neededBy: '2026-02-30' }).expect(400);
    await http().patch(card).set(auth(requestEditor)).send({ neededBy: null }).expect(200);
    expect(await feed()).not.toContainEqual(expect.objectContaining({ id: row.id }));
    await http().patch(card).set(auth(requestEditor)).send({ requestDate: day(7), notes: '' }).expect(200);
    const { body: reopened } = await http().get(card).set(auth(requestEditor)).expect(200);
    expect(reopened).toMatchObject({ requestDate: `${day(7)}T00:00:00.000Z`, invoiceDate: dates.invoiceDate, qty: 4 });
    expect(reopened.notes ?? null).toBeNull();
  });

  it('C275 — менеджер без денежных прав меняет и очищает дату доставки и примечание счёта', async () => {
    const invoice = new Types.ObjectId();
    const line = new Types.ObjectId();
    const invoices = db().collection('supplyinvoices');
    const requests = db().collection('supplyrequests');
    const date = new Date('2026-11-20');
    const row = { _id: line, invoiceId: invoice, status: 'ordered', title: 'C275 строка счёта', qty: 5, priceHint: 60,
      materialId: new Types.ObjectId(ownItem), deletedAt: null };
    await invoices.insertOne({ _id: invoice, status: 'draft', no: 'С275', date, amount: 60, deletedAt: null });
    await requests.insertOne(row);
    const path = `/api/supply/invoices/${invoice}`;
    const saved = { deliveryDate: '2026-11-27', note: 'Привезти ко вторым воротам' };
    await http().patch(path).set(auth(requestEditor)).send(saved).expect(200);
    const { body: reopened } = await http().get(path).set(auth(requestEditor)).expect(200);
    expect(reopened).toMatchObject({ deliveryDate: `${saved.deliveryDate}T00:00:00.000Z`, note: saved.note });
    expect(reopened).not.toHaveProperty('amount');
    await http().patch(path).set(auth(requestEditor)).send({ deliveryDate: '', note: '' }).expect(200);
    const cleared = await invoices.findOne({ _id: invoice });
    expect(cleared).toMatchObject({ no: 'С275', date, amount: 60, status: 'draft' });
    expect(cleared?.deliveryDate).toBeUndefined();
    expect(cleared?.note).toBeUndefined();
    expect(await requests.findOne({ _id: line })).toEqual(row);
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

  it.each(['request', 'invoice'] as const)('C165 — приёмка %s не пишет в позицию чужого склада', async route => {
    const requests = db().collection('supplyrequests');
    const invoices = db().collection('supplyinvoices');
    const materials = db().collection('materials');
    const storage = db().collection('storageitems');
    const materialId = new Types.ObjectId(foreignItem);
    const foreign = await materials.findOne({ _id: materialId });
    const requestId = new Types.ObjectId(), invoiceId = new Types.ObjectId();
    const invoice = { _id: invoiceId, status: 'issued', amount: 60, deletedAt: null };
    const row = { _id: requestId, status: 'ordered', title: foreign?.name, qty: 3, priceHint: 60, unit: 'шт',
      categoryId: new Types.ObjectId(ownCategory), deletedAt: null, ...(route === 'invoice' ? { invoiceId } : {}) };
    await requests.insertOne(row);
    if (route === 'invoice') await invoices.insertOne(invoice);
    const cells = await storage.find({ materialId }).sort({ _id: 1 }).toArray();
    await http().get(`/api/supply/requests/${requestId}`).set(auth(requestEditor)).expect(200);
    const path = route === 'invoice' ? `/api/supply/invoices/${invoiceId}/receive` : `/api/supply/requests/${requestId}/receive`;
    const body = route === 'invoice' ? { requestIds: [String(requestId)] } : {};
    const rejected = await http().post(path).set(auth(requestEditor)).send(body).expect(403);
    expect(rejected.body.message).toContain('не из вашего склада');
    expect(await requests.findOne({ _id: requestId })).toEqual(row);
    expect(await materials.findOne({ _id: materialId })).toEqual(foreign);
    expect(await storage.find({ materialId }).sort({ _id: 1 }).toArray()).toEqual(cells);
    expect(await db().collection('stockmovements').countDocuments({ documentRef: `SupplyRequest:${requestId}` })).toBe(0);
    if (route === 'invoice') expect(await invoices.findOne({ _id: invoiceId })).toEqual(invoice);
  });

  it('C165 — склад привязанной позиции перепроверяется при смене категории во время транзакции', async () => {
    const materialId = new Types.ObjectId(), requestId = new Types.ObjectId();
    const materials = db().collection('materials');
    const requests = db().collection('supplyrequests');
    const material = { _id: materialId, name: 'C165 смена склада при приёмке', categoryId: new Types.ObjectId(ownCategory), editedInApp: true, deletedAt: null };
    const row = { _id: requestId, materialId, status: 'ordered', title: material.name, qty: 2, deletedAt: null };
    await materials.insertOne(material);
    await requests.insertOne(row);
    const foreign = new Types.ObjectId(foreignCategory);
    const core = ctx.module.get(StockCoreService);
    const markEdited = core.markEdited.bind(core);
    const changed = jest.spyOn(core, 'markEdited').mockImplementationOnce(async (id, session) => {
      expect(id).toEqual(materialId);
      expect(session?.inTransaction()).toBe(true);
      await materials.updateOne({ _id: materialId }, { $set: { categoryId: foreign } });
      return markEdited(id, session);
    });
    try {
      const rejected = await http().post(`/api/supply/requests/${requestId}/receive`).set(auth(requestEditor)).send({}).expect(403);
      expect(rejected.body.message).toContain('не из вашего склада');
      expect(changed).toHaveBeenCalledTimes(1);
    } finally { changed.mockRestore(); }
    expect(await materials.findOne({ _id: materialId })).toEqual({ ...material, categoryId: foreign });
    expect(await requests.findOne({ _id: requestId })).toEqual(row);
    expect(await db().collection('storageitems').countDocuments({ materialId })).toBe(0);
    expect(await db().collection('stockmovements').countDocuments({ documentRef: `SupplyRequest:${requestId}` })).toBe(0);
  });

  it('C165 — приёмка своей заявки переиспользует материал своего склада по имени', async () => {
    const requests = db().collection('supplyrequests');
    const materialId = new Types.ObjectId(ownItem);
    const own = await db().collection('materials').findOne({ _id: materialId });
    const requestId = new Types.ObjectId();
    const initial = { _id: requestId, status: 'ordered', title: own?.name, qty: 2, unit: 'м',
      categoryId: new Types.ObjectId(ownCategory), deletedAt: null };
    await requests.insertOne(initial);
    await http().post(`/api/supply/requests/${requestId}/receive`).set(auth(requestEditor)).send({}).expect(200);
    expect(await requests.findOne({ _id: requestId })).toMatchObject({ materialId, status: 'received', receivedTo: 'stock' });
    expect(await db().collection('stockmovements').countDocuments({ materialId, documentRef: `SupplyRequest:${requestId}`, type: 'in' })).toBe(1);
  });
});
