import request from 'supertest';
import { Types } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * C043: массовая правка отмеченных позиций «Остатков» — PATCH /api/stock/items/bulk и /bulk/restore.
 * Маршруты объявлены раньше items/:id (Express берёт первое совпадение) — проверяем, что «bulk» не уходит в :id.
 */
describe('C043: массовая правка позиций склада', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  let first = '';
  let second = '';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    const db = ctx.connection.db!;
    for (const c of ['materials', 'storageitems', 'categories', 'warehouses', 'auditlogs']) await db.collection(c).deleteMany({});
    await db.collection('warehouses').insertOne({ name: 'Главный склад', type: 'main', isActive: true, isDefault: false, deletedAt: null, createdAt: new Date() });
    first = (await http().post('/api/stock/items').set(auth()).send({ name: 'Алюминиевый соединитель 20х20', unit: 'шт', categoryName: 'Профиль' }).expect(201)).body.id;
    second = (await http().post('/api/stock/items').set(auth()).send({ name: 'Оцинкованный саморез 4,2х20', unit: 'шт', categoryName: 'Метизы' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('проверки до записи: без отмеченных/без полей/больше 500 → 400, ничего не меняется', async () => {
    await http().patch('/api/stock/items/bulk').set(auth()).send({ ids: [], set: { unit: 'кг' } }).expect(400);
    await http().patch('/api/stock/items/bulk').set(auth()).send({ ids: [first], set: {} }).expect(400);
    // 501 РАЗНЫХ id: повтор одного id схлопывается до одного — это не «больше 500» (проверка списка до записи)
    const many = Array.from({ length: 501 }, () => new Types.ObjectId().toHexString());
    await http().patch('/api/stock/items/bulk').set(auth()).send({ ids: many, set: { unit: 'кг' } }).expect(400);
    const one = await http().get(`/api/stock/items/${first}`).set(auth()).expect(200);
    expect(one.body.unit).toBe('шт');
  });

  it('меняет только белый список, отдаёт before для «Отменить»; GET отдаёт typeName', async () => {
    const bulk = await http().patch('/api/stock/items/bulk').set(auth())
      .send({ ids: [first, second], set: { typeName: 'Соединитель', unit: 'м', materialGrade: 'Ст3', notes: 'нельзя' } })
      .expect(200);
    expect(bulk.body.updated).toBe(2);
    expect(bulk.body.failed).toEqual([]);
    expect(bulk.body.before).toHaveLength(2);
    const item = await http().get(`/api/stock/items/${first}`).set(auth()).expect(200);
    expect(item.body).toMatchObject({ typeName: 'Соединитель', unit: 'м', materialGrade: 'Ст3' });
    expect(item.body.notes).not.toBe('нельзя');
    const list = await http().get('/api/stock/items').set(auth()).expect(200);
    expect(list.body.items.filter((i: { typeName?: string }) => i.typeName === 'Соединитель')).toHaveLength(2);

    const back = await http().patch('/api/stock/items/bulk/restore').set(auth()).send({ items: bulk.body.before }).expect(200);
    expect(back.body.restored).toBe(2);
    const restored = await http().get(`/api/stock/items/${first}`).set(auth()).expect(200);
    expect(restored.body).toMatchObject({ unit: 'шт', typeName: null, materialGrade: null });
  });

  it('категория по названию: создаётся и ставится всем отмеченным', async () => {
    const bulk = await http().patch('/api/stock/items/bulk').set(auth()).send({ ids: [first, second], set: { categoryName: 'Крепёж общий' } }).expect(200);
    expect(bulk.body.updated).toBe(2);
    const list = await http().get('/api/stock/items').set(auth()).expect(200);
    expect(list.body.items.filter((i: { categoryName?: string }) => i.categoryName === 'Крепёж общий')).toHaveLength(2);
    const cats = await ctx!.connection.db!.collection('categories').find({ name: 'Крепёж общий' }).toArray();
    expect(cats).toHaveLength(1);
  });

  it('битый id — в failed, живые позиции обновляются', async () => {
    const bulk = await http().patch('/api/stock/items/bulk').set(auth()).send({ ids: [first, 'мусор'], set: { unit: 'уп' } }).expect(200);
    expect(bulk.body.updated).toBe(1);
    expect(bulk.body.failed).toHaveLength(1);
    expect((await http().get(`/api/stock/items/${first}`).set(auth())).body.unit).toBe('уп');
  });

  it('обычный PATCH items/:id по-прежнему работает — маршрут bulk не перехватил :id', async () => {
    const one = await http().patch(`/api/stock/items/${second}`).set(auth()).send({ unit: 'компл' }).expect(200);
    expect(one.body).toMatchObject({ id: second, unit: 'компл' });
    expect(one.body.before).toBeUndefined();
  });
});
