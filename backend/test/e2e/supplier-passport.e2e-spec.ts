import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** C136 — паспорт поставщика покупного материала: `/api/materials/:id/attachments` (загрузка, замена, скачивание по тикету). */
describe('Паспорт поставщика (C136)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const http = () => request(app.getHttpServer());
  let purchased = '';
  let raw = '';
  const PDF = (tag: string) => Buffer.concat([Buffer.from(`%PDF-1.7\n${tag}\n`), Buffer.alloc(200)]);
  const up = (id: string, name: string, buf: Buffer) => http().post(`/api/materials/${id}/attachments`).set(authHeader(admin.access)).attach('file', buf, name);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    const t = authHeader(admin.access);
    purchased = (await http().post('/api/materials').set(t).send({ name: 'Кран C136', article: 'C136-1', unit: 'шт', materialKind: 'purchased' }).expect(201)).body.id;
    raw = (await http().post('/api/materials').set(t).send({ name: 'Лист C136', article: 'C136-2', unit: 'м²', materialKind: 'raw' }).expect(201)).body.id;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('загрузка: файл привязан к материалу, вид «Паспорт поставщика», без storedPath', async () => {
    const r = await up(purchased, 'паспорт-крана.pdf', PDF('v1')).expect(201);
    expect(r.body).toMatchObject({ materialId: purchased, productId: null, typeName: 'Паспорт поставщика', originalName: 'паспорт-крана.pdf' });
    expect(r.body.storedPath).toBeUndefined();
  });

  it('замена: старый файл убран, в списке один — последний; скачивание по тикету отдаёт новый файл', async () => {
    const second = (await up(purchased, 'паспорт-v2.pdf', PDF('v2')).expect(201)).body;
    const list = (await http().get(`/api/materials/${purchased}/attachments`).set(authHeader(admin.access)).expect(200)).body;
    expect(list.items.map((x: { id: string }) => x.id)).toEqual([second.id]);
    const tk = (await http().post(`/api/materials/${purchased}/attachments/${second.id}/download-ticket`).set(authHeader(admin.access)).expect(200)).body;
    const file = await http().get(tk.url).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(Buffer.from(file.body).includes(Buffer.from('v2'))).toBe(true);
    await http().get(tk.url).expect(403); // тикет одноразовый
  });

  it('не покупной материал — 400; нет материала — 404; чужой формат — 400', async () => {
    await up(raw, 'a.pdf', PDF('x')).expect(400);
    await up('f'.repeat(24), 'a.pdf', PDF('x')).expect(404);
    await up(purchased, 'вирус.exe', Buffer.from('MZ\x90\x00')).expect(400);
  });

  it('файл материала не попадает во вложения изделий: список изделия пуст', async () => {
    const t = authHeader(admin.access);
    const p = (await http().post('/api/products').set(t).send({ name: 'Изделие C136', sku: 'SKU-C136-1', kind: 'good', unit: 'шт', status: 'new', isActive: true }).expect(201)).body._id;
    expect((await http().get(`/api/products/${p}/attachments`).set(t).expect(200)).body.total).toBe(0);
  });
});
