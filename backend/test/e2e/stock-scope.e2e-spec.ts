import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { signConfirmToken } from '../../src/common/confirm-token';

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
    // токен подтверждения снимает проверку пароля: 403 ниже — именно отказ по роли
    const me = (await http().get('/api/auth/me').set(a).expect(200)).body;
    const denied = await http().delete(`/api/stock/items/${itemB}`).set(a).set('x-confirm-token', signConfirmToken(me.id)).expect(403);
    expect(JSON.stringify(denied.body)).not.toContain('CONFIRM_REQUIRED');
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

/** СМ.5 — исправление списания (correct) и фильтры трубы: wash=1|0, pipeLength (мм). */
describe('Исправление списания и фильтры трубы (СМ.5)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  const names = (body: { items: Array<{ name?: string }> }) => body.items.map((x) => x.name);
  let pipeId = '';
  let plainId = '';
  let otherId = '';
  let tokRound = '';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    const t = as(admin.access);
    pipeId = (await http().post('/api/stock/items').set(t).send({ name: 'Труба мытая СМ5', unit: 'шт', categoryName: 'Круглая труба', washed: true, dims: { length: 6000 } }).expect(201)).body.id;
    plainId = (await http().post('/api/stock/items').set(t).send({ name: 'Труба немытая СМ5', unit: 'шт', categoryName: 'Круглая труба', washed: false, dims: { length: 12000 } }).expect(201)).body.id;
    otherId = (await http().post('/api/stock/items').set(t).send({ name: 'Лист СМ5', unit: 'шт', categoryName: 'Скоуп СМ5' }).expect(201)).body.id;
    await http().post('/api/stock/batch').set(t).send({ type: 'in', lines: [{ materialId: pipeId, qty: 20 }, { materialId: plainId, qty: 4 }, { materialId: otherId, qty: 10 }] }).expect(201);
    const cats = (await http().get('/api/stock/categories').set(t).expect(200)).body as Array<{ id: string; name: string }> | { items: Array<{ id: string; name: string }> };
    const roundCatId = (Array.isArray(cats) ? cats : cats.items).find((c) => c.name === 'Круглая труба')!.id;
    const role = (await http().post('/api/roles').set(t).send({ label: 'Труба СМ5', baseRole: 'manager', stockCategoryIds: [roundCatId] }).expect(201)).body;
    const username = `sm5-round-${Date.now()}`;
    await http().post('/api/admin/users').set(t).send({ username, password: 'role-pass-123', role: role.name }).expect(201);
    tokRound = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access as string;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('wash=1 и pipeLength=6000 — по одной верной; вместе — одна; wash в строке', async () => {
    const a = as(admin.access);
    expect(names((await http().get('/api/stock/items').query({ wash: '1' }).set(a).expect(200)).body)).toEqual(['Труба мытая СМ5']);
    expect(names((await http().get('/api/stock/items').query({ pipeLength: '6000' }).set(a).expect(200)).body)).toEqual(['Труба мытая СМ5']);
    expect(names((await http().get('/api/stock/items').query({ wash: '1', pipeLength: '6000' }).set(a).expect(200)).body)).toEqual(['Труба мытая СМ5']);
    expect(names((await http().get('/api/stock/items').query({ wash: '0', pipeLength: '12000' }).set(a).expect(200)).body)).toEqual(['Труба немытая СМ5']);
    expect(names((await http().get('/api/stock/items').query({ wash: '0', pipeLength: '6000' }).set(a).expect(200)).body)).toEqual([]);
    const rows = (await http().get('/api/stock/items').query({ wash: '1' }).set(a).expect(200)).body.items as Array<{ id: string; washed?: boolean | null }>;
    expect(rows.find((r) => r.id === pipeId)?.washed).toBe(true);
  });

  it('correct: списание 5 → верно 3; остаток 20 − 3 = 17; старое отменено; новое с примечанием «было 5»', async () => {
    const a = as(admin.access);
    await http().post(`/api/stock/items/${pipeId}/move`).set(a).send({ type: 'out', qty: 5, reason: 'Брак', writeOff: true }).expect(201);
    expect((await http().get(`/api/stock/items/${pipeId}`).set(a).expect(200)).body.quantity).toBe(15);
    const outId = (await http().get('/api/stock/movements').query({ materialId: pipeId, type: 'out' }).set(a).expect(200)).body.items[0].id as string;
    await http().post(`/api/stock/movements/${outId}/correct`).set(a).send({ qty: 3 }).expect(201);
    expect((await http().get(`/api/stock/items/${pipeId}`).set(a).expect(200)).body.quantity).toBe(17);
    const mv = (await http().get('/api/stock/movements').query({ materialId: pipeId, limit: 100 }).set(a).expect(200)).body.items as Array<{ id: string; type: string; note: string; cancelledAt: unknown; issuedTo: string | null; reason: string | null }>;
    expect(mv.find((m) => m.id === outId)?.cancelledAt).toBeTruthy();
    const fresh = mv.find((m) => m.type === 'out' && m.note === 'Исправлено: было 5');
    expect(fresh).toBeDefined();
    expect(fresh?.issuedTo).toBeNull();
    expect(fresh?.reason).toBe('Брак');
  });

  it('correct на приход — 409', async () => {
    const inId = (await http().get('/api/stock/movements').query({ materialId: pipeId, type: 'in' }).set(as(admin.access)).expect(200)).body.items[0].id as string;
    await http().post(`/api/stock/movements/${inId}/correct`).set(as(admin.access)).send({ qty: 1 }).expect(409);
  });

  it('correct чужой категории ролью — 403; своя категория — 201', async () => {
    const a = as(admin.access);
    await http().post(`/api/stock/items/${otherId}/move`).set(a).send({ type: 'out', qty: 2, reason: 'Брак', writeOff: true }).expect(201);
    const otherOut = (await http().get('/api/stock/movements').query({ materialId: otherId, type: 'out' }).set(a).expect(200)).body.items[0].id as string;
    await http().post(`/api/stock/movements/${otherOut}/correct`).set(as(tokRound)).send({ qty: 1 }).expect(403);
    const ownOut = (await http().get('/api/stock/movements').query({ materialId: pipeId, type: 'out' }).set(a).expect(200)).body.items[0].id as string;
    await http().post(`/api/stock/movements/${ownOut}/correct`).set(as(tokRound)).send({ qty: 3 }).expect(201);
  });
});

