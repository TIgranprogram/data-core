import request from 'supertest';
import { Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { StockCoreService } from '../../src/modules/stock/stock-core.service';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { mergeDims } from '../../src/modules/stock/metal';

describe('C274 — создание координаты на изолированном replica set', () => {
  let ctx: TestContext, admin: string, scoped: string, zone: string, overlap: string, other: string, sheetZone: string;
  const cat = new Types.ObjectId(), sheetCat = new Types.ObjectId(), otherCat = new Types.ObjectId(), excluded = new Types.ObjectId();
  const db = () => ctx.connection.db!;
  const http = () => request(ctx.app.getHttpServer());
  const body = (name: string, width: number) => ({ kind: 'pipe', name, categoryId: String(cat), materialGrade: 'Ст3', unit: 'м', washed: false,
    dims: { length: 12000, width, height: 20, thickness: 2 } });
  const post = (dto: object, zoneId = zone, token = admin) => http().post('/api/stock/items/from-coordinate').query({ zoneId })
    .set(authHeader(token)).set('Idempotency-Key', randomUUID()).send(dto);
  async function seed(name: string, width: number, overrides: Record<string, unknown> = {}) {
    const item = body(name, width);
    return (await db().collection('materials').insertOne({ _id: new Types.ObjectId(), name, article: randomUUID(), categoryId: cat,
      unit: item.unit, materialGrade: item.materialGrade, washed: item.washed, dimensions: mergeDims([], item.dims), ...overrides }, { writeConcern: { w: 'majority' } })).insertedId;
  }
  beforeAll(async () => {
    if (process.env.MONGO_DB_TEST !== 'datacore-test-c274-stock' || !['127.0.0.1', 'localhost'].includes(new URL(process.env.MONGO_URI!).hostname)) throw Error('C274: нужна выделенная локальная test-БД');
    ctx = await createTestApp({ strictValidation: true });
    admin = (await loginAsAdmin(ctx.app)).access;
    await db().collection('categories').insertMany([[cat, 'Труба'], [sheetCat, 'Лист'], [otherCat, 'Другая труба']].map(([id, name]) =>
      ({ _id: id as Types.ObjectId, name: String(name), slug: String(id), skuPrefix: String(id), type: 'material' })), { writeConcern: { w: 'majority' } });
    const zoneFor = async (name: string, categoryId: Types.ObjectId, excludeMaterialIds: string[] = []) =>
      (await http().post('/api/stockzones').set(authHeader(admin)).send({ name, categoryIds: [String(categoryId)], excludeMaterialIds }).expect(201)).body.id;
    await seed('Чужая исключённая позиция', 45, { _id: excluded });
    zone = await zoneFor('C274 Трубы', cat, [String(excluded)]);
    overlap = await zoneFor('C274 Вторая зона труб', cat);
    sheetZone = await zoneFor('C274 Листы', sheetCat);
    other = await zoneFor('C274 Другие трубы', otherCat);
    const role = (await http().post('/api/roles').set(authHeader(admin)).send({ label: 'C274 Труборез', baseRole: 'manager', appSections: ['stock'], warehouseIds: [zone] }).expect(201)).body;
    await http().post('/api/admin/users').set(authHeader(admin)).send({ username: 'c274-stock', password: 'fixture-password', role: role.name }).expect(201);
    scoped = (await http().post('/api/auth/login').send({ username: 'c274-stock', password: 'fixture-password' }).expect(200)).body.access;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('скрытый старый материал со строковой категорией: один адресный отказ, без новой ячейки/движения', async () => {
    await db().collection('materials').insertMany(Array.from({ length: 100 }, (_, index) => ({
      name: 'А серия ' + index, article: 'C274-' + index, categoryId: cat, unit: 'м', washed: false, materialGrade: 'Ст3',
      dimensions: mergeDims([], body('', 1000 + index).dims),
    })), { writeConcern: { w: 'majority' } });
    const id = await seed('Старый нулевой материал', 40, { categoryId: String(cat) });
    const list = async (filter: Record<string, string | number>) => (await http().get('/api/stock/items').set(authHeader(scoped))
      .query({ zoneId: zone, sort: 'name', priority: '0', limit: 100, ...filter }).expect(200)).body.items.map((item: { id: string }) => item.id);
    expect(await list({ page: 1 })).not.toContain(String(id));
    expect(await list({ page: 2 })).toContain(String(id));
    expect(await list({ availability: 'in' })).not.toContain(String(id));
    expect(await list({ search: 'А серия' })).not.toContain(String(id));
    const dto = body('Сгенерированное имя', 40);
    const conflict = await post(dto, zone, scoped).expect(409);
    expect(conflict.body).toMatchObject({ code: 'STOCK_COORDINATE_EXISTS', details: [{ materialId: String(id), name: 'Старый нулевой материал' }] });
    expect(await db().collection('materials').countDocuments({ name: dto.name })).toBe(0);
    expect(await db().collection('storageitems').countDocuments({ materialId: id })).toBe(0);
    expect(await db().collection('stockmovements').countDocuments({ materialId: id })).toBe(0);
  });

  it('неполный и точный кандидаты требуют выбора; исключённые ID и характеристики скрыты', async () => {
    const first = await seed('Первая труба', 45);
    const partial = await seed('Не указана мойка', 45, { washed: null });
    await seed('Чужая категория', 45, { categoryId: otherCat });
    const conflict = await post(body('Проверить кандидатов', 45), zone, scoped).expect(409);
    expect(conflict.body.code).toBe('STOCK_COORDINATE_AMBIGUOUS');
    expect(conflict.body.details.map((item: { materialId: string }) => item.materialId).sort()).toEqual([String(partial), String(first)].sort());
    expect(JSON.stringify(conflict.body)).not.toMatch(/Чужая/);
    await post(body('Недоступная зона', 45), overlap, scoped).expect(403);
    await post({ ...body('Чужая категория', 45), categoryId: String(otherCat) }, zone, scoped).expect(403);
  });

  it('гонка разных имён/ключей между пересекающимися зонами и повтор после неизвестного исхода', async () => {
    const [one, two] = await Promise.all([post(body('Гонка А', 70)), post(body('Гонка Б', 70), overlap)]);
    expect([one.status, two.status].sort()).toEqual([201, 409]);
    const winner = one.status === 201 ? one : two, loser = one.status === 409 ? one : two;
    const id = winner.body.id;
    expect(loser.body).toMatchObject({ code: 'STOCK_COORDINATE_EXISTS', details: [{ materialId: id }] });
    expect((await post(body('Повторный запрос', 70)).expect(409)).body.details[0].materialId).toBe(id);
    expect(await db().collection('materials').countDocuments({ name: { $in: ['Гонка А', 'Гонка Б'] } })).toBe(1);
    expect(await db().collection('storageitems').countDocuments({ materialId: new Types.ObjectId(id), quantity: 0 })).toBe(1);
    expect(await db().collection('stockmovements').countDocuments({ materialId: new Types.ObjectId(id) })).toBe(0);
  });

  it('сбой перед размещением отменяет материал, счётчики и блокировки; повтор создаёт одну ячейку', async () => {
    const dto = body('Откат размещения', 75);
    const before = await db().collection('counters').find().sort({ _id: 1 }).toArray();
    const lockCount = await db().collection('stock_catalog_name_reservations').countDocuments();
    const warehouse = jest.spyOn(ctx.app.get(StockCoreService), 'defaultWarehouse').mockRejectedValueOnce(new BadRequestException('Ошибка фикстуры размещения'));
    try { await post(dto).expect(400); } finally { warehouse.mockRestore(); }
    expect(await db().collection('materials').countDocuments({ name: dto.name })).toBe(0);
    expect(await db().collection('counters').find().sort({ _id: 1 }).toArray()).toEqual(before);
    expect(await db().collection('stock_catalog_name_reservations').countDocuments()).toBe(lockCount);
    const made = (await post(dto).expect(201)).body;
    expect(await db().collection('storageitems').countDocuments({ materialId: new Types.ObjectId(made.id) })).toBe(1);
  });

  it('архив, обрезок, сортамент и деталь исключены; в независимой категории можно создать такой же формат', async () => {
    for (const [name, fields] of [['Архив', { deletedAt: new Date() }], ['Обрезок', { offcutOf: new Types.ObjectId() }],
      ['Сортамент', { isProfile: true }], ['Деталь', { materialKind: 'part' }]] as const) await seed(name, 80, fields);
    await post(body('Новый прокат', 80)).expect(201);
    await post({ ...body('Другой прокат', 80), categoryId: String(otherCat) }, other).expect(201);
  });

  it('лист: явный формат, строгая валидация осей, вид и зона обязательны', async () => {
    const sheet = { kind: 'sheet', categoryId: String(sheetCat), unit: 'лист', materialGrade: 'AISI 304', name: 'Лист А', dims: { length: 2500, width: 1250, thickness: 3 } };
    const made = (await post(sheet, sheetZone).expect(201)).body;
    expect((await post({ ...sheet, name: 'Лист Б' }, sheetZone).expect(409)).body.details[0].materialId).toBe(made.id);
    await post({ ...sheet, categoryId: String(cat) }, zone).expect(400);
    await post({ ...sheet, dims: { ...sheet.dims, length: '0x20' } }, sheetZone).expect(400);
    await post({ ...sheet, dims: { ...sheet.dims, extra: 1 } }, sheetZone).expect(400);
    await post({ ...sheet, quantity: 9 }, sheetZone).expect(400);
    await post(sheet, '').expect(400);
  });

  it('обычный POST сохраняет переиспользование имени; прежний зональный POST отклоняет дубль имени', async () => {
    const regular = { name: 'Обычный POST', categoryId: String(cat), unit: 'шт' };
    const send = () => http().post('/api/stock/items').set(authHeader(admin)).send(regular).expect(201);
    expect((await send()).body.id).toBe((await send()).body.id);
    await http().post('/api/stock/items').query({ zoneId: zone }).set(authHeader(admin)).send(regular).expect(409);
  });
});
