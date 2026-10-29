import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** Чат v2: личные переписки, «Всем», непрочитанные, фото, uiPrefs.lastChat. */
describe('Chat v2', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp(); app = ctx.app; admin = await loginAsAdmin(app);
    for (const n of ['a', 'b', 'c']) {
      const username = `chat-${n}-${Date.now()}`;
      const r = await http().post('/api/admin/users').set(as(admin.access)).send({ username, password: 'role-pass-123', role: 'user' }).expect(201);
      uid[n] = r.body.id;
      tok[n] = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
    }
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('личное: чужую переписку не видно, у получателя счётчик, прочтение обнуляет', async () => {
    await http().post('/api/messages').set(as(tok.a)).send({ toUserId: uid.b, text: 'секрет' }).expect(201);
    const forB = (await http().get(`/api/messages/with/${uid.a}`).set(as(tok.b)).expect(200)).body;
    expect(forB.items.map((m: { text: string }) => m.text)).toContain('секрет');
    expect((await http().get(`/api/messages/with/${uid.a}`).set(as(tok.c)).expect(200)).body.items).toHaveLength(0);
    expect((await http().get(`/api/messages/with/${uid.b}`).set(as(tok.c)).expect(200)).body.items).toHaveLength(0);
    expect((await http().get('/api/messages/threads').set(as(tok.b)).expect(200)).body.unread).toBe(1);
    expect((await http().get('/api/messages/threads').set(as(tok.c)).expect(200)).body.items).toHaveLength(0);
    await http().post(`/api/messages/with/${uid.a}/read`).set(as(tok.b)).expect(200);
    expect((await http().get('/api/messages/threads').set(as(tok.b)).expect(200)).body.unread).toBe(0);
  });

  it('пусто без фото — 400; текст без toUserId и toAll — 400', async () => {
    await http().post('/api/messages').set(as(tok.a)).send({ toUserId: uid.b, text: '  ' }).expect(400);
    await http().post('/api/messages').set(as(tok.a)).send({ text: 'кому?' }).expect(400);
  });

  it('«Всем»: видят все, у автора счётчика нет, у остальных +1, открыл — 0', async () => {
    await new Promise((r) => setTimeout(r, 20));
    const sent = (await http().post('/api/messages').set(as(tok.a)).send({ toAll: true, text: 'всем привет' }).expect(201)).body;
    expect(sent.toAll).toBe(true);
    expect(sent.toUserId).toBeNull();
    for (const n of ['a', 'b', 'c']) {
      const feed = (await http().get('/api/messages/all').set(as(tok[n])).expect(200)).body;
      expect(feed.items.map((m: { text: string }) => m.text)).toContain('всем привет');
    }
    const th = async (n: string) => (await http().get('/api/messages/threads').set(as(tok[n])).expect(200)).body;
    expect((await th('a')).all.unread).toBe(0);
    expect((await th('b')).all.unread).toBe(1);
    expect((await th('b')).unread).toBe(1);
    expect((await th('c')).all.lastText).toBe('всем привет');
    await http().post('/api/messages/all/read').set(as(tok.b)).expect(200);
    expect((await th('b')).all.unread).toBe(0);
    expect((await th('c')).all.unread).toBe(1);
    // «Всем» не попадает в личные переписки
    expect((await th('b')).items.map((i: { lastText: string }) => i.lastText)).not.toContain('всем привет');
  });

  it('фото: только фото, фото+текст; чужой id фото — 400; в ленте photos[]', async () => {
    const pid = new Types.ObjectId();
    await db().collection('photos').insertOne({ _id: pid, storageUrl: '/uploads/chat-test.jpg', createdAt: new Date() });
    const only = (await http().post('/api/messages').set(as(tok.a)).send({ toUserId: uid.b, photoIds: [String(pid)] }).expect(201)).body;
    expect(only.text).toBe('');
    expect(only.photos).toEqual([{ id: String(pid), url: '/uploads/chat-test.jpg', thumb: '/uploads/chat-test.jpg' }]);
    await http().post('/api/messages').set(as(tok.a)).send({ toAll: true, text: 'смотрите', photoIds: [String(pid)] }).expect(201);
    const feed = (await http().get('/api/messages/all').set(as(tok.c)).expect(200)).body.items;
    expect(feed[0].photos).toHaveLength(1);
    expect(feed[0].fromName).toBeTruthy();
    await http().post('/api/messages').set(as(tok.a)).send({ toUserId: uid.b, photoIds: [String(new Types.ObjectId())] }).expect(400);
    await http().post('/api/messages').set(as(tok.a)).send({ toUserId: uid.b, photoIds: Array(11).fill(String(pid)) }).expect(400);
    const th = (await http().get('/api/messages/threads').set(as(tok.b)).expect(200)).body;
    expect(th.items[0].lastText).toBe('Фото');
  });

  it('uiPrefs.lastChat: all и id — сохраняется и приходит в /auth/me; мусор — 400', async () => {
    await http().patch('/api/auth/me/prefs').set(as(tok.a)).send({ lastChat: uid.b }).expect(200);
    await http().patch('/api/auth/me/prefs').set(as(tok.a)).send({ lastChat: 'all' }).expect(200);
    await http().patch('/api/auth/me/prefs').set(as(tok.a)).send({ lastChat: 'xyz' }).expect(400);
    const me = (await http().get('/api/auth/me').set(as(tok.a)).expect(200)).body;
    expect(me.uiPrefs?.lastChat).toBe('all');
  });
});