/** Металл без остатка и заказа (isEmptyMetal, 2026-10-30): нулевая труба скрыта от admin и всех ролей без категории, видна роли со своей категорией. */
describe('Металл без остатка скрыт, с остатком — виден всем (СМ.6)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  const names = (body: { items: Array<{ name?: string }> }) => body.items.map((x) => x.name);
  let tokRound = '';
  let tokFree = '';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    const t = as(admin.access);
    const emptyId = (await http().post('/api/stock/items').set(t).send({ name: 'Труба пустая МЕТ', unit: 'шт', categoryName: 'Круглая труба' }).expect(201)).body.id as string;
    const stockId = (await http().post('/api/stock/items').set(t).send({ name: 'Труба с остатком МЕТ', unit: 'шт', categoryName: 'Круглая труба' }).expect(201)).body.id as string;
    await http().post('/api/stock/items').set(t).send({ name: 'Болт пустой МЕТ', unit: 'шт', categoryName: 'Крепёж МЕТ' }).expect(201);
    await http().post('/api/stock/batch').set(t).send({ type: 'in', lines: [{ materialId: stockId, qty: 5 }] }).expect(201);
    expect(emptyId).toBeTruthy();
    const cats = (await http().get('/api/stock/categories').set(t).expect(200)).body as Array<{ id: string; name: string }> | { items: Array<{ id: string; name: string }> };
    const roundCatId = (Array.isArray(cats) ? cats : cats.items).find((c) => c.name === 'Круглая труба')!.id;
    const role = (await http().post('/api/roles').set(t).send({ label: 'Труба МЕТ', baseRole: 'manager', stockCategoryIds: [roundCatId] }).expect(201)).body;
    const username = `met-round-${Date.now()}`;
    await http().post('/api/admin/users').set(t).send({ username, password: 'role-pass-123', role: role.name }).expect(201);
    tokRound = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access as string;
    const freeRole = (await http().post('/api/roles').set(t).send({ label: 'Склад МЕТ без скоупа', baseRole: 'manager' }).expect(201)).body;
    const freeUser = `met-free-${Date.now()}`;
    await http().post('/api/admin/users').set(t).send({ username: freeUser, password: 'role-pass-123', role: freeRole.name }).expect(201);
    tokFree = (await http().post('/api/auth/login').send({ username: freeUser, password: 'role-pass-123' }).expect(200)).body.access as string;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('admin: нулевая труба не видна в /items, /lookup и /categories; с остатком и не-металл — видны', async () => {
    const a = as(admin.access);
    const items = names((await http().get('/api/stock/items').set(a).expect(200)).body);
    expect(items).toContain('Труба с остатком МЕТ');
    expect(items).toContain('Болт пустой МЕТ');
    expect(items).not.toContain('Труба пустая МЕТ');
    const lk = names((await http().get('/api/stock/lookup').set(a).expect(200)).body);
    expect(lk).toContain('Труба с остатком МЕТ');
    expect(lk).not.toContain('Труба пустая МЕТ');
    const cats = (await http().get('/api/stock/categories').set(a).expect(200)).body;
    const list = (Array.isArray(cats) ? cats : cats.items) as Array<{ name: string; total: number }>;
    expect(list.find((c) => c.name === 'Круглая труба')?.total).toBe(1);
  });

  it('роль со своей категорией «Круглая труба»: нулевая труба видна в /items, /lookup и /categories', async () => {
    const r = as(tokRound);
    expect(names((await http().get('/api/stock/items').set(r).expect(200)).body)).toEqual(expect.arrayContaining(['Труба пустая МЕТ', 'Труба с остатком МЕТ']));
    expect(names((await http().get('/api/stock/lookup').set(r).expect(200)).body)).toContain('Труба пустая МЕТ');
    const cats = (await http().get('/api/stock/categories').set(r).expect(200)).body;
    const list = (Array.isArray(cats) ? cats : cats.items) as Array<{ name: string; total: number }>;
    expect(list.find((c) => c.name === 'Круглая труба')?.total).toBe(2);
  });

  it('роль без категорий: с остатком видна, нулевая скрыта (правило одно для всех без скоупа)', async () => {
    const f = as(tokFree);
    const items = names((await http().get('/api/stock/items').set(f).expect(200)).body);
    expect(items).toContain('Труба с остатком МЕТ');
    expect(items).not.toContain('Труба пустая МЕТ');
  });
});
