import request from 'supertest';
import { Types } from 'mongoose';
import { miniTree } from '../../src/modules/pdm-import/pdm-tree.testkit';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { createTestApp, type TestContext } from '../setup/test-db';

describe('C191 — физический остаток в своей зоне', () => {
  let ctx: TestContext | undefined;

  afterAll(async () => { await ctx?.cleanup(); });

  it('согласует список, поиск, выбор по id и категории, сохраняя номенклатуру и движения', async () => {
    ctx = await createTestApp({ strictValidation: true });
    const { app, connection } = ctx;
    const http = () => request(app.getHttpServer());
    const admin = authHeader((await loginAsAdmin(app)).access);

    const tree = miniTree();
    const plan = (await http().post('/api/pdm-import/preview').set(admin).send(tree).expect(201)).body;
    await http().post('/api/pdm-import/apply').set(admin).send({ planId: plan.planId }).expect(201);
    const materials = connection.collection('materials');
    const part = (await materials.findOne({ article: '0000.1005.0001' }))!;
    const zero = (await materials.findOne({ pdmCode: 'PI.0003' }))!;
    const fastener = (await materials.findOne({ pdmCode: 'SHP08.D125' }))!;
    const profile = (await materials.findOne({ isProfile: true }))!;
    const product = (await connection.collection('products').findOne({ sku: tree.root }))!;
    const module = (await connection.collection('productmodules').findOne({ article: '0000.1005.0000' }))!;

    const create = async (name: string, categoryName: string) =>
      (await http().post('/api/stock/items').set(admin).send({ name, categoryName, unit: 'шт' }).expect(201)).body;
    const purchased = await create('Покупное изделие C191', 'Зона крепежа C191');
    const foreign = await create('Посторонняя позиция C191', 'Чужая категория C191');
    const categoryId = new Types.ObjectId(purchased.categoryId);
    await materials.updateMany({ _id: { $in: [new Types.ObjectId(purchased.id), zero._id] } }, { $set: { materialKind: 'purchased', categoryId } });
    // Имитируем старое ошибочное размещение детали и сортамента, которые тоже надо скрыть.
    const ids = [purchased.id, foreign.id, String(part._id), String(profile._id), String(fastener._id)];
    await http().post('/api/stock/batch').set(admin).send({
      type: 'in', lines: ids.map((materialId) => ({ materialId, qty: 3 })),
    }).expect(201);
    await http().post('/api/stock/reserve-list').set(admin).send({
      groupName: 'Полная бронь C191', lines: [{ materialId: purchased.id, qty: 3 }],
    }).expect(201);
    const row = (await connection.collection('storageitems').findOne({ materialId: new Types.ObjectId(purchased.id) }))!;
    await connection.collection('storageitems').insertMany([
      { warehouseId: row.warehouseId, materialId: row.materialId, zoneName: 'Вторая полка', quantity: 2, reservedQty: 2 },
      { warehouseId: row.warehouseId, materialId: row.materialId, zoneName: 'Архивная полка', quantity: 70, reservedQty: 0, deletedAt: new Date() },
      { warehouseId: row.warehouseId, productId: product._id, quantity: 8 },
    ]);

    const createZone = async (name: string, data: object) =>
      (await http().post('/api/stockzones').set(admin).send({ name, ...data }).expect(201)).body.id as string;
    const ownZone = await createZone('C191 своя', { categoryIds: [purchased.categoryId], includeMaterialIds: [String(fastener._id)] });
    const foreignZone = await createZone('C191 чужая', { categoryIds: [foreign.categoryId] });
    const role = (await http().post('/api/roles').set(admin).send({ label: 'Кладовщик C191', baseRole: 'manager', warehouseIds: [ownZone] }).expect(201)).body;
    const credentials = { username: 'stock-c191', password: 'stock-c191-test' };
    await http().post('/api/admin/users').set(admin).send({ ...credentials, role: role.name }).expect(201);
    const keeper = authHeader((await http().post('/api/auth/login').send(credentials).expect(200)).body.access);

    const list = async (query: object, headers = admin) =>
      (await http().get('/api/stock/items').query(query).set(headers).expect(200)).body;
    const held = { held: '1' };
    const visible = (body: { items: Array<{ id: string }> }) => body.items.map((r) => r.id);

    const full = await list(held);
    expect(visible(full).sort()).toEqual([purchased.id, foreign.id, String(fastener._id)].sort());
    expect(full.counts).toMatchObject({ all: 3, none: 0, reserved: 1 });
    const zone = await list({ ...held, zoneId: ownZone, status: 'reserved' }, keeper);
    expect(visible(zone)).toEqual([purchased.id]);
    expect(zone.items[0]).toMatchObject({ quantity: 5, reservedQty: 5, free: 0, materialKind: 'purchased' });
    expect(zone.counts).toMatchObject({ all: 2, none: 0, reserved: 1 });
    expect(visible(await list({ ...held, ids: [foreign.id, purchased.id, String(zero._id)].join(',') }, keeper))).toEqual([purchased.id]);
    const cats = (await http().get('/api/stock/categories').set(keeper).query({ ...held, zoneId: ownZone }).expect(200)).body;
    expect(cats.total).toBe(2);
    expect(cats.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: purchased.categoryId, total: 1, none: 0 })]));
    expect(cats.items.some((c: { id: string }) => c.id === foreign.categoryId)).toBe(false);
    for (const path of ['/api/stock/items', '/api/stock/categories']) {
      await http().get(path).set(keeper).query({ ...held, zoneId: foreignZone }).expect(403);
    }
    expect(visible(await list({ ...held, search: 'SHP08.D125' }, keeper))).toEqual([String(fastener._id)]);
    expect(visible(await list({ ...held, search: 'PI.0003' }, keeper))).toEqual([]);
    expect(visible(await list({ search: 'PI.0003' }, keeper))).toEqual([String(zero._id)]);
    expect(visible(await list({ ...held, ids: [part._id, product._id, module._id].join(',') }))).toEqual([]);
    const parts = (await http().get('/api/materials').set(admin).query({ materialKind: 'part', search: part.article }).expect(200)).body;
    expect(visible(parts)).toContain(String(part._id));
    const catalog = (await http().get('/api/supply/catalog/items').set(keeper).query({ view: 'all', search: 'PI.0003' }).expect(200)).body;
    expect(catalog.items).toEqual(expect.arrayContaining([expect.objectContaining({ materialId: String(zero._id) })]));
    const needs = (await http().get(`/api/products/${product._id}/purchase-needs`).set(admin).expect(200)).body;
    expect(needs.items).toEqual(expect.arrayContaining([expect.objectContaining({ materialId: String(zero._id) })]));
    const movements = (await http().get('/api/stock/movements').set(admin).query({ materialId: String(part._id) }).expect(200)).body;
    expect(movements.total).toBeGreaterThan(0);
  });
});
