import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, TestContext, clearCollections } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';

/** A3: журнал аудита — фильтры, значения для фильтров, валидация. */
describe('Audit logs (e2e, A3)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let jwt: string;
  let materialId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    jwt = (await loginAsAdmin(app)).access;
    await clearCollections(ctx.connection, ['auditlogs', 'materials']);
    const m = await http().post('/api/materials').set(authHeader(jwt)).send({ name: 'Журнал-тест', article: 'AUD-1', unit: 'шт' });
    expect(m.status).toBe(201);
    materialId = m.body.id;
    await http().patch(`/api/materials/${materialId}`).set(authHeader(jwt)).send({ name: 'Журнал-тест 2' }).expect(200);
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('без токена — 401', async () => {
    await http().get('/api/audit-logs').expect(401);
  });

  it('изменения материала видны в журнале, сначала новые; фильтр по записи и действию', async () => {
    const all = await http().get(`/api/audit-logs?entityType=Material&entityId=${materialId}`).set(authHeader(jwt)).expect(200);
    expect(all.body.total).toBe(2);
    expect(all.body.items.map((i: { action: string }) => i.action)).toEqual(['update', 'create']);
    expect(all.body.items[0].userName).toBe('admin');
    expect(typeof all.body.items[0].createdAt).toBe('string');
    const upd = await http().get(`/api/audit-logs?entityType=Material&action=update`).set(authHeader(jwt)).expect(200);
    expect(upd.body.total).toBe(1);
  });

  it('период: будущее — пусто, сегодня — есть', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const t = await http().get(`/api/audit-logs?entityType=Material&from=${today}&to=${today}`).set(authHeader(jwt)).expect(200);
    expect(t.body.total).toBe(2);
    const f = await http().get('/api/audit-logs?from=2099-01-01').set(authHeader(jwt)).expect(200);
    expect(f.body.total).toBe(0);
  });

  it('facets: типы, действия и пользователи для фильтров', async () => {
    const res = await http().get('/api/audit-logs/facets').set(authHeader(jwt)).expect(200);
    expect(res.body.entityTypes).toContain('Material');
    expect(res.body.actions).toEqual(expect.arrayContaining(['create', 'update']));
    expect(res.body.users.map((u: { userName: string }) => u.userName)).toContain('admin');
  });

  it('неверные параметры — 400, а не 500', async () => {
    await http().get('/api/audit-logs?userId=abc').set(authHeader(jwt)).expect(400);
    await http().get('/api/audit-logs?from=вчера').set(authHeader(jwt)).expect(400);
    await http().get('/api/audit-logs?page=0').set(authHeader(jwt)).expect(400);
  });
});

