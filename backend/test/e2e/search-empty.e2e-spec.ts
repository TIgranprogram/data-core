import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * Поиск: пусто = всё (TASKS ПО.4, CANON §2). Ключевые списки «Рабочего места»: ввели слово → нашлось меньше,
 * стёрли (search='' или одни пробелы) → столько же, сколько без поиска.
 */
describe('Пустой поиск = список целиком', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const total = async (path: string, query: Record<string, string>) =>
    (await http().get('/api' + path).query(query).set(authHeader(token.access)).expect(200)).body.total as number;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['materials', 'storageitems', 'stockmovements', 'supplyrequests', 'warehouses', 'partners', 'salesorders']) await db().collection(c).deleteMany({});
    await db().collection('warehouses').insertOne({ name: 'Главный склад', type: 'main', isActive: true, isDefault: false, deletedAt: null, createdAt: new Date() });
    const auth = authHeader(token.access);
    for (const name of ['Болт М10×40', 'Гайка М10', 'Шайба М10']) {
      const it = await http().post('/api/stock/items').set(auth).send({ name, unit: 'шт', categoryName: 'Метизы' }).expect(201);
      await http().post(`/api/stock/items/${it.body.id}/receipt`).set(auth).send({ quantity: 5 });
      await http().post('/api/supply/requests').set(auth).send({ title: name, qty: 10, unit: 'шт', clientUid: 'po-' + name }).expect(201);
    }
    for (const name of ['Парк Победы', 'Школа №5']) await http().post('/api/partners').set(auth).send({ kind: 'customer', name }).expect(201);
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it.each([
    ['/stock/items', {}, 'болт'],
    ['/supply/requests', {}, 'болт'],
    ['/stock/movements', {}, 'болт'],
    ['/partners', { type: 'customer' }, 'парк'],
    ['/salesorders', {}, 'парк'],
  ])('%s: слово → меньше; пусто и пробелы → как без поиска', async (path, extra, word) => {
    const all = await total(path, extra as Record<string, string>);
    const found = await total(path, { ...(extra as Record<string, string>), search: word });
    expect(found).toBeLessThanOrEqual(all);
    expect(await total(path, { ...(extra as Record<string, string>), search: '' })).toBe(all);
    expect(await total(path, { ...(extra as Record<string, string>), search: '   ' })).toBe(all);
  });

  it('данные есть: склад и заказчики не пусты, поиск по слову находит меньше', async () => {
    expect(await total('/stock/items', {})).toBe(3);
    expect(await total('/stock/items', { search: 'болт' })).toBe(1);
    expect(await total('/supply/requests', {})).toBe(3);
    expect(await total('/partners', { type: 'customer' })).toBe(2);
    expect(await total('/partners', { type: 'customer', search: 'парк' })).toBe(1);
  });
});
