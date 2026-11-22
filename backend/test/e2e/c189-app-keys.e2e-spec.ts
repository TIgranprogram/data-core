import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { hash } from 'bcryptjs';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { User, UserDocument } from '../../src/modules/user/user.schema';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { createTestApp, TestContext } from '../setup/test-db';

describe('C189 — ключ собственного приложения', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: string;
  let scopedKey: string;
  const own = '/api/apps/c189own/items';
  const other = '/api/apps/c189other/items';
  const scope = { access: 'app', apps: ['c189own'] };
  const http = () => request(app.getHttpServer());
  const keys = () => ctx!.connection.db!.collection('desktop_pairing_keys');

  function issue(token: string, candidate: unknown = scope) {
    return http().post('/api/desktop/pairing-keys')
      .set(authHeader(token))
      .send({ label: 'C189', apiBaseUrl: 'http://localhost:3001', scope: candidate });
  }

  beforeAll(async () => {
    ctx = await createTestApp({ strictValidation: true, registerThrottler: true });
    app = ctx.app;
    admin = (await loginAsAdmin(app)).access;
    const issued = await issue(admin).expect(201).expect('Cache-Control', 'no-store');
    expect(issued.body.scope).toEqual(scope);
    scopedKey = issued.body.apiKey;
    await http().post(other).set(authHeader(admin)).send({ name: 'Чужая запись' }).expect(201);
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it.each([
    null, { access: 'app' }, { access: 'app', apps: [] },
    { access: 'app', apps: ['c189own', 'c189other'] },
    { access: 'app', apps: ['c189own', 'c189own'] },
    { access: 'app', apps: ['control'] }, { access: 'app', apps: ['bad_name'] },
  ])('отклоняет недопустимые параметры выдачи %j', async (candidate) => {
    await issue(admin, candidate).expect(400);
  });

  it('работает со своим приложением через оба заголовка, ограничивает список и запрещает физическое удаление', async () => {
    const issued = await http().get('/api/desktop/pairing-keys').set(authHeader(admin)).expect(200);
    expect(issued.body[0].scope).toEqual(scope);
    expect(JSON.stringify(issued.body)).not.toContain(scopedKey);

    const { body } = await http().post(own)
      .set('Authorization', 'Basic dGVzdDp0ZXN0')
      .set('X-Access-Token', scopedKey)
      .send({ name: 'Своя запись', id: 'подмена', createdBy: 'подмена', deletedAt: new Date() })
      .expect(201);
    expect(body.id).toMatch(/^[a-f0-9]{24}$/);
    expect(body.createdBy).toMatch(/^[a-f0-9]{24}$/);
    expect(body.deletedAt).toBeNull();
    const doc = `${own}/${body.id}`;

    const visible = await http().get('/api/apps').set(authHeader(scopedKey)).expect(200);
    expect(visible.body.items.map(({ app }: { app: string }) => app)).toEqual(['c189own']);
    await http().get(doc).set(authHeader(scopedKey)).expect(200);
    await http().patch(doc).set(authHeader(scopedKey)).send({ extra: true }).expect(200);
    const replaced = await http().put(doc).set(authHeader(scopedKey)).send({ name: 'Замена' }).expect(200);
    expect(replaced.body).not.toHaveProperty('extra');
    expect(replaced.body.createdBy).toBe(body.createdBy);
    await http().delete(doc).query({ hard: 'true' }).set(authHeader(scopedKey)).expect(403);
    await http().delete(doc).query({ hard: '1' }).set(authHeader(scopedKey)).expect(403);
    await http().delete(doc).query({ hard: ['true', '1'] }).set(authHeader(scopedKey)).expect(400);
    await http().get(doc).set(authHeader(scopedKey)).expect(200);
    await http().delete(doc).set(authHeader(scopedKey)).expect(200);
    await http().get(doc).set(authHeader(scopedKey)).expect(404);
    const count = await ctx!.connection.db!.collection('app_c189own_items').countDocuments({ _id: new Types.ObjectId(body.id) });
    expect(count).toBe(1);
  });

  it('отказывает в доступе к записям другого приложения, общему API, схемам, админке и ключам', async () => {
    const bearer = authHeader(scopedKey);
    for (const path of [
      other, '/api/apps/pdm-loader', '/api/apps/pdm-loader/download',
      '/api/materials', '/api/meta/schema', '/api/meta/openapi.json',
      '/api/admin/users', '/api/roles', '/api/desktop/pairing-keys',
    ]) {
      await http().get(path).set(bearer).expect(403);
    }
    await http().post(other).set(bearer).send({ name: 'Чужая запись' }).expect(403);
    await http().post('/api/materials').set(bearer).send({ name: 'Общая запись' }).expect(403);
    await issue(scopedKey).expect(403);
    await http().post('/api/desktop/pairing').set(bearer)
      .send({ apiBaseUrl: 'http://localhost:3001' }).expect(403);
  });

  it('проверяет формат запроса, документ, пачку, тело и пагинацию', async () => {
    const bearer = authHeader(scopedKey);
    const newDocument = { rank: 11, detail: { title: 'Текст' } };
    await http().post(own).set(bearer).send(newDocument).expect(201);
    const ok = await http().get(own).set(bearer)
      .query({ filter: JSON.stringify({ rank: { $gte: 10 } }), sort: '-rank', limit: '1000' })
      .expect(200);
    expect(ok.body.limit).toBe(200);
    expect(ok.body.items[0]).toMatchObject(newDocument);

    await http().get(own).set(bearer).query({ filter: '{"$or":[]}' }).expect(400);
    await http().get(own).set(bearer).query({ sort: ['rank', '-rank'] }).expect(400);
    await http().get(own).set(bearer).query({ page: '9007199254740992' }).expect(400);
    await http().post(own).set(bearer).send({ detail: { 'bad.field': true } }).expect(400);
    await http().post(own).set(bearer).send({ big: 'x'.repeat(256 * 1024) }).expect(413);
    await http().post(own).set(bearer).send(Array.from({ length: 501 }, () => ({ item: 1 }))).expect(400);
    await http().post(own).set(bearer).send({ big: 'x'.repeat(16 * 1024 * 1024) }).expect(413);
  });

  it('применяет текущие права и статус выдавшего пользователя, а также статус его роли', async () => {
    const roles = ctx!.connection.db!.collection('roles');
    await roles.insertOne({ name: 'r-c189keys', label: 'Тестовая роль C189', baseRole: 'manager', isActive: true });
    const users = app.get<Model<UserDocument>>(getModelToken(User.name));
    const username = 'c189keys-manager';
    const password = 'test-c189keys-password';
    const actor = await users.create({
      username,
      email: `${username}@example.test`,
      displayName: 'Выдавший тестовый ключ',
      passwordHash: await hash(password, 8),
      isActive: true,
      role: 'r-c189keys',
      permissions: ['desktop:admin'],
    });
    const login = await http().post('/api/auth/login').send({ username, password }).expect(200);
    const actorJwt = login.body.access;
    const issued = await issue(actorJwt).expect(201);
    const actorKey = authHeader(issued.body.apiKey);
    await http().post(own).set(actorKey).send({ phase: 'manager' }).expect(201);
    await http().post(other).set(actorKey).send({ phase: 'manager' }).expect(403);

    await roles.updateOne({ name: 'r-c189keys' }, { $set: { baseRole: 'user' } });
    await http().get(own).set(actorKey).expect(200);
    await http().post(own).set(actorKey).send({ phase: 'user' }).expect(403);
    await http().post(own).set(authHeader(actorJwt)).send({ phase: 'user' }).expect(403);

    await roles.updateOne({ name: 'user' }, { $set: { isActive: false } });
    try {
      await http().get(own).set(actorKey).expect(401);
    } finally {
      await roles.updateOne({ name: 'user' }, { $set: { isActive: true } });
    }
    await roles.updateOne({ name: 'r-c189keys' }, { $set: { isActive: false } });
    await http().get(own).set(actorKey).expect(401);
    await roles.updateOne({ name: 'r-c189keys' }, { $set: { isActive: true } });
    await users.updateOne({ _id: actor._id }, { $set: { isActive: false } });
    await http().get(own).set(actorKey).expect(401);
    await http().get(own).set(authHeader(actorJwt)).expect(401);
  });

  it('прекращает доступ после истечения и отзыва ключа', async () => {
    const { body: expiring } = await issue(admin).expect(201);
    await keys().updateOne({ _id: new Types.ObjectId(expiring.id) }, { $set: { expiresAt: new Date(0) } });
    await http().get(own).set(authHeader(expiring.apiKey)).expect(401);

    const { body: revoked } = await issue(admin).expect(201);
    await http().post(`/api/desktop/pairing-keys/${revoked.id}/revoke`).set(authHeader(admin)).expect(201);
    await http().get(own).set('X-Access-Token', revoked.apiKey).expect(401);
    await http().get(own).set(authHeader(scopedKey)).expect(200);
  });

  it('повтор запроса требует действующий ключ и выдача ключа не сохраняет ответ в кеше', async () => {
    const cache = ctx!.connection.db!.collection('idempotency_records');
    const initialCount = await cache.countDocuments();
    const { body: first } = await issue(admin).set('Idempotency-Key', 'c189-issue').expect(201);
    const { body: second } = await http().post('/api/desktop/pairing')
      .set(authHeader(admin)).set('Idempotency-Key', 'c189-issue-alias')
      .send({ label: 'C189', apiBaseUrl: 'http://localhost:3001', scope }).expect(201);
    expect(await cache.countDocuments()).toBe(initialCount);

    const create = () => http().post(own).set('Idempotency-Key', 'c189-app-repeat')
      .send({ name: 'Запись с повтором' });
    const original = await create().set(authHeader(first.apiKey)).expect(201);
    const replay = await create().set('X-Access-Token', first.apiKey).expect(201);
    const separate = await create().set(authHeader(second.apiKey)).expect(201);
    expect(replay.body.id).toBe(original.body.id);
    expect(separate.body.id).not.toBe(original.body.id);

    await create().expect(401);
    await http().post(`/api/desktop/pairing-keys/${first.id}/revoke`)
      .set(authHeader(admin)).expect(201);
    await create().set(authHeader(first.apiKey)).expect(401);
  });

  it('повреждённый scope в Mongo блокирует ключ, а отсутствующий сохраняет старое поведение', async () => {
    const { body: key } = await http().post('/api/desktop/pairing-keys').set(authHeader(admin))
      .send({ apiBaseUrl: 'http://localhost:3001' }).expect(201);
    const bearer = authHeader(key.apiKey);
    const query = { _id: new Types.ObjectId(key.id) };
    expect((await keys().findOne(query))).not.toHaveProperty('scope');
    await http().get('/api/admin/users').set(bearer).expect(200);
    for (const corrupt of [null, 'full', {}, { access: 'app', apps: 'c189own' }, { access: 'full', apps: [1] }]) {
      await keys().updateOne(query, { $set: { scope: corrupt } });
      await http().get(own).set(bearer).expect(401);
      await http().get('/api/admin/users').set(bearer).expect(401);
    }
    const list = await http().get('/api/desktop/pairing-keys').set(authHeader(admin)).expect(200);
    const row = list.body.find(({ id }: { id: string }) => id === key.id);
    expect(row.scope).toBeNull();
  });

  it('запросы ключа в своё приложение проходят общий лимит частоты', async () => {
    process.env.DISABLE_THROTTLE = '0';
    try {
      const replies = await Promise.all(
        Array.from({ length: 12 }, () => http().get(own).set(authHeader(scopedKey))),
      );
      expect(replies.every((reply) => reply.status === 200 || reply.status === 429)).toBe(true);
      expect(replies.filter((reply) => reply.status === 200)).toHaveLength(10);
    } finally {
      process.env.DISABLE_THROTTLE = '1';
    }
  });
});
