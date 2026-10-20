import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { User, UserDocument } from '../../src/modules/user/user.schema';

/**
 * DELETE /api/admin/collections/:name — удаление коллекции данных приложения (app_*).
 *
 * Контур защиты (намеренно тройной, операция необратимая):
 *   1. Имя должно быть ТОЧНОЙ записью реестра COLLECTIONS (без нормализации).
 *   2. kind должен быть 'app' — core/link/crm (таблицы kppdf на общей базе) отклоняются с 409.
 *   3. Дроп аудируется (AuditLog, action = 'drop-collection').
 *
 * Имя коллекции кладётся в details.after, а НЕ в entityId: AuditService
 * приводит entityId к Types.ObjectId, а имя коллекции не является хекс-строкой.
 */
describe('Collections admin drop (app only)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let users: Model<UserDocument>;

  const APP_COLL = 'app_droptest_items'; // kind = 'app' (данные приложения)
  const CRM_COLL = 'doc_types'; // реестр: kind = 'crm' — таблица kppdf
  const CORE_COLL = 'users'; // реестр: kind = 'core'
  const LINK_COLL = 'organizationcontacts'; // реестр: kind = 'link'

  const dropIfExists = async (name: string) => {
    await ctx?.connection.db?.collection(name).drop().catch(() => undefined);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    users = app.get<Model<UserDocument>>(getModelToken(User.name));
    await dropIfExists(APP_COLL);
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('rejects an unauthenticated request with 401', async () => {
    await request(app.getHttpServer())
      .delete(`/api/admin/collections/${APP_COLL}`)
      .expect(401);
  });

  it('rejects a non-admin user with 403', async () => {
    const username = `drop-manager-${Date.now()}`;
    await users.create({
      username,
      email: `${username}@kppdf.local`,
      displayName: 'drop manager',
      passwordHash: await bcrypt.hash('drop-manager-pw', 10),
      role: 'manager',
      permissions: [],
      isActive: true,
    });

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password: 'drop-manager-pw' })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/admin/collections/${APP_COLL}`)
      .set(authHeader(login.body.access))
      .expect(403);
  });

  it('rejects a collection that is not in the registry (400)', async () => {
    const { access } = await loginAsAdmin(app);
    const res = await request(app.getHttpServer())
      .delete('/api/admin/collections/totally_unknown_table')
      .set(authHeader(access))
      .expect(400);
    expect(res.body.message).toContain('не описана в реестре');
  });

  it('rejects malformed collection names (400)', async () => {
    const { access } = await loginAsAdmin(app);
    await request(app.getHttpServer())
      .delete('/api/admin/collections/' + encodeURIComponent('bad$name'))
      .set(authHeader(access))
      .expect(400);
  });

  it('refuses to drop an active (core) collection with 409', async () => {
    const { access } = await loginAsAdmin(app);
    const res = await request(app.getHttpServer())
      .delete(`/api/admin/collections/${CORE_COLL}`)
      .set(authHeader(access))
      .expect(409);
    expect(res.body.message).toContain('только данные приложений');

    // и главное — коллекция цела
    const stillThere = await ctx?.connection.db
      ?.listCollections({ name: CORE_COLL }, { nameOnly: true })
      .toArray();
    expect(stillThere).toHaveLength(1);
  });

  it('refuses to drop a link collection with 409', async () => {
    const { access } = await loginAsAdmin(app);
    const res = await request(app.getHttpServer())
      .delete(`/api/admin/collections/${LINK_COLL}`)
      .set(authHeader(access))
      .expect(409);
    expect(res.body.message).toContain('только данные приложений');
  });

  it('refuses to drop a CRM (kppdf) collection with 409 and keeps it', async () => {
    const { access } = await loginAsAdmin(app);
    const db = ctx?.connection.db;
    await db!.collection(CRM_COLL).insertOne({ keep: true });
    const res = await request(app.getHttpServer())
      .delete(`/api/admin/collections/${CRM_COLL}`)
      .set(authHeader(access))
      .expect(409);
    expect(res.body.message).toContain('только данные приложений');
    expect(await db!.collection(CRM_COLL).countDocuments({ keep: true })).toBe(1);
  });

  it('returns 404 for an app collection that does not exist', async () => {
    const { access } = await loginAsAdmin(app);
    await dropIfExists(APP_COLL);
    await request(app.getHttpServer())
      .delete(`/api/admin/collections/${APP_COLL}`)
      .set(authHeader(access))
      .expect(404);
  });

  it('drops an app collection and writes an audit record', async () => {
    const { access } = await loginAsAdmin(app);
    const db = ctx?.connection.db;
    expect(db).toBeDefined();

    await db!.collection(APP_COLL).insertMany([{ a: 1 }, { a: 2 }]);

    const res = await request(app.getHttpServer())
      .delete(`/api/admin/collections/${APP_COLL}`)
      .set(authHeader(access))
      .expect(200);

    expect(res.body).toMatchObject({
      name: APP_COLL,
      dropped: true,
      removedDocuments: 2,
      kind: 'app',
    });

    // коллекции больше нет
    const gone = await db!
      .listCollections({ name: APP_COLL }, { nameOnly: true })
      .toArray();
    expect(gone).toHaveLength(0);

    // исчезла и из админского списка
    const list = await request(app.getHttpServer())
      .get('/api/admin/collections')
      .set(authHeader(access))
      .expect(200);
    expect(list.body.items.map((c: { name: string }) => c.name)).not.toContain(
      APP_COLL,
    );

    // аудит зафиксировал дроп (interceptor ждёт записи до ответа)
    const logs = await db!
      .collection('auditlogs')
      .find({ action: 'drop-collection', entityType: 'Collection' })
      .toArray();
    expect(logs.length).toBeGreaterThan(0);
    expect(String(logs[logs.length - 1].details?.after?.name)).toBe(APP_COLL);
    expect(logs[logs.length - 1].userName).toBe('admin');
  });

  it('returns 404 when the app collection is already gone', async () => {
    const { access } = await loginAsAdmin(app);
    await dropIfExists(APP_COLL);
    await request(app.getHttpServer())
      .delete(`/api/admin/collections/${APP_COLL}`)
      .set(authHeader(access))
      .expect(404);
  });
});
