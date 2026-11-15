import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** C121 — файлы позиции заказа: `/api/incomes/:id/attachments` (загрузка, список, изоляция позиций, права, удаление). */
describe('Файлы позиции заказа (C121)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const http = () => request(app.getHttpServer());
  const tok: Record<string, string> = {};
  let productId = '';
  let typeId = '';
  let lineA = '';
  let lineB = '';
  let serviceLine = '';
  const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200)]);

  const user = async (key: string, role: string) => {
    const username = `ia-${key}-${Date.now()}`;
    await http().post('/api/admin/users').set(authHeader(admin.access)).send({ username, password: 'role-pass-123', role }).expect(201);
    tok[key] = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
  };
  const up = (line: string, token: string, name = 'акт.pdf', buf: Buffer = PDF, type = typeId) =>
    http().post(`/api/incomes/${line}/attachments?typeId=${type}`).set(authHeader(token)).attach('file', buf, name);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    const t = authHeader(admin.access);
    productId = (await http().post('/api/products').set(t).send({ name: 'Скамья C121', sku: 'SKU-C121-001', kind: 'good', unit: 'шт', status: 'new', isActive: true }).expect(201)).body._id;
    const types = (await http().get('/api/dicts/attachmentTypes').set(t).expect(200)).body.items;
    typeId = types[0].id;
    const orderId = (await http().post('/api/salesorders').set(t).send({ orderNo: 'C121-1', customer: 'ООО Файлы' }).expect(201)).body.id;
    lineA = (await http().post('/api/incomes').set(t).send({ orderId, productId, title: 'Скамья A', qty: 1 }).expect(201)).body.id;
    lineB = (await http().post('/api/incomes').set(t).send({ orderId, productId, title: 'Скамья B', qty: 1 }).expect(201)).body.id;
    serviceLine = (await http().post('/api/incomes').set(t).send({ orderId, title: 'Без изделия', qty: 1 }).expect(201)).body.id;
    await user('manager', 'manager');
    await user('user', 'user');
    await user('director', 'director');
  });
  afterAll(async () => { await ctx?.cleanup(); });

  let fileId = '';

  it('manager загружает PDF → 201; файл виден в своей позиции, без storedPath', async () => {
    const r = await up(lineA, tok.manager).expect(201);
    fileId = r.body.id;
    expect(r.body).toMatchObject({ scope: 'line', incomeId: lineA, productId, originalName: 'акт.pdf' });
    expect(r.body.storedPath).toBeUndefined();
    const list = (await http().get(`/api/incomes/${lineA}/attachments`).set(authHeader(tok.user)).expect(200)).body;
    expect(list).toMatchObject({ total: 1, page: 1 });
    expect(list.items[0].id).toBe(fileId);
    expect(JSON.stringify(list)).not.toContain('storedPath');
  });

  it('файл позиции — файл изделия (владелец 15.11): виден в изделии и во всех его позициях, scope «line» — откуда загружен', async () => {
    const t = authHeader(admin.access);
    expect((await http().get(`/api/incomes/${lineB}/attachments`).set(t).expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(fileId);
    await http().post(`/api/products/${productId}/attachments?typeId=${typeId}`).set(t).attach('file', PDF, 'чертёж.pdf').expect(201);
    const a = (await http().get(`/api/incomes/${lineA}/attachments`).set(t).expect(200)).body.items;
    const b = (await http().get(`/api/incomes/${lineB}/attachments`).set(t).expect(200)).body.items;
    expect(a.map((x: { scope: string }) => x.scope).sort()).toEqual(['line', 'product']);
    expect(b.map((x: { scope: string }) => x.scope).sort()).toEqual(['line', 'product']);
    const own = (await http().get(`/api/products/${productId}/attachments`).set(t).expect(200)).body.items;
    expect(own.map((x: { id: string }) => x.id)).toContain(fileId);
  });

  it('права: user не грузит (403), director смотрит (200); director выше manager по иерархии ролей — как и у файлов изделия', async () => {
    await up(lineA, tok.user).expect(403);
    await http().get(`/api/incomes/${lineA}/attachments`).set(authHeader(tok.director)).expect(200);
  });

  it('чужой формат — 400 по-русски, записи нет; без изделия — 400; нет позиции — 404', async () => {
    const bad = await up(lineA, tok.manager, 'вирус.exe', Buffer.from('MZ\x90\x00')).expect(400);
    expect(String(bad.body.message)).toMatch(/[А-Яа-я]/);
    await up(serviceLine, tok.manager).expect(400);
    await up('f'.repeat(24), tok.manager).expect(404);
    expect((await http().get(`/api/incomes/${lineA}/attachments`).set(authHeader(admin.access)).expect(200)).body.items.filter((x: { scope: string }) => x.scope === 'line')).toHaveLength(1);
  });

  it('скачивание по тикету', async () => {
    const t = (await http().post(`/api/products/${productId}/attachments/${fileId}/download-ticket`).set(authHeader(tok.user)).expect(200)).body;
    const res = await http().get(t.url.replace(/^\/api/, '/api')).expect(200);
    expect(res.headers['content-disposition']).toContain('attachment');
  });

  it('удаляет только admin; файлы изделия остаются', async () => {
    await http().delete(`/api/incomes/${lineA}/attachments/${fileId}`).set(authHeader(tok.manager)).expect(403);
    await http().delete(`/api/incomes/${lineB}/attachments/${fileId}`).set(authHeader(admin.access)).expect(404);
    await http().delete(`/api/incomes/${lineA}/attachments/${fileId}`).set(authHeader(admin.access)).expect(200);
    const items = (await http().get(`/api/incomes/${lineA}/attachments`).set(authHeader(admin.access)).expect(200)).body.items;
    expect(items.map((x: { scope: string }) => x.scope)).toEqual(['product']);
  });
});
