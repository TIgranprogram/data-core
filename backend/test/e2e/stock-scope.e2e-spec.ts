import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** СМ.4 — склад по роли: roles.stockCategoryIds режет чтение и запись склада; пусто — весь склад. */
describe('Склад по роли (СМ.4)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  let tokA = '';
  let tokFree = '';
  let scopedRoleId = '';
  let catA = '';
  let catB = '';
  let itemA = '';
  let itemB = '';

  const mkUser = async (key: string, role: string) => {
    const username = `scope-${key}-${Date.now()}`;
    await http().post('/api/admin/users').set(as(admin.access)).send({ username, password: 'role-pass-123', role }).expect(201);
    return (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access as string;
  };
  const names = (body: { items: Array<{ name?: string }> }) => body.items.map((x) => x.name);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    const t = as(admin.access);
    itemA = (await http().post('/api/stock/items').set(t).send({ name: 'Труба скоупа A', unit: 'шт', categoryName: 'Скоуп А' }).expect(201)).body.id;
    itemB = (await http().post('/api/stock/items').set(t).send({ name: 'Лист скоупа B', unit: 'шт', categoryName: 'Скоуп Б' }).expect(201)).body.id;
    await http().post('/api/stock/batch').set(t).send({ type: 'in', lines: [{ materialId: itemA, qty: 10 }, { materialId: itemB, qty: 10 }] }).expect(201);
    const cats = (await http().get('/api/stock/categories').set(t).expect(200)).body as Array<{ id: string; name: string }> | { items: Array<{ id: string; name: string }> };
    const list = Array.isArray(cats) ? cats : cats.items;
    catA = list.find((c) => c.name === 'Скоуп А')!.id;
    catB = list.find((c) => c.name === 'Скоуп Б')!.id;
    const role = (await http().post('/api/roles').set(t).send({ label: 'Трубарез скоупа', baseRole: 'manager', stockCategoryIds: [catA] }).expect(201)).body;
    scopedRoleId = role.id;
    tokA = await mkUser('a', role.name);
    const free = (await http().post('/api/roles').set(t).send({ label: 'Склад без скоупа', baseRole: 'manager' }).expect(201)).body;
    tokFree = await mkUser('free', free.name);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('items / lookup / categories — только своя категория; фильтр чужой не открывает', async () => {
    const a = as(tokA);
    const items = (await http().get('/api/stock/items').set(a).expect(200)).body;
    expect(names(items)).toEqual(['Труба скоупа A']);
    const filtered = (await http().get('/api/stock/items').query({ categoryId: catB }).set(a).expect(200)).body;
    expect(names(filtered)).not.toContain('Лист скоупа B');
    const both = (await http().get('/api/stock/items').query({ categoryId: `${catA},${catB}` }).set(a).expect(200)).body;
    expect(names(both)).toEqual(['Труба скоупа A']);
    const lk = (await http().get('/api/stock/lookup').set(a).expect(200)).body;
    expect(names(lk)).toEqual(['Труба скоупа A']);
    const cats = (await http().get('/api/stock/categories').set(a).expect(200)).body;
    const list = Array.isArray(cats) ? cats : cats.items;
    expect(list.map((c: { name: string }) => c.name)).toEqual(['Скоуп А']);
  });

  it('movements — только своя категория', async () => {
    const mv = (await http().get('/api/stock/movements').query({ limit: 100 }).set(as(tokA)).expect(200)).body;
    const s = JSON.stringify(mv);
    expect(mv.items.length).toBeGreaterThan(0);
    expect(s).toContain('Труба скоупа A');
    expect(s).not.toContain('Лист скоупа B');
    const all = JSON.stringify((await http().get('/api/stock/movements').query({ limit: 100 }).set(as(tokFree)).expect(200)).body);
    expect(all).toContain('Лист скоупа B');
  });

  it('batch и move: чужая позиция — 403, своя — успех', async () => {
    const a = as(tokA);
    await http().post('/api/stock/batch').set(a).send({ type: 'in', lines: [{ materialId: itemB, qty: 1 }] }).expect(403);
    await http().post('/api/stock/batch').set(a).send({ type: 'in', lines: [{ materialId: itemA, qty: 1 }, { materialId: itemB, qty: 1 }] }).expect(403);
    await http().post(`/api/stock/items/${itemB}/move`).set(a).send({ type: 'in', qty: 1 }).expect(403);
    await http().post('/api/stock/batch').set(a).send({ type: 'in', lines: [{ materialId: itemA, qty: 1 }] }).expect(201);
    await http().post(`/api/stock/items/${itemA}/move`).set(a).send({ type: 'in', qty: 1 }).expect(201);
  });

  it('PATCH и DELETE позиции: чужая — 403', async () => {
    const a = as(tokA);
    await http().patch(`/api/stock/items/${itemB}`).set(a).send({ note: 'x' }).expect(403);
    await http().delete(`/api/stock/items/${itemB}`).set(a).expect((r) => { if (r.status !== 403) throw new Error(`ожидался 403, пришёл ${r.status}`); });
    await http().patch(`/api/stock/items/${itemA}`).set(a).send({ note: 'своя' }).expect(200);
  });

  it('POST items: без категории — в A; своя по имени — ок; чужая — 403', async () => {
    const a = as(tokA);
    const made = (await http().post('/api/stock/items').set(a).send({ name: 'Новая без категории', unit: 'шт' }).expect(201)).body;
    expect(names((await http().get('/api/stock/items').set(a).expect(200)).body)).toContain('Новая без категории');
    expect(String(made.categoryId ?? made.categoryName ?? '')).toMatch(new RegExp(`${catA}|Скоуп А`));
    await http().post('/api/stock/items').set(a).send({ name: 'Новая своя', unit: 'шт', categoryName: 'Скоуп А' }).expect(201);
    await http().post('/api/stock/items').set(a).send({ name: 'Новая чужая', unit: 'шт', categoryName: 'Скоуп Б' }).expect(403);
    await http().post('/api/stock/items').set(a).send({ name: 'Новая чужая id', unit: 'шт', categoryId: catB }).expect(403);
  });

  it('роль без stockCategoryIds видит обе; снятие категорий PATCH-ем сразу открывает весь склад', async () => {
    expect(names((await http().get('/api/stock/items').set(as(tokFree)).expect(200)).body)).toEqual(expect.arrayContaining(['Труба скоупа A', 'Лист скоупа B']));
    expect(names((await http().get('/api/stock/items').set(as(tokA)).expect(200)).body)).not.toContain('Лист скоупа B');
    await http().patch(`/api/roles/${scopedRoleId}`).set(as(admin.access)).send({ stockCategoryIds: [] }).expect(200);
    expect(names((await http().get('/api/stock/items').set(as(tokA)).expect(200)).body)).toEqual(expect.arrayContaining(['Труба скоупа A', 'Лист скоупа B']));
    await http().post('/api/stock/batch').set(as(tokA)).send({ type: 'in', lines: [{ materialId: itemB, qty: 1 }] }).expect(201);
    await http().patch(`/api/roles/${scopedRoleId}`).set(as(admin.access)).send({ stockCategoryIds: [catA] }).expect(200);
    expect(names((await http().get('/api/stock/items').set(as(tokA)).expect(200)).body)).not.toContain('Лист скоупа B');
  });

  it('admin видит весь склад', async () => {
    expect(names((await http().get('/api/stock/items').set(as(admin.access)).expect(200)).body)).toEqual(expect.arrayContaining(['Труба скоупа A', 'Лист скоупа B']));
  });
});
