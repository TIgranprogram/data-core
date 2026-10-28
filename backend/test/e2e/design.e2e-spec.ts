import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import * as bcrypt from 'bcryptjs';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { User, type UserDocument } from '../../src/modules/user/user.schema';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * «Проектирование» (ПРЖ-3): /api/design-tasks + приоритет заказа + изделие в позициях заказа.
 * Задача на позицию (from-order без дублей, 409 на вторую открытую), свободная задача, правила статусов,
 * срок/приоритет из заказа, «Кто проектировал» при завершении, корзина, D-N не повторяется.
 */
describe('Design tasks (Проектирование)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  let orderId = '', lineId = '', personId = '', productId = '';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['salesorders', 'incomes', 'designtasks', 'designorders', 'persons', 'products']) await db().collection(c).deleteMany({});
    const p = await db().collection('persons').insertOne({ lastName: 'Иванов', firstName: 'Пётр', deletedAt: null });
    personId = String(p.insertedId);
    const pr = await db().collection('products').insertOne({ name: 'Скамья', sku: '3410', photoIds: [], deletedAt: null });
    productId = String(pr.insertedId);
    orderId = (await http().post('/api/salesorders').set(auth()).send({ orderNo: '20-26', productionNo: '20-26', customer: 'ООО Парк', productionDeadline: '2026-12-01', shipDate: '2026-12-20', priority: 'urgent' }).expect(201)).body.id;
    lineId = (await http().post('/api/incomes').set(auth()).send({ orderId, title: 'Скамья парковая Цвет: графит', qty: 2, unitPrice: 1000, productId }).expect(201)).body.id;
    await http().post('/api/incomes').set(auth()).send({ orderId, title: 'Урна', qty: 1 }).expect(201);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('заказ: priority принимается, отдаётся, фильтруется; в позициях есть product {id,name,sku,photoId}', async () => {
    await http().patch(`/api/salesorders/${orderId}`).set(auth()).send({ priority: 'asap' }).expect(400);
    const o = (await http().get(`/api/salesorders/${orderId}`).set(auth()).expect(200)).body;
    expect(o.priority).toBe('urgent');
    expect(o.lines.find((l: { id: string }) => l.id === lineId).product).toMatchObject({ id: productId, name: 'Скамья', sku: '3410', photoId: null });
    const l = (await http().get('/api/salesorders').query({ priority: 'urgent', sort: 'priority' }).set(auth()).expect(200)).body;
    expect(l.items.map((x: { id: string }) => x.id)).toContain(orderId);
    expect((await http().get('/api/salesorders').query({ priority: 'low' }).set(auth()).expect(200)).body.total).toBe(0);
  });

  let taskId = '';
  it('from-order: задача на каждую позицию, повтор — 0 новых; срок и приоритет из заказа', async () => {
    const r = (await http().post('/api/design-tasks/from-order').set(auth()).send({ orderId }).expect(200)).body;
    expect(r).toMatchObject({ created: 2, skipped: 0 });
    const t = r.items.find((x: { sku: string | null }) => x.sku === '3410');
    taskId = t.id;
    expect(t).toMatchObject({ status: 'queue', title: expect.stringContaining('Чертежи 3410 № 20-26'), priority: 'urgent', priorityFromOrder: true, deadlineFromOrder: true });
    expect(t.deadline.slice(0, 10)).toBe('2026-12-01');
    expect((await http().post('/api/design-tasks/from-order').set(auth()).send({ orderId }).expect(200)).body).toMatchObject({ created: 0, skipped: 2 });
    await http().post('/api/design-tasks').set(auth()).send({ incomeId: lineId }).expect(409);
  });

  it('правила статусов и завершение: designerId изделия заполняется исполнителем', async () => {
    await http().patch(`/api/design-tasks/${taskId}`).set(auth()).send({ status: 'work' }).expect(400);
    await http().patch(`/api/design-tasks/${taskId}`).set(auth()).send({ status: 'paused' }).expect(400);
    await http().patch(`/api/design-tasks/${taskId}`).set(auth()).send({ status: 'work', assigneeId: personId }).expect(200);
    const done = (await http().patch(`/api/design-tasks/${taskId}`).set(auth()).send({ status: 'done' }).expect(200)).body;
    expect(done.completedAt).toBeTruthy();
    expect(String((await db().collection('products').findOne({ sku: '3410' }))!.designerId)).toBe(personId);
    // после «Завершено» на позицию можно новую
    await http().post('/api/design-tasks').set(auth()).send({ incomeId: lineId }).expect(201);
  });

  it('свободная задача, список с counts, поиск, корзина; D-N не повторяется', async () => {
    await http().post('/api/design-tasks').set(auth()).send({ priority: 'high' }).expect(400);
    const free = (await http().post('/api/design-tasks').set(auth()).send({ title: 'Эскиз стенда', deadline: '15.11.2026', priority: 'high' }).expect(201)).body;
    expect(free).toMatchObject({ title: 'Эскиз стенда', priority: 'high', priorityFromOrder: false });
    const l = (await http().get('/api/design-tasks').query({ status: 'queue' }).set(auth()).expect(200)).body;
    expect(l.counts).toMatchObject({ done: 1, all: l.counts.queue + l.counts.work + l.counts.done + l.counts.paused });
    expect(l.items.every((x: { status: string }) => x.status === 'queue')).toBe(true);
    expect((await http().get('/api/design-tasks').query({ search: 'Эскиз' }).set(auth()).expect(200)).body.total).toBe(1);
    await http().delete(`/api/design-tasks/${free.id}`).set(auth()).expect(200);
    await http().get(`/api/design-tasks/${free.id}`).set(auth()).expect(404);
    await http().post(`/api/design-tasks/${free.id}/restore`).set(auth()).expect(200);
    const next = (await http().post('/api/design-tasks').set(auth()).send({ title: 'Ещё' }).expect(201)).body;
    expect(Number(next.code.slice(2))).toBeGreaterThan(Number(free.code.slice(2)));
  });

  it('доска заказов: GET без записи в базу, POST повторно безопасен, /lines, DELETE 409 при открытых задачах', async () => {
    const b = (await http().get('/api/design-board').set(auth()).expect(200)).body;
    expect(b.orders.map((o: { orderId: string }) => o.orderId)).toContain(orderId);
    expect(b.orders[0]).toMatchObject({ orderNo: '20-26', customer: 'ООО Парк', linesCount: 2 });
    expect(JSON.stringify(b)).not.toMatch(/unitPrice|amount/);
    const add = () => http().post('/api/design-board').set(auth()).send({ orderId, distribute: true }).expect(200);
    expect((await add()).body).toMatchObject({ orderId, created: 0 });
    expect(await db().collection('designorders').countDocuments({})).toBe(1);
    const l = (await http().get(`/api/design-board/${orderId}/lines`).set(auth()).expect(200)).body;
    expect(l.lines).toHaveLength(2);
    await http().post('/api/design-tasks').set(auth()).send({ incomeId: lineId, status: 'done' }).expect(400);
    await http().delete(`/api/design-board/${orderId}`).set(auth()).expect(409);
  });
  describe('фото и стикеры (DESIGN-STICKERS)', () => {
    let userTok = '', userId = '', photoId = '', taskId = '', numId = '', stateId = '';
    const uAuth = () => authHeader(userTok);

    beforeAll(async () => {
      const users = app.get<Model<UserDocument>>(getModelToken(User.name));
      const username = `designer-${Date.now()}`;
      const u = await users.create({ username, email: `${username}@datacore.local`, displayName: username, passwordHash: await bcrypt.hash('designer-pw-1', 10), role: 'user', permissions: [], isActive: true });
      userId = String(u._id);
      userTok = (await http().post('/api/auth/login').send({ username, password: 'designer-pw-1' }).expect(200)).body.access;
      photoId = String((await db().collection('photos').insertOne({ storageUrl: '/uploads/t.jpg', createdAt: new Date() })).insertedId);
      taskId = (await http().post('/api/design-tasks').set(auth()).send({ title: 'С фото' }).expect(201)).body.id;
    });

    it('сид: пять системных стикеров; настройки — только admin (user → 403)', async () => {
      const l = (await http().get('/api/design-stickers').set(uAuth()).expect(200)).body;
      expect(l.map((x: { key: string }) => x.key)).toEqual(['assignee', 'deadline', 'priority', 'order', 'product']);
      await http().post('/api/design-stickers').set(uAuth()).send({ kind: 'number', label: 'X' }).expect(403);
      await http().patch(`/api/design-stickers/${l[0].id}`).set(uAuth()).send({ visible: false }).expect(403);
      await http().delete(`/api/design-stickers/${l[0].id}`).set(auth()).expect(400);
      await http().patch(`/api/design-stickers/${l[0].id}`).set(auth()).send({ label: 'Другое' }).expect(400);
    });

    it('создать числовой и состояния; доска отдаёт видимые один раз', async () => {
      const n = (await http().post('/api/design-stickers').set(auth()).send({ kind: 'number', label: 'Часы план', unit: 'ч' }).expect(201)).body;
      const st = (await http().post('/api/design-stickers').set(auth()).send({ kind: 'state', label: 'Чертёж', states: [{ label: 'Эскиз', color: '#ffcc00' }, { label: 'Утверждён', color: '#00aa55' }] }).expect(201)).body;
      numId = n.id; stateId = st.states[0].id;
      await http().post('/api/design-stickers').set(auth()).send({ kind: 'state', label: 'Пусто' }).expect(400);
      const hide = (await http().get('/api/design-stickers').set(auth()).expect(200)).body.find((x: { key: string }) => x.key === 'deadline');
      await http().patch(`/api/design-stickers/${hide.id}`).set(auth()).send({ visible: false }).expect(200);
      const b = (await http().get('/api/design-board').set(auth()).expect(200)).body;
      expect(b.stickers.map((x: { key: string }) => x.key)).not.toContain('deadline');
      expect(b.stickers.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([numId, st.id]));
      await http().patch(`/api/design-stickers/${hide.id}`).set(auth()).send({ visible: true }).expect(200);
    });

    it('значения: точечная запись, проверка типа, очистка; user — на ничьей задаче', async () => {
      const r = (await http().patch(`/api/design-tasks/${taskId}/stickers`).set(uAuth()).send({ values: { [numId]: 8, } }).expect(200)).body;
      expect(r.stickers[numId]).toBe(8);
      await http().patch(`/api/design-tasks/${taskId}/stickers`).set(auth()).send({ values: { [(await db().collection('designstickers').findOne({ kind: 'state' }))!._id.toString()]: stateId } }).expect(200);
      const t = (await http().get(`/api/design-tasks/${taskId}`).set(auth()).expect(200)).body;
      expect(Object.keys(t.stickers)).toHaveLength(2); // второй PATCH не затёр первый
      await http().patch(`/api/design-tasks/${taskId}/stickers`).set(auth()).send({ values: { [numId]: 'abc' } }).expect(400);
      await http().patch(`/api/design-tasks/${taskId}/stickers`).set(auth()).send({ values: { 'a.b': 1 } }).expect(400);
      await http().patch(`/api/design-tasks/${taskId}/stickers`).set(auth()).send({}).expect(400);
      expect((await http().patch(`/api/design-tasks/${taskId}/stickers`).set(auth()).send({ values: { [numId]: null } }).expect(200)).body.stickers[numId]).toBeUndefined();
    });

    it('фото: добавить, повтор, 404 на чужой photoId; user не правит общий PATCH и чужую задачу', async () => {
      const r = (await http().post(`/api/design-tasks/${taskId}/photos`).set(uAuth()).send({ photoId }).expect(200)).body;
      expect(r).toMatchObject({ photoIds: [photoId], photo: '/uploads/t.jpg' });
      expect((await http().post(`/api/design-tasks/${taskId}/photos`).set(auth()).send({ photoId }).expect(200)).body.photoIds).toHaveLength(1);
      await http().post(`/api/design-tasks/${taskId}/photos`).set(auth()).send({ photoId: '0'.repeat(24) }).expect(404);
      await http().post(`/api/design-tasks/${taskId}/photos`).set(auth()).send({}).expect(400);
      await http().patch(`/api/design-tasks/${taskId}`).set(uAuth()).send({ title: 'Х' }).expect(403);
      const person = String((await db().collection('persons').insertOne({ firstName: 'Чужой', deletedAt: null })).insertedId);
      await http().patch(`/api/design-tasks/${taskId}`).set(auth()).send({ assigneeId: person }).expect(200);
      await http().post(`/api/design-tasks/${taskId}/photos`).set(uAuth()).send({ photoId }).expect(200); // вход ни с кем не связан — не ограничиваем
      const other = (await db().collection('persons').insertOne({ firstName: 'Другой', userId: new Types.ObjectId(userId), deletedAt: null })).insertedId;
      await http().post(`/api/design-tasks/${taskId}/photos`).set(uAuth()).send({ photoId }).expect(403); // вход связан с другим сотрудником
      await db().collection('persons').deleteOne({ _id: other });
      await db().collection('persons').updateOne({ _id: new Types.ObjectId(person) }, { $set: { userId: new Types.ObjectId(userId) } });
      await http().delete(`/api/design-tasks/${taskId}/photos/${photoId}`).set(uAuth()).expect(200);
      expect((await http().get(`/api/design-tasks/${taskId}`).set(auth()).expect(200)).body.photoIds).toEqual([]);
    });
  });
  describe('обсуждение и вопросы менеджеру', () => {
    let tid = '', userTok = '';
    const uAuth = () => authHeader(userTok);
    beforeAll(async () => {
      const users = app.get<Model<UserDocument>>(getModelToken(User.name));
      const username = `talker-${Date.now()}`;
      await users.create({ username, email: `${username}@datacore.local`, displayName: 'Мария Орлова', passwordHash: await bcrypt.hash('talker-pw-1', 10), role: 'user', permissions: [], isActive: true });
      userTok = (await http().post('/api/auth/login').send({ username, password: 'talker-pw-1' }).expect(200)).body.access;
      tid = (await http().post('/api/design-tasks').set(auth()).send({ title: 'Обсуждаемая' }).expect(201)).body.id;
    });

    it('вопрос → «Требует ответа: 1» в задаче и списке; ответ снимает; чужому 403; импорт без дублей', async () => {
      const q = (await http().post(`/api/design-tasks/${tid}/notes`).set(auth()).send({ kind: 'question', text: 'Какой цвет?' }).expect(201)).body;
      expect(q.needsAnswer).toBe(true);
      let row = (await http().get('/api/design-tasks?status=queue,work&needsAnswer=1').set(auth()).expect(200)).body.items.find((x: { id: string }) => x.id === tid);
      expect(row.openQuestions).toBe(1);
      const a = (await http().post(`/api/design-tasks/${tid}/notes`).set(uAuth()).send({ text: 'Графит', replyTo: q.id }).expect(201)).body;
      expect(a.author.initials).toBe('МО');
      row = (await http().get(`/api/design-tasks/${tid}`).set(auth()).expect(200)).body;
      expect(row.openQuestions).toBe(0);
      expect(row.notesCount).toBe(2);
      await http().patch(`/api/design-notes/${q.id}`).set(uAuth()).send({ text: 'Чужое' }).expect(403);
      await http().patch(`/api/design-notes/${a.id}`).set(uAuth()).send({ text: 'Графит RAL 7024' }).expect(200);
      // импорт: у обычного пользователя поля игнорируются, у admin работают; повтор externalId — та же запись
      const imp = { text: 'Из YouGile', authorName: 'Сергей К.', source: 'yougile', createdAt: '2026-09-01T10:00:00.000Z', externalId: 'yg-1' };
      const bad = (await http().post(`/api/design-tasks/${tid}/notes`).set(uAuth()).send(imp).expect(201)).body;
      expect(bad.source).toBe('app');
      const one = (await http().post(`/api/design-tasks/${tid}/notes`).set(auth()).send(imp).expect(201)).body;
      const two = (await http().post(`/api/design-tasks/${tid}/notes`).set(auth()).send(imp).expect(201)).body;
      expect(two.id).toBe(one.id);
      expect(one.author.name).toBe('Сергей К.');
      expect(String(one.createdAt)).toContain('2026-09-01');
      const list = (await http().get(`/api/design-tasks/${tid}/notes`).set(auth()).expect(200)).body.items;
      expect(list[0].id).toBe(one.id); // самая ранняя — первой
      expect((await http().get('/api/design-notes/open-questions').set(auth()).expect(200)).body.total).toBe(0);
    });
  });
});
