import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { User, UserDocument } from '../../src/modules/user/user.schema';

/**
 * P1 — /api/apps/:app/:collection: универсальное хранилище JSON-документов.
 * CRUD, пагинация, сортировка, фильтр (whitelist операторов), soft/hard delete,
 * права (401/403), реестр «Таблицы» (kind:'app'), аудит.
 */
describe('App data (/api/apps)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: string;
  let manager: string;
  let reader: string;

  const http = () => request(app.getHttpServer());

  async function createUser(role: string): Promise<string> {
    const users = app.get<Model<UserDocument>>(getModelToken(User.name));
    const username = `appdata-${role}-${Date.now()}`;
    const password = `appdata-${role}-pw`;
    await users.create({
      username,
      email: `${username}@datacore.local`,
      displayName: username,
      passwordHash: await bcrypt.hash(password, 10),
      role,
      permissions: [],
      isActive: true,
    });
    const res = await http().post('/api/auth/login').send({ username, password }).expect(200);
    return res.body.access;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = (await loginAsAdmin(app)).access;
    manager = await createUser('manager');
    reader = await createUser('user');
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  describe('доступ', () => {
    it('без токена → 401', async () => {
      await http().get('/api/apps').expect(401);
      await http().get('/api/apps/notes/items').expect(401);
      await http().post('/api/apps/notes/items').send({ a: 1 }).expect(401);
    });

    it('роль user читает, но не пишет (403)', async () => {
      await http().get('/api/apps/notes/items').set(authHeader(reader)).expect(200);
      await http().post('/api/apps/notes/items').set(authHeader(reader)).send({ a: 1 }).expect(403);
    });
  });

  describe('CRUD', () => {
    let id: string;

    it('POST создаёт документ: id + _id, служебные поля от сервера', async () => {
      const res = await http()
        .post('/api/apps/notes/items')
        .set(authHeader(manager))
        .send({ title: 'Первая', qty: 3, tags: ['a'], createdBy: 'хакер', _id: 'x', deletedAt: '2020-01-01' })
        .expect(201);
      id = res.body.id;
      expect(id).toMatch(/^[0-9a-f]{24}$/);
      expect(res.body._id).toBe(id);
      expect(res.body.title).toBe('Первая');
      expect(res.body.createdBy).not.toBe('хакер');
      expect(res.body.deletedAt).toBeNull();
      expect(res.body.createdAt).toBeDefined();
    });

    it('GET /:id', async () => {
      const res = await http().get(`/api/apps/notes/items/${id}`).set(authHeader(reader)).expect(200);
      expect(res.body).toMatchObject({ id, _id: id, title: 'Первая', qty: 3 });
    });

    it('PATCH сливает верхний уровень', async () => {
      const res = await http()
        .patch(`/api/apps/notes/items/${id}`)
        .set(authHeader(manager))
        .send({ qty: 5, done: true })
        .expect(200);
      expect(res.body).toMatchObject({ id, title: 'Первая', qty: 5, done: true, tags: ['a'] });
    });

    it('PUT заменяет документ, createdAt сохраняется', async () => {
      const before = await http().get(`/api/apps/notes/items/${id}`).set(authHeader(admin)).expect(200);
      const res = await http()
        .put(`/api/apps/notes/items/${id}`)
        .set(authHeader(manager))
        .send({ title: 'Заменён' })
        .expect(200);
      expect(res.body.title).toBe('Заменён');
      expect(res.body.qty).toBeUndefined();
      expect(res.body.createdAt).toBe(before.body.createdAt);
      const after = await http().get(`/api/apps/notes/items/${id}`).set(authHeader(admin)).expect(200);
      expect(after.body).toMatchObject({ id, title: 'Заменён' });
      expect(after.body.qty).toBeUndefined();
    });

    it('PATCH с $-оператором или ключом с точкой → 400', async () => {
      await http().patch(`/api/apps/notes/items/${id}`).set(authHeader(manager)).send({ $set: { a: 1 } }).expect(400);
      await http().patch(`/api/apps/notes/items/${id}`).set(authHeader(manager)).send({ 'a.b': 1 }).expect(400);
      await http().post('/api/apps/notes/items').set(authHeader(manager)).send({ x: { $gt: 1 } }).expect(400);
    });

    it('невалидный id → 400, отсутствующий → 404', async () => {
      await http().get('/api/apps/notes/items/not-an-id').set(authHeader(admin)).expect(400);
      await http().get('/api/apps/notes/items/0123456789abcdef01234567').set(authHeader(admin)).expect(404);
      await http().patch('/api/apps/notes/items/0123456789abcdef01234567').set(authHeader(admin)).send({ a: 1 }).expect(404);
      await http().put('/api/apps/notes/items/0123456789abcdef01234567').set(authHeader(admin)).send({ a: 1 }).expect(404);
      await http().delete('/api/apps/notes/items/0123456789abcdef01234567').set(authHeader(admin)).expect(404);
    });

    it('некорректные имена app/collection → 400', async () => {
      await http().get('/api/apps/Notes/items').set(authHeader(admin)).expect(400);
      await http().get('/api/apps/my_app/items').set(authHeader(admin)).expect(400);
      await http().get('/api/apps/notes/Items').set(authHeader(admin)).expect(400);
      await http().post('/api/apps/notes/x-y').set(authHeader(admin)).send({ a: 1 }).expect(400);
    });

    it('документ больше 256 КБ → 413', async () => {
      await http()
        .post('/api/apps/notes/items')
        .set(authHeader(manager))
        .send({ big: 'x'.repeat(300 * 1024) })
        .expect(413);
    });

    it('тело не объект → 400', async () => {
      await http().post('/api/apps/notes/items').set(authHeader(manager)).send([1, 2]).expect(400);
      await http().post('/api/apps/notes/items').set(authHeader(manager)).send([]).expect(400);
    });
  });

  describe('bulk, пагинация, сортировка, фильтр', () => {
    beforeAll(async () => {
      const docs = Array.from({ length: 25 }, (_, i) => ({
        n: i,
        group: i % 2 === 0 ? 'even' : 'odd',
        ...(i % 5 === 0 ? { flag: true } : {}),
      }));
      const res = await http().post('/api/apps/shop/orders').set(authHeader(manager)).send(docs).expect(201);
      expect(res.body.total).toBe(25);
      expect(res.body.items).toHaveLength(25);
      expect(res.body.items[0].id).toMatch(/^[0-9a-f]{24}$/);
    });

    it('bulk больше 500 → 400, плохой элемент → 400 без частичной записи', async () => {
      const many = Array.from({ length: 501 }, (_, i) => ({ i }));
      await http().post('/api/apps/shop/bulk').set(authHeader(manager)).send(many).expect(400);
      await http().post('/api/apps/shop/bulk').set(authHeader(manager)).send([{ ok: 1 }, { $bad: 1 }]).expect(400);
      const res = await http().get('/api/apps/shop/bulk').set(authHeader(admin)).expect(200);
      expect(res.body.total).toBe(0);
    });

    it('bulk 500 документов проходит', async () => {
      const many = Array.from({ length: 500 }, (_, i) => ({ i, pad: 'p'.repeat(100) }));
      const res = await http().post('/api/apps/shop/bulk').set(authHeader(manager)).send(many).expect(201);
      expect(res.body.total).toBe(500);
    });

    it('пагинация { items, total, page, limit }', async () => {
      const res = await http()
        .get('/api/apps/shop/orders?page=2&limit=10&sort=n')
        .set(authHeader(reader))
        .expect(200);
      expect(res.body).toMatchObject({ total: 25, page: 2, limit: 10 });
      expect(res.body.items.map((d: { n: number }) => d.n)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
      const big = await http().get('/api/apps/shop/orders?limit=1000').set(authHeader(reader)).expect(200);
      expect(big.body.limit).toBe(200);
      await http().get('/api/apps/shop/orders?page=0').set(authHeader(reader)).expect(400);
    });

    it('сортировка -field', async () => {
      const res = await http().get('/api/apps/shop/orders?sort=-n&limit=3').set(authHeader(reader)).expect(200);
      expect(res.body.items.map((d: { n: number }) => d.n)).toEqual([24, 23, 22]);
      await http().get('/api/apps/shop/orders?sort=$natural').set(authHeader(reader)).expect(400);
    });

    it('фильтр: равенство и операторы', async () => {
      const q = (f: unknown) => `/api/apps/shop/orders?limit=200&filter=${encodeURIComponent(JSON.stringify(f))}`;
      let res = await http().get(q({ group: 'odd' })).set(authHeader(reader)).expect(200);
      expect(res.body.total).toBe(12);
      res = await http().get(q({ n: { $gte: 10, $lt: 15 } })).set(authHeader(reader)).expect(200);
      expect(res.body.total).toBe(5);
      res = await http().get(q({ n: { $in: [1, 2, 3] }, group: { $ne: 'odd' } })).set(authHeader(reader)).expect(200);
      expect(res.body.items.map((d: { n: number }) => d.n)).toEqual([2]);
      res = await http().get(q({ flag: { $exists: true } })).set(authHeader(reader)).expect(200);
      expect(res.body.total).toBe(5);
      res = await http().get(q({ n: { $nin: [0, 1] }, flag: true })).set(authHeader(reader)).expect(200);
      expect(res.body.total).toBe(4);
    });

    it('запрещённые операторы → 400', async () => {
      const bad = [
        { $where: 'sleep(100) || true' },
        { $expr: { $gt: ['$n', 1] } },
        { n: { $where: '1' } },
        { n: { $regex: '.*' } },
        { n: { $function: { body: 'x', args: [], lang: 'js' } } },
        { $or: [{ n: 1 }] },
      ];
      for (const f of bad) {
        await http()
          .get(`/api/apps/shop/orders?filter=${encodeURIComponent(JSON.stringify(f))}`)
          .set(authHeader(admin))
          .expect(400);
      }
      await http().get('/api/apps/shop/orders?filter=%7Bnot-json').set(authHeader(admin)).expect(400);
    });
  });

  describe('удаление', () => {
    let id: string;

    beforeEach(async () => {
      const res = await http().post('/api/apps/notes/trash').set(authHeader(manager)).send({ t: 1 }).expect(201);
      id = res.body.id;
    });

    it('soft-delete скрывает документ, но он остаётся в коллекции', async () => {
      const res = await http().delete(`/api/apps/notes/trash/${id}`).set(authHeader(manager)).expect(200);
      expect(res.body).toMatchObject({ id, deleted: true, hard: false });
      await http().get(`/api/apps/notes/trash/${id}`).set(authHeader(manager)).expect(404);
      await http().patch(`/api/apps/notes/trash/${id}`).set(authHeader(manager)).send({ t: 2 }).expect(404);
      await http().delete(`/api/apps/notes/trash/${id}`).set(authHeader(manager)).expect(404);
      const list = await http().get('/api/apps/notes/trash').set(authHeader(manager)).expect(200);
      expect(list.body.items.find((d: { id: string }) => d.id === id)).toBeUndefined();

      const raw = await ctx!.connection.db!.collection('app_notes_trash').findOne({ t: 1, deletedAt: { $ne: null } });
      expect(raw).not.toBeNull();
    });

    it('?hard=true — только app-data:admin', async () => {
      await http().delete(`/api/apps/notes/trash/${id}?hard=true`).set(authHeader(manager)).expect(403);
      await http().delete(`/api/apps/notes/trash/${id}`).set(authHeader(reader)).expect(403);
      const res = await http().delete(`/api/apps/notes/trash/${id}?hard=true`).set(authHeader(admin)).expect(200);
      expect(res.body).toMatchObject({ id, deleted: true, hard: true });
      const raw = await ctx!.connection.db!.collection('app_notes_trash').findOne({ _id: new Types.ObjectId(id) });
      expect(raw).toBeNull();
    });
  });

  it('коллекция с именем attributes не перехватывается маршрутом EAV', async () => {
    const created = await http().post('/api/apps/notes/attributes').set(authHeader(manager)).send({ k: 'v' }).expect(201);
    const res = await http().get('/api/apps/notes/attributes').set(authHeader(manager)).expect(200);
    expect(res.body.items[0]).toMatchObject({ id: created.body.id, k: 'v' });
  });

  it('GET /api/apps — приложения и коллекции со счётчиками', async () => {
    const res = await http().get('/api/apps').set(authHeader(reader)).expect(200);
    const shop = res.body.items.find((a: { app: string }) => a.app === 'shop');
    expect(shop.collections).toEqual(
      expect.arrayContaining([
        { name: 'orders', count: 25, deleted: 0 },
        { name: 'bulk', count: 500, deleted: 0 },
      ]),
    );
    const notes = res.body.items.find((a: { app: string }) => a.app === 'notes');
    const trash = notes.collections.find((c: { name: string }) => c.name === 'trash');
    expect(trash.deleted).toBeGreaterThanOrEqual(1);
  });

  it('мутации пишутся в аудит с app/collection в details', async () => {
    const logs = await ctx!.connection.db!.collection('auditlogs').find({ entityType: 'AppData' }).toArray();
    expect(logs.length).toBeGreaterThan(0);
    const bulk = logs.find((l) => l.details?.bulk === true && l.details?.collection === 'orders');
    expect(bulk?.details).toMatchObject({ app: 'shop', collection: 'orders', total: 25 });
    const del = logs.find((l) => l.action === 'delete');
    expect(del?.entityId).toBeDefined();
  });

  describe('админка «Таблицы»', () => {
    it('коллекции app_* — категория «Данные приложений», kind app', async () => {
      const res = await http().get('/api/admin/collections').set(authHeader(admin)).expect(200);
      expect(res.body.categories).toEqual(expect.arrayContaining([{ id: 'apps', label: 'Данные приложений' }]));
      const orders = res.body.items.find((c: { name: string }) => c.name === 'app_shop_orders');
      expect(orders).toMatchObject({ category: 'apps', kind: 'app' });
      const detail = await http().get('/api/admin/collections/app_shop_orders').set(authHeader(admin)).expect(200);
      expect(detail.body.kind).toBe('app');
    });

    it('коллекцию приложения можно удалить из админки', async () => {
      const res = await http().delete('/api/admin/collections/app_shop_bulk').set(authHeader(admin)).expect(200);
      expect(res.body).toMatchObject({ name: 'app_shop_bulk', dropped: true, kind: 'app', removedDocuments: 500 });
      const list = await http().get('/api/apps/shop/bulk').set(authHeader(admin)).expect(200);
      expect(list.body.total).toBe(0);
    });
  });
});
