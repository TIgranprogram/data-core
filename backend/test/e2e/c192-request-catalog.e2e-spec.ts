import request from 'supertest';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';

describe('C192 — новая номенклатура из заявки', () => {
  let ctx: TestContext;
  let authorization: ReturnType<typeof authHeader>;
  const db = () => ctx.connection.db!;
  const http = () => request(ctx.app.getHttpServer());
  const materials = () => db().collection('materials');
  const post = (body: object) => http().post('/api/supply/requests').set(authorization).send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
    authorization = authHeader((await loginAsAdmin(ctx.app)).access);
  });

  afterAll(async () => { await ctx?.cleanup(); });

  it('одного названия хватает для каталога; заявка не создаёт складское размещение', async () => {
    const title = 'Фикстура C192 без поставщика';
    const created = (await post({ title, clientUid: 'c192-first' }).expect(201)).body;
    const mid = new Types.ObjectId(created.materialId);
    expect(await materials().findOne({ _id: mid })).toMatchObject({ materialKind: 'purchased', name: title, stockQty: 0 });
    expect(await db().collection('storageitems').countDocuments({ materialId: mid })).toBe(0);
    const catalog = (await http().get('/api/supply/catalog/items').query({ view: 'all', supplierId: 'none', search: title }).set(authorization).expect(200)).body;
    expect(catalog.items).toMatchObject([{ name: title, materialId: created.materialId, stockQty: 0 }]);
    const same = (await post({ title, clientUid: 'c192-first' }).expect(201)).body;
    expect(same.id).toBe(created.id);
    const again = (await post({ materialId: created.materialId }).expect(201)).body;
    expect(again).toMatchObject({ title, materialId: created.materialId });
    expect(await materials().countDocuments({ name: title })).toBe(1);
  });

  it('две параллельные заявки создают единую номенклатуру', async () => {
    const title = 'Фикстура C192 параллельно';
    const [first, second] = await Promise.all([
      post({ title, clientUid: 'c192-race-1' }).expect(201),
      post({ title, clientUid: 'c192-race-2' }).expect(201),
    ]);
    expect(first.body.id).not.toBe(second.body.id);
    expect(first.body.materialId).toBe(second.body.materialId);
    expect(await materials().countDocuments({ name: title })).toBe(1);
  });

  it('одноимённая деталь из PDM остаётся отдельной; отказ архива не оставляет материал', async () => {
    const title = 'Фикстура C192 PDM';
    const partId = (await materials().insertOne({ name: title, materialKind: 'part', article: 'TEST-C192-PDM', deletedAt: null })).insertedId;
    const created = (await post({ title }).expect(201)).body;
    expect(created.materialId).not.toBe(String(partId));
    expect((await materials().findOne({ _id: new Types.ObjectId(created.materialId) }))?.materialKind).toBe('purchased');
    const archived = (await db().collection('salesorders').insertOne({ orderNo: 'C192-archive', activeArchiveVersion: 1, deletedAt: null })).insertedId;
    const archivedTitle = 'Фикстура C192 архив';
    await post({ title: archivedTitle, salesOrderId: String(archived) }).expect(409);
    expect(await materials().countDocuments({ name: archivedTitle })).toBe(0);
  });
  it('предпросмотр дубля сохраняет размещения раздельно и только читает данные', async () => {
    const base = { deletedAt: null, materialKind: 'purchased', unit: 'шт' };
    const { insertedIds } = await materials().insertMany([
      { ...base, name: 'Крепёж C192 основной', article: 'KEEP-C192' },
      { ...base, name: 'Крепёж C192 дубль', article: 'DUP-C192' },
    ]);
    const pairs = { sourceId: String(insertedIds[1]), targetId: String(insertedIds[0]) };
    const { insertedId: warehouseId } = await db().collection('warehouses').insertOne({ name: 'Тестовый склад C192', deletedAt: null });
    const placements = db().collection('storageitems');
    await placements.insertMany([
      { warehouseId, materialId: insertedIds[0], zoneName: 'А', quantity: 4, reservedQty: 2, deletedAt: null },
      { warehouseId, materialId: insertedIds[1], zoneName: 'Б', quantity: 3, reservedQty: 1, deletedAt: null },
    ]);
    await db().collection('stockmovements').insertOne({ warehouseId, materialId: insertedIds[1], date: new Date(), type: 'in', qty: 3 });
    const before = await placements.find({ warehouseId }).toArray();
    const preview = http().get('/api/stock/duplicate-preview').set(authorization);
    const { body } = await preview.query(pairs).expect(200);
    expect(body).toMatchObject({ canMerge: false, items: [
      { id: pairs.sourceId, movements: 1, placements: [{ warehouse: 'Тестовый склад C192', zone: 'Б', quantity: 3, reserved: 1 }] },
      { id: pairs.targetId, movements: 0, placements: [{ warehouse: 'Тестовый склад C192', zone: 'А', quantity: 4, reserved: 2 }] },
    ] });
    expect(body.blockers).toHaveLength(1);
    expect(await placements.find({ warehouseId }).toArray()).toEqual(before);
    await http().get('/api/stock/duplicate-preview').query(pairs).expect(401);
    await http().get('/api/stock/duplicate-preview').set(authorization).query({ sourceId: pairs.sourceId, targetId: pairs.sourceId }).expect(400);
  });
});
