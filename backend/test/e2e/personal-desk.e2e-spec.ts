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

  it('держит пользовательские стопки, ссылки и файлы в своём столе после удаления и восстановления задачи', async () => {
    const auth = authHeader(worker);
    const task = { of: 'personal', id: 'da99b6bf-0a9f-4126-8f42-97c8911b430c', lane: 'focus', title: 'Проверить проект', done: true,
      refs: [{ of: 'salesorders', id: '20-26' }, { of: 'orders', id: '000000000000000000000001' }] };
    const custom = { key: '26dd22a9-2dd2-4136-ab6c-cf0fdfcf5156', title: 'На согласовании' };
    const lanes = [{ key: 'focus', title: 'Срочно' }, custom];
    const before = (await http().get(path).set(auth).expect(200)).body;
    const created = (await http().put(path).set(auth).send({ version: before.version, lanes, items: [task] }).expect(200)).body;
    expect(created.lanes).toEqual(lanes);
    const files = path + '/tasks/' + task.id + '/files';
    const name = 'Документы (макет).txt';
    const buffer = Buffer.from('Файл своей задачи', 'utf8');
    const added = (await http().post(files).set(auth).attach('file', buffer, name).expect(201)).body;
    expect(added).toMatchObject({ name, size: buffer.length });
    expect(Object.keys(added).sort()).toEqual(['id', 'name', 'size', 'uploadedAt']);
    const file = files + '/' + added.id;
    await http().get(file).set(auth).expect(200).expect('Cache-Control', 'private, no-store')
      .expect('Content-Disposition', /attachment; filename\*=UTF-8''/).expect(buffer);
    await http().get(files).expect(401);
    const other = authHeader(admin);
    await http().get(files).set(other).expect(404);
    await http().get(file).set(other).expect(404);
    await http().delete(file).set(other).expect(404);
    await http().post(file + '/restore').set(other).expect(404);
    const otherTask = { ...task, id: '87adf20a-f8f0-4698-8c6e-55aa33a5ae53' };
    await http().put(path).set(other).send({ version: 0, items: [otherTask] }).expect(200);
    await http().get(path + '/tasks/' + otherTask.id + '/files/' + added.id).set(other).expect(404);
    const collections = (await http().get('/api/admin/collections').set(other).expect(200)).body;
    expect(collections.items.some(({ name: n }: { name: string }) => n.startsWith('private_desk.'))).toBe(false);
    for (const name of ['private_desk.files', 'private_desk.chunks']) {
      await http().get('/api/admin/collections/' + name).set(other).expect(400);
      await http().get('/api/admin/collections/' + name + '/docs').set(other).expect(400);
    }
    await http().delete(file).set(auth).expect(200);
    expect((await http().get(files).set(auth).expect(200)).body[0].deletedAt).toBeTruthy();
    await http().get(file).set(auth).expect(404);
    await http().post(file + '/restore').set(auth).expect(201);
    const archived = (await http().put(path).set(auth).send({ version: created.version, lanes: [custom],
      items: [{ ...task, lane: custom.key, deletedAt: '2026-11-22T13:00:00.000Z' }] }).expect(200)).body;
    expect(archived.items[0].refs).toEqual(task.refs);
    await http().get(files).set(auth).expect(404);
    const restored = (await http().put(path).set(auth).send({ version: archived.version, items: [{ ...task, lane: custom.key }] }).expect(200)).body;
    expect(restored.lanes).toEqual([custom]);
    expect((await http().get(files).set(auth).expect(200)).body[0]).toEqual(added);
    await http().get(file).set(auth).expect(200).expect(buffer);
  });

  it('при параллельной загрузке последнего файла сохраняет один и удаляет его лишние части', async () => {
    const auth = authHeader(worker);
    const id = '433d1875-1a35-47a3-a716-e85e5c0c4908';
    const before = (await http().get(path).set(auth).expect(200)).body;
    await http().put(path).set(auth).send({ version: before.version, items: [...before.items,
      { of: 'personal', id, lane: before.lanes?.[0]?.key || 'focus', title: 'Предел файлов', done: false }] }).expect(200);
    const files = path + '/tasks/' + id + '/files';
    const upload = (i: number) => http().post(files).set(auth).attach('file', Buffer.from('Файл ' + i), 'Файл ' + i + '.txt');
    for (let i = 0; i < 19; i++) await upload(i).expect(201);
    const final = await Promise.all([upload(19), upload(20)]);
    expect(final.map((result) => result.status).sort()).toEqual([201, 400]);
    expect((await http().get(files).set(auth).expect(200)).body).toHaveLength(20);
    const db = ctx!.connection.db!;
    const hidden = await db.collection('private_desk.files').find({ 'metadata.task': id }, { projection: { _id: 1 } }).toArray();
    expect(hidden).toHaveLength(20);
    const allIds = await db.collection('private_desk.files').distinct('_id');
    expect(await db.collection('private_desk.chunks').countDocuments({ files_id: { $nin: allIds } })).toBe(0);
  });

  it('без сессии и через машинный ключ стол недоступен', async () => {
    await http().get(path).expect(401);
    const key = await http().post('/api/desktop/pairing-keys').set(authHeader(admin))
      .send({ apiBaseUrl: 'http://localhost:3001', label: 'e2e-desk' }).expect(201);
    await http().get(path).set(authHeader(key.body.apiKey)).expect(403);
    await http().put(path).set(authHeader(key.body.apiKey)).send({ version: 0, items: [] }).expect(403);
  });
});
