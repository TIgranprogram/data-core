import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** C073: два КП одному заказчику — last отдаёт второе; отменённое новее не побеждает. */
describe('Offers last (C073)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  let companyId = '';
  const productId = new Types.ObjectId().toHexString();
  const partyId = new Types.ObjectId().toHexString();

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['commercialoffers', 'organizations']) await db().collection(c).deleteMany({});
    companyId = String((await db().collection('organizations').insertOne({ name: 'СпортИН-ЮГ', isOurCompany: true, deletedAt: null })).insertedId);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  const post = (body: Record<string, unknown>) => http().post('/api/offers').set(auth()).send({
    companyId, items: [{ productId, productName: 'Урна', quantity: 1, unitPrice: 15000, description: 'Для двора' }],
    ...body,
  });

  it('второе КП важнее первого, отменённое новее — нет; название без регистра', async () => {
    const first = (await post({ customer: 'ООО Школа', date: '2026-11-01', terms: 'старые', objectName: 'Старый двор' }).expect(201)).body;
    const second = (await post({
      customer: 'ООО Школа', date: '2026-11-10', terms: 'новые', objectName: 'Новый двор',
      prepaymentPercent: 30, productionDays: 20, deliveryDays: 5, delivery: 'included',
      counterpartyId: partyId,
    }).expect(201)).body;
    expect(second.items[0].description).toBe('Для двора');
    expect(second.counterpartyId).toBe(partyId);
    await post({ customer: 'ООО Школа', date: '2026-11-20', terms: 'отмена' }).expect(201).then(async (r) => {
      await http().post(`/api/offers/${r.body.id}/status`).set(auth()).send({ status: 'cancelled' }).expect(200);
    });

    const byName = (await http().get('/api/offers/last').query({ customer: '  ооо   школа ' }).set(auth()).expect(200)).body;
    expect(byName).toMatchObject({
      offerId: second.id, number: second.number, objectName: 'Новый двор', terms: 'новые',
      prepaymentPercent: 30, productionDays: 20, deliveryDays: 5, delivery: 'included',
      prices: [{ productId, unitPrice: 15000 }],
    });
    expect(byName.offerId).not.toBe(first.id);

    const byId = (await http().get('/api/offers/last').query({ customer: 'Другое имя', counterpartyId: partyId }).set(auth()).expect(200)).body;
    expect(byId.offerId).toBe(second.id);

    const miss = await http().get('/api/offers/last').query({ customer: 'нет такого заказчика' }).set(auth()).expect(200);
    expect(miss.body == null || miss.body.offerId == null).toBe(true);
  });
});