describe('C278 — общий журнал со складом директора', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: string;
  let director: string;
  let visibleIds: string[];
  let hiddenIds: string[];
  let categoryOnly: string;
  let defaultRequest: string;
  let legacyEvent: string;
  let archivedMaterial: string;
  const ownAuthor = new Types.ObjectId();
  const otherAuthor = new Types.ObjectId();
  const partnerAuthor = new Types.ObjectId();
  const http = () => request(app.getHttpServer());
  const list = (query: Record<string, string | number> = {}, token = director) => http().get('/api/audit-logs/app')
    .query({ from: '2026-10-01', to: '2026-10-31', ...query }).set(authHeader(token));
  const ids = (body: { items: Array<{ id: string }> }) => body.items.map((item) => item.id);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = (await loginAsAdmin(app)).access;
    const db = ctx.connection.db!;
    const cat = new Types.ObjectId();
    const catOther = new Types.ObjectId();
    const own = new Types.ObjectId();
    const archived = new Types.ObjectId();
    const other = new Types.ObjectId();
    const excluded = new Types.ObjectId();
    const added = new Types.ObjectId();
    const malformed = new Types.ObjectId();
    archivedMaterial = String(archived);
    await db.collection('categories').insertOne({ _id: cat, type: 'material', name: 'Участок директора', slug: 'c278-main' });
    await db.collection('materials').insertMany([
      { _id: own, name: 'Свой материал', categoryId: cat },
      { _id: archived, name: 'Снятый материал', categoryId: String(cat), deletedAt: new Date() },
      { _id: other, name: 'Чужой материал', categoryId: catOther },
      { _id: excluded, name: 'Исключение', categoryId: cat },
      { _id: added, name: 'Добавка', categoryId: catOther },
      { _id: malformed, name: 'Некорректная категория', categoryId: [cat] },
    ]);
    const zone = (await http().post('/api/stockzones').set(authHeader(admin)).send({
      name: 'Склад директора', categoryIds: [String(cat)], isDefault: true,
      includeMaterialIds: [String(added)], excludeMaterialIds: [String(excluded)],
    }).expect(201)).body;
    const role = (await http().post('/api/roles').set(authHeader(admin)).send({
      label: 'Директор участка', baseRole: 'director', warehouseIds: [zone.id], appSections: ['stock', 'requests', 'partners'],
    }).expect(201)).body;
    const credentials = { username: 'c278-director', password: 'role-pass-123' };
    await http().post('/api/admin/users').set(authHeader(admin)).send({ ...credentials, role: role.name }).expect(201);
    director = (await http().post('/api/auth/login').send(credentials).expect(200)).body.access;

    const moves = await db.collection('stockmovements').insertMany([
      { materialId: String(archived) }, { materialId: other }, { materialId: new Types.ObjectId() }, { productId: own },
    ]);
    const supply = await db.collection('supplyrequests').insertMany([
      { materialId: own, categoryId: catOther, deletedAt: new Date() }, { categoryId: String(cat) }, {},
      { materialId: other, categoryId: cat }, { materialId: [own], categoryId: cat }, { categoryId: catOther },
    ]);
    const event = (entityType: string, entityId: Types.ObjectId | string | undefined, day: number, attrs: Record<string, unknown> = {}) => ({
      _id: new Types.ObjectId(), entityType, ...(entityId === undefined ? {} : { entityId }),
      action: 'update', userId: ownAuthor, userName: 'Автор склада', createdAt: new Date(Date.UTC(2026, 9, day)),
      details: { after: { title: 'Событие журнала' } }, ...attrs,
    });
    const legacy = event('Material', undefined, 1, { details: { id: archivedMaterial, after: { name: 'Из архива' } } });
    const category = event('SupplyRequest', supply.insertedIds[1], 4);
    const unclassified = event('SupplyRequest', supply.insertedIds[2], 4);
    const visible = [
      legacy, event('Material', added, 2), event('StockMovement', moves.insertedIds[0], 3),
      event('SupplyRequest', supply.insertedIds[0], 3), category, unclassified,
      event('Counterparty', undefined, 5, { userId: partnerAuthor, userName: 'Автор контрагента', details: { id: 'c:Партнёр' } }),
    ];
    visibleIds = visible.map((log) => String(log._id)).reverse();
    legacyEvent = String(legacy._id);
    categoryOnly = String(category._id);
    defaultRequest = String(unclassified._id);
    const hidden = [
      event('Material', other, 6, { details: { id: archivedMaterial } }),
      event('Material', 'bad-id', 6, { details: { id: archivedMaterial } }),
      event('Material', excluded, 6), event('Material', added, 6, { action: 'stock.item.bulk' }),
      event('Material', malformed, 6), event('Material', new Types.ObjectId(), 6),
      event('StockMovement', moves.insertedIds[1], 6), event('StockMovement', moves.insertedIds[2], 6),
      event('StockMovement', moves.insertedIds[3], 6), event('StockMovement', moves.insertedIds[0], 6, { action: 'stock.reserve.released' }),
      event('SupplyRequest', supply.insertedIds[3], 6), event('SupplyRequest', supply.insertedIds[4], 6),
      event('SupplyRequest', supply.insertedIds[5], 6), event('SupplyRequest', undefined, 6),
      event('SupplyRequest', supply.insertedIds[0], 6, { action: 'supply.request.created', details: { after: { items: [{}] } } }),
      event('DesignTask', new Types.ObjectId(), 6),
    ];
    hiddenIds = hidden.map((log) => String(log._id));
    const background = Array.from({ length: 510 }, () => event('Material', other, 7));
    await db.collection('auditlogs').insertMany([...visible, ...[...hidden, ...background].map((log) => ({
      ...log, userId: otherAuthor, userName: 'Автор чужого склада',
    }))]);
  });

  afterAll(async () => { await ctx?.cleanup(); });

  it('сначала ограничивает видимость, затем считает итог и выдаёт устойчивые страницы', async () => {
    const first = (await list({ limit: 2 }).expect(200)).body;
    const second = (await list({ page: 2, limit: 2 }).expect(200)).body;
    expect(first).toMatchObject({ page: 1, limit: 2, total: visibleIds.length });
    expect(second).toMatchObject({ page: 2, limit: 2, total: visibleIds.length });
    expect(ids(first)).toEqual(visibleIds.slice(0, 2));
    expect(ids(second)).toEqual(visibleIds.slice(2, 4));
    expect(ids((await list().expect(200)).body)).toEqual(visibleIds);
    expect((await list({ page: 5, limit: 2 }).expect(200)).body).toMatchObject({ items: [], total: visibleIds.length });
  });

  it('проверяет источник для карточки события и сохраняет прежний legacy-ID', async () => {
    const legacy = (await list({ id: legacyEvent, limit: 1 }).expect(200)).body;
    expect(legacy.total).toBe(1);
    expect(legacy.items[0]).toMatchObject({ entityId: archivedMaterial, actorName: 'Автор склада', title: 'Из архива' });
    for (const id of hiddenIds) expect((await list({ id, limit: 1 }).expect(200)).body).toMatchObject({ items: [], total: 0 });
    expect((await list({ id: hiddenIds[0], limit: 1 }, admin).expect(200)).body.total).toBe(1);
    expect((await list({ id: legacyEvent, limit: 1 }, admin).expect(200)).body.items[0].entityId).toBe(archivedMaterial);
  });

  it('совмещает область с датой, автором и разделом', async () => {
    const day = (await list({ from: '2026-10-04', to: '2026-10-04', entityType: 'SupplyRequest', userId: String(ownAuthor) }).expect(200)).body;
    expect(day.total).toBe(2);
    expect(ids(day)).toEqual([defaultRequest, categoryOnly]);
    expect((await list({ userId: String(otherAuthor) }).expect(200)).body.total).toBe(0);
    const partners = (await list({ entityType: 'Counterparty' }).expect(200)).body;
    expect(partners).toMatchObject({ total: 1, items: [{ entityId: 'c:Партнёр', actorName: 'Автор контрагента' }] });
    await list({ entityType: 'DesignTask' }).expect(400);
  });

  it('возвращает только авторов видимых событий', async () => {
    const users = (await http().get('/api/audit-logs/app/users').set(authHeader(director)).expect(200)).body;
    expect(users).toEqual([
      { value: String(partnerAuthor), label: 'Автор контрагента' }, { value: String(ownAuthor), label: 'Автор склада' },
    ]);
    const all = (await http().get('/api/audit-logs/app/users').set(authHeader(admin)).expect(200)).body;
    expect(all).toContainEqual({ value: String(otherAuthor), label: 'Автор чужого склада' });
  });
});
