import request from 'supertest';
import sharp from 'sharp';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** КП-1: создание, правка, статусы (400 без цены, «Оплачено» закрывает правку), список со счётчиками, PDF, фоны. */
describe('Offers (КП)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  let companyId = '', id = '';
  const body = () => ({
    companyId, customer: 'ООО Школа', validUntil: '2026-12-01',
    items: [{ productName: 'Урна', quantity: 2, unit: 'шт', color: 'серый' }, { productName: 'Скамья', quantity: 1, unitPrice: 5000 }],
    prepaymentPercent: 50, productionDays: 14, terms: 'Цены без НДС',
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['commercialoffers', 'offerbackgrounds', 'organizations']) await db().collection(c).deleteMany({});
    companyId = String((await db().collection('organizations').insertOne({ name: 'СпортИН-ЮГ', isOurCompany: true, deletedAt: null })).insertedId);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('создаётся черновиком, номер КП-…, сумма считается; без заказчика и с чужой компанией — 400', async () => {
    await http().post('/api/offers').set(auth()).send({ ...body(), customer: '' }).expect(400);
    await http().post('/api/offers').set(auth()).send({ ...body(), companyId: '5f0000000000000000000000' }).expect(400);
    const r = await http().post('/api/offers').set(auth()).send(body()).expect(201);
    id = r.body.id;
    expect(r.body).toMatchObject({ status: 'draft', customer: 'ООО Школа', total: 5000, companyName: 'СпортИН-ЮГ' });
    expect(r.body.number).toMatch(/^КП-\d{4}-\d+$/);
    expect(r.body.items[0]).toMatchObject({ productName: 'Урна', unitPrice: null, total: 0 });
  });

  it('правка пересчитывает сумму; статус через PATCH нельзя', async () => {
    const items = [{ productName: 'Урна', quantity: 2, unitPrice: 1000 }, { productName: 'Скамья', quantity: 1, unitPrice: 5000 }];
    const r = await http().patch(`/api/offers/${id}`).set(auth()).send({ items, notes: 'Монтаж отдельно' }).expect(200);
    expect(r.body.total).toBe(7000);
    await http().patch(`/api/offers/${id}`).set(auth()).send({ status: 'paid' }).expect(400);
  });

  it('«Отправлено» без цены — 400, с ценами — 200; пропуск шага — 400', async () => {
    const x = (await http().post('/api/offers').set(auth()).send(body()).expect(201)).body.id;
    const r = await http().post(`/api/offers/${x}/status`).set(auth()).send({ status: 'sent' }).expect(400);
    expect(r.body.message).toContain('Урна');
    await http().post(`/api/offers/${id}/status`).set(auth()).send({ status: 'accepted' }).expect(400);
    const ok = await http().post(`/api/offers/${id}/status`).set(auth()).send({ status: 'sent' }).expect(200);
    expect(ok.body.status).toBe('sent');
    expect(ok.body.statusHistory.map((h: { status: string }) => h.status)).toEqual(['draft', 'sent']);
  });

  it('«Оплачено»: правка и смена статуса закрыты', async () => {
    await http().post(`/api/offers/${id}/status`).set(auth()).send({ status: 'accepted' }).expect(200);
    await http().post(`/api/offers/${id}/status`).set(auth()).send({ status: 'paid' }).expect(200);
    const r = await http().patch(`/api/offers/${id}`).set(auth()).send({ notes: 'x' }).expect(400);
    expect(r.body.message).toContain('оплачено');
    await http().post(`/api/offers/${id}/status`).set(auth()).send({ status: 'cancelled' }).expect(400);
  });

  it('список: фильтр по статусу, поиск, счётчики', async () => {
    const all = (await http().get('/api/offers').set(auth()).expect(200)).body;
    expect(all).toMatchObject({ total: 2, page: 1, counts: { all: 2, draft: 1, paid: 1, sent: 0 } });
    const paid = (await http().get('/api/offers').query({ status: 'paid' }).set(auth()).expect(200)).body;
    expect(paid.items).toHaveLength(1);
    expect((await http().get('/api/offers').query({ q: 'нет-такого' }).set(auth()).expect(200)).body.total).toBe(0);
    await http().get('/api/offers').query({ status: 'bad' }).set(auth()).expect(400);
  });

  it('PDF: application/pdf, имя КП-…pdf, начинается с %PDF', async () => {
    const r = await http().get(`/api/offers/${id}/pdf`).set(auth()).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(decodeURIComponent(String(r.headers['content-disposition']))).toContain('КП-');
    expect((r.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('фоны: встроенные в списке, загрузка png, предупреждение о пропорции, плохой файл — 400, удаление', async () => {
    const l0 = (await http().get('/api/offers/backgrounds').set(auth()).expect(200)).body;
    expect(l0.items.filter((b: { builtin: boolean }) => b.builtin)).toHaveLength(2);
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#336699' } }).png().toBuffer();
    const up = await http().post('/api/offers/backgrounds').set(auth()).field('name', 'Квадрат').field('page', '2').field('isDefault', 'true').attach('file', png, { filename: 'bg.png', contentType: 'image/png' }).expect(201);
    expect(up.body).toMatchObject({ name: 'Квадрат', page: 2, isDefault: true, builtin: false });
    expect(up.body.warning).toContain('А4');
    expect(up.body.url).toMatch(/^\/uploads\/offers\/.+\.png$/);
    await http().post('/api/offers/backgrounds').set(auth()).field('name', 'Текст').field('page', '1').attach('file', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' }).expect(400);
    await http().post('/api/offers/backgrounds').set(auth()).field('name', 'Без файла').field('page', '1').expect(400);
    const l1 = (await http().get('/api/offers/backgrounds').set(auth()).expect(200)).body;
    expect(l1.items.find((b: { id: string }) => b.id === 'builtin-2').isDefault).toBe(false);
    await http().patch(`/api/offers/${id}`).set(auth()).send({ bg2Id: up.body.id }).expect(400); // оплачено — правка закрыта
    await http().delete(`/api/offers/backgrounds/${up.body.id}`).set(auth()).expect(200);
    await http().delete('/api/offers/backgrounds/builtin-1').set(auth()).expect(400);
  });

  it('удаление мягкое: КП пропадает из списка и из карточки', async () => {
    await http().delete(`/api/offers/${id}`).set(auth()).expect(200);
    await http().get(`/api/offers/${id}`).set(auth()).expect(404);
    expect((await http().get('/api/offers').set(auth()).expect(200)).body.total).toBe(1);
  });
});
