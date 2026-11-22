import request from 'supertest';
import { hash } from 'bcryptjs';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { User, type UserDocument } from '../../src/modules/user/user.schema';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { createTestApp, type TestContext } from '../setup/test-db';

describe('Обсуждение и фото заданий', () => {
  let ctx: TestContext;
  let admin = '', viewer = '', first = '', second = '';
  const http = () => request(ctx.app.getHttpServer());
  const db = () => ctx.connection.db!;

  beforeAll(async () => {
    ctx = await createTestApp();
    admin = (await loginAsAdmin(ctx.app)).access;
    const username = 'task-conversation-viewer';
    const password = 'Task-Conversation-Test';
    await ctx.app.get<Model<UserDocument>>(getModelToken(User.name)).create({
      username, email: `${username}@fixture.invalid`, displayName: 'Учебный наблюдатель', passwordHash: await hash(password, 10), role: 'user', permissions: [], isActive: true,
    });
    viewer = (await http().post('/api/auth/login').send({ username, password }).expect(200)).body.access;
    const photos = await db().collection('photos').insertMany([
      { storageUrl: '/uploads/fixture-first.jpg', mimeType: 'image/jpeg', deletedAt: null },
      { storageUrl: '/uploads/fixture-second.png', mimeType: 'image/png', deletedAt: null },
    ]);
    first = String(photos.insertedIds[0]);
    second = String(photos.insertedIds[1]);
  });

  afterAll(async () => { await ctx?.cleanup(); });

  it('D: сообщение с фото отделено от фото задачи и от импортных отметок', async () => {
    const who = authHeader(admin);
    const task = (await http().post('/api/design-tasks').set(who).send({ title: 'Эскиз ограждения' }).expect(201)).body;
    const path = `/api/design-tasks/${task.id}`;
    await http().post(`${path}/notes`).set(who).send({ text: '[фото] [фото]', authorName: 'Импорт', source: 'yougile', externalId: 'fixture-photo-note' }).expect(201);
    await http().post(`${path}/notes`).set(who).send({ text: '   ' }).expect(400);
    await http().post(`${path}/notes`).set(who).send({ photoIds: [new Types.ObjectId().toString()] }).expect(400);
    const note = (await http().post(`${path}/notes`).set(who).send({ photoIds: [second] }).expect(201)).body;
    expect(note).toMatchObject({ text: '', legacyPhotoCount: 0, photos: [{ id: second }] });
    expect((await http().get(`${path}/notes`).set(who).expect(200)).body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ legacyPhotoCount: 2, author: expect.objectContaining({ name: 'Импорт' }) }),
    ]));
    expect((await http().get(path).set(who).expect(200)).body).toMatchObject({ photos: [], notesCount: 1 });
    for (const photoId of [first, second]) await http().post(`${path}/photos`).set(who).send({ photoId }).expect(200);
    await http().post(`${path}/photos`).set(who).send({ photoId: second }).expect(200);
    expect((await http().patch(`${path}/photos/main`).set(who).send({ photoId: second }).expect(200)).body)
      .toMatchObject({ photoIds: [second, first], photo: '/uploads/fixture-second.png' });
    const history = (await http().get('/api/audit-logs/record').query({ entityType: 'DesignTask', entityId: task.id }).set(who).expect(200)).body.items;
    expect(history.filter((row: { action: string }) => row.action === 'designtask.photo.added')).toHaveLength(2);
  });

  it('W: фото изделия заменяется главным фото задания, а наблюдатель читает без записи', async () => {
    const writer = authHeader(admin), reader = authHeader(viewer);
    const productId = (await db().collection('products').insertOne({ name: 'Скамья', photoIds: [new Types.ObjectId(first)] })).insertedId;
    const incomeId = (await db().collection('incomes').insertOne({ title: 'Скамья' })).insertedId;
    const taskId = (await db().collection('worktasks').insertOne({ seq: 11, productId, incomeId, status: 'work' })).insertedId;
    const otherTaskId = (await db().collection('worktasks').insertOne({ seq: 12, productId, incomeId, status: 'done' })).insertedId;
    const path = `/api/work-tasks/${taskId}`;
    expect((await http().get(`${path}/photos`).set(reader).expect(200)).body).toMatchObject({ photos: [], productPhoto: { id: first } });
    await http().post(`${path}/notes`).set(reader).send({ text: 'Наблюдатель' }).expect(403);
    await http().post(`${path}/photos`).set(reader).send({ photoId: second }).expect(403);
    const note = (await http().post(`${path}/notes`).set(writer).send({ text: 'Шов проверен', photoIds: [second] }).expect(201)).body;
    expect((await http().get(`${path}/notes`).set(reader).expect(200)).body.items).toMatchObject([
      { text: 'Шов проверен', canEdit: false, photos: [{ id: second }] },
    ]);
    await http().delete(`${path}/notes/${note.id}`).set(reader).expect(403);
    await http().delete(`/api/work-tasks/${otherTaskId}/notes/${note.id}`).set(writer).expect(404);
    await http().post(`${path}/photos`).set(writer).send({ photoId: first }).expect(200);
    await http().post(`${path}/photos`).set(writer).send({ photoId: second }).expect(200);
    await http().post(`${path}/photos`).set(writer).send({ photoId: second }).expect(200);
    const main = (await http().patch(`${path}/photos/main`).set(writer).send({ photoId: second }).expect(200)).body;
    expect(main.photos.map((photo: { id: string }) => photo.id)).toEqual([second, first]);
    const history = (await http().get('/api/audit-logs/record').query({ entityType: 'WorkTask', entityId: String(taskId) }).set(reader).expect(200)).body.items;
    expect(history.map((row: { action: string }) => row.action).sort()).toEqual(['worktask.photo.added', 'worktask.photo.added', 'worktask.photo.main']);
    await http().delete(`${path}/notes/${note.id}`).set(writer).expect(200);
    expect((await http().get(`${path}/notes`).set(reader).expect(200)).body.items).toEqual([]);
  });
});
