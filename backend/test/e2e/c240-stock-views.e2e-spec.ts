import request from 'supertest';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';

describe('C240 — HTTP настройки экранов без новых серверных прав', () => {
  let ctx: TestContext, admin: string, director: string, roleId: string, roleName: string;
  let ownCategory: string, foreignCategory: string, ownZone: string, foreignZone: string;
  let ownItem: string, foreignItem: string;
  const http = () => request(ctx.app.getHttpServer());
  const auth = (token = admin) => authHeader(token);
  const db = () => ctx.connection.db!;
  const profile = async (token = director) => (await http().get('/api/auth/me').set(auth(token)).expect(200)).body;
  const account = async (name: string, role: string) => {
    const username = `c240-${name}`;
    await http().post('/api/admin/users').set(auth()).send({ username, role, password: 'c240-test-password' }).expect(201);
    return (await http().post('/api/auth/login').send({ username, password: 'c240-test-password' }).expect(200)).body;
  };

  beforeAll(async () => {
    const target = new URL(process.env.MONGO_URI!);
    if (process.env.MONGO_DB_TEST !== 'datacore-test-c240-c242' || !['localhost', '127.0.0.1'].includes(target.hostname)) throw Error('C240: только выделенная локальная test-БД');
    ctx = await createTestApp({ strictValidation: true });
    admin = (await loginAsAdmin(ctx.app)).access;
    ownItem = (await http().post('/api/stock/items').set(auth()).send({ name: 'C240 своя труба', unit: 'м', categoryName: 'C240 трубы' }).expect(201)).body.id;
    foreignItem = (await http().post('/api/stock/items').set(auth()).send({ name: 'C240 чужой лист', unit: 'м²', categoryName: 'C240 листы' }).expect(201)).body.id;
    const categories = (await http().get('/api/stock/categories').set(auth()).expect(200)).body.items;
    ownCategory = categories.find((row: { name: string }) => row.name === 'C240 трубы').id;
    foreignCategory = categories.find((row: { name: string }) => row.name === 'C240 листы').id;
    ownZone = (await http().post('/api/stockzones').set(auth()).send({ name: 'C240 своя зона', categoryIds: [ownCategory] }).expect(201)).body.id;
    foreignZone = (await http().post('/api/stockzones').set(auth()).send({ name: 'C240 чужая зона', categoryIds: [foreignCategory] }).expect(201)).body.id;
    const role = (await http().post('/api/roles').set(auth()).send({ label: 'C240 директор склада', baseRole: 'director',
      appSections: ['stock'], money: false, warehouseIds: [ownZone], stockCategoryIds: [ownCategory] }).expect(201)).body;
    roleId = role.id; roleName = role.name;
    director = (await account('custom-director', roleName)).access;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('login.user и auth/me: builtin/custom director наследуют pipe+sheet, основная роль и деньги прежние', async () => {
    const builtin = await account('builtin-director', 'director');
    expect(builtin.user.stockViews).toEqual(['pipe', 'sheet']);
    expect((await profile(builtin.access)).stockViews).toEqual(['pipe', 'sheet']);
    const login = await http().post('/api/auth/login').send({ username: 'c240-custom-director', password: 'c240-test-password' }).expect(200);
    expect(login.body.user).toMatchObject({ role: roleName, baseRole: 'director', stockViews: ['pipe', 'sheet'], canMoney: false, isOwner: false });
    expect(await profile()).toMatchObject({ role: roleName, baseRole: 'director', stockViews: ['pipe', 'sheet'], sections: ['stock'], canMoney: false });
    const observerRole = (await http().post('/api/roles').set(auth()).send({ label: 'C240 наблюдатель', baseRole: 'user', appSections: ['stock'] }).expect(201)).body;
    expect((await account('observer', observerRole.name)).user.stockViews).toEqual([]);
  });

  it('HTTP PATCH []/omit/reset применяются свежим auth/me и не меняют остальные права/scope', async () => {
    const before = await profile();
    await http().patch(`/api/roles/${roleId}`).set(auth()).send({ stockViews: [] }).expect(200);
    expect((await profile()).stockViews).toEqual([]);
    await http().patch(`/api/roles/${roleId}`).set(auth()).send({ label: 'C240 директор после переименования' }).expect(200);
    expect((await profile()).stockViews).toEqual([]);
    const explicit = (await db().collection('roles').findOne({ name: roleName }))!;
    expect(explicit.stockViews).toEqual([]);
    await http().patch(`/api/roles/${roleId}`).set(auth()).send({ resetStockViews: true }).expect(200);
    const reset = (await db().collection('roles').findOne({ name: roleName }))!;
    expect(reset).not.toHaveProperty('stockViews'); expect(reset).not.toHaveProperty('resetStockViews');
    const after = await profile();
    expect(after.stockViews).toEqual(['pipe', 'sheet']);
    for (const key of ['role', 'baseRole', 'sections', 'permissions', 'canMoney', 'isOwner']) expect(after[key]).toEqual(before[key]);
    for (const key of ['warehouseIds', 'stockCategoryIds', 'money', 'permissions', 'baseRole', 'appSections']) expect(reset[key]).toEqual(explicit[key]);
    for (const stockViews of [['pipe'], ['sheet']]) {
      await http().patch(`/api/roles/${roleId}`).set(auth()).send({ stockViews }).expect(200);
      expect((await profile()).stockViews).toEqual(stockViews);
    }
  });

  it('strict create/PATCH отклоняют null/unknown/duplicate/reset-комбинации без изменения роли', async () => {
    for (const stockViews of [null, ['wood'], ['pipe', 'pipe'], ['pipe', 'sheet', 'pipe'], 'pipe']) {
      const before = await db().collection('roles').findOne({ name: roleName });
      await http().patch(`/api/roles/${roleId}`).set(auth()).send({ stockViews }).expect(400);
      expect(await db().collection('roles').findOne({ name: roleName })).toEqual(before);
      await http().post('/api/roles').set(auth()).send({ label: 'C240 неверная роль', baseRole: 'director', stockViews }).expect(400);
    }
    for (const body of [{ resetStockViews: false }, { resetStockViews: null }, { resetStockViews: true, stockViews: [] }]) {
      await http().patch(`/api/roles/${roleId}`).set(auth()).send(body).expect(400);
    }
    await http().post('/api/roles').set(auth()).send({ label: 'C240 reset при создании', baseRole: 'director', resetStockViews: true }).expect(400);
  });

  it('просмотр не выдаёт CRUD ролей или owner-only; прежние права записи директора и границы склада сохранены', async () => {
    for (const stockViews of [[], ['pipe', 'sheet']]) {
      await http().patch(`/api/roles/${roleId}`).set(auth()).send({ stockViews }).expect(200);
      const items = (await http().get('/api/stock/items').set(auth(director)).expect(200)).body.items;
      expect(items.map((row: { id: string }) => row.id)).toContain(ownItem);
      expect(items.map((row: { id: string }) => row.id)).not.toContain(foreignItem);
      await http().get('/api/stock/items').query({ zoneId: foreignZone }).set(auth(director)).expect(403);
      await http().patch(`/api/stock/items/${foreignItem}`).set(auth(director)).send({ notes: 'Не разрешено' }).expect(403);
      await http().post('/api/stock/items').set(auth(director)).send({ name: `C240 прежняя API запись ${stockViews.length}`, unit: 'м', categoryId: ownCategory }).expect(201);
      await http().post('/api/roles').set(auth(director)).send({ label: 'C240 запрет', baseRole: 'user' }).expect(403);
      await http().patch(`/api/roles/${roleId}`).set(auth(director)).send({ stockViews: ['pipe'] }).expect(403);
      await http().delete(`/api/roles/${roleId}`).set(auth(director)).expect(403);
      await http().get('/api/admin/roles').set(auth(director)).expect(403);
      await http().get('/api/admin/permissions').set(auth(director)).expect(403);
    }
  });

  it('stockViews не обходит отключённый раздел stock', async () => {
    await http().patch(`/api/roles/${roleId}`).set(auth()).send({ appSections: ['requests'], stockViews: ['pipe', 'sheet'] }).expect(200);
    expect(await profile()).toMatchObject({ sections: ['requests'], stockViews: ['pipe', 'sheet'] });
    await http().get('/api/stock/items').set(auth(director)).expect(403);
    await http().patch(`/api/roles/${roleId}`).set(auth()).send({ appSections: ['stock'] }).expect(200);
  });

  it('CRUD собственной роли остаётся прежним: незанятая удаляется, назначенная защищена', async () => {
    const created = (await http().post('/api/roles').set(auth()).send({ label: 'C240 удалить', baseRole: 'manager', stockViews: ['pipe'] }).expect(201)).body;
    await http().get(`/api/roles/${created.id}`).set(auth()).expect(200);
    await http().patch(`/api/roles/${created.id}`).set(auth()).send({ stockViews: [] }).expect(200);
    await http().delete(`/api/roles/${created.id}`).set(auth()).expect(204);
    await http().delete(`/api/roles/${roleId}`).set(auth()).expect(409);
  });
});
