import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { createTestApp, type TestContext } from '../setup/test-db';

describe('Личный рабочий стол (C218)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: string;
  let worker: string;
  const path = '/api/auth/me/desk';
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp({ strictValidation: true });
    app = ctx.app;
    admin = (await loginAsAdmin(app)).access;
    const login = { username: 'desk-manager-test', password: 'local-desk-fixture-12' };
    await http().post('/api/admin/users').set(authHeader(admin)).send({ ...login, role: 'manager' }).expect(201);
    worker = (await http().post('/api/auth/login').send(login).expect(200)).body.access;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('у каждого пользователя свой стол, попытка гонки не перезаписывает сохранённые задачи', async () => {
    const auth = authHeader(worker);
    const empty = await http().get(path).set(auth).expect(200).expect('Cache-Control', 'private, no-store');
    expect(empty.body).toEqual({ version: 0, items: [] });
    await http().put(path).set(auth).send({ version: 0, items: [], userId: 'чужая учётная запись' }).expect(400);
    const checklist = { id: '4b13538f-186e-4f0c-8000-81a1fa4544c0', title: 'Сверить сроки', due: '2026-11-30', done: false };
    const items = [
      { of: 'salesorders', id: '20-26', lane: 'next', tasks: [checklist] },
      { of: 'personal', lane: 'focus', ...checklist, due: '2026-12-02' },
    ];
    const saved = await http().put(path).set(auth).send({ version: 0, items }).expect(200);
    expect(saved.body).toEqual({ version: 1, items });
    const updates = await Promise.all([
      http().put(path).set(auth).send({ version: 1, items: items.slice().reverse() }),
      http().put(path).set(auth).send({ version: 1, items: [items[0]] }),
    ]);
    expect(updates.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await http().get(path).set(auth).expect(200)).body).toEqual(updates.find((r) => r.status === 200)?.body);
    expect((await http().get(path).set(authHeader(admin)).expect(200)).body).toEqual({ version: 0, items: [] });
    expect((await http().get('/api/auth/me').set(auth).expect(200)).body).not.toHaveProperty('privateDesk');
    const inspected = await http().get('/api/admin/collections/users/docs')
      .query({ q: 'desk-manager-test' }).set(authHeader(admin)).expect(200);
    expect(inspected.body.items[0].privateDesk).toBe('***');
    expect(JSON.stringify(inspected.body)).not.toContain(checklist.title);
  });

  it('без сессии и через машинный ключ стол недоступен', async () => {
    await http().get(path).expect(401);
    const key = await http().post('/api/desktop/pairing-keys').set(authHeader(admin))
      .send({ apiBaseUrl: 'http://localhost:3001', label: 'e2e-desk' }).expect(201);
    await http().get(path).set(authHeader(key.body.apiKey)).expect(403);
    await http().put(path).set(authHeader(key.body.apiKey)).send({ version: 0, items: [] }).expect(403);
  });
});
