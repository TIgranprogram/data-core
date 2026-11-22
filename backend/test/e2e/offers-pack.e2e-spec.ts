import request from 'supertest';
import sharp from 'sharp';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** C071: пакет КП — исходное + 2 фирмы, один packId, наценки +3 % и +5 %. */
describe('Offers pack (C071)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  let siy = '', privat = '', ssyu = '', offerId = '';
  const blanks = new Map<string, { id: string; jpeg: Buffer }>();
  const getPdf = async (id: string): Promise<Buffer> => (await http().get('/api/offers/' + id + '/pdf').set(auth()).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  }).expect(200)).body;

  function expectBrand(pdf: Buffer, companyId: string) {
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.includes(blanks.get(companyId)!.jpeg)).toBe(true);
    expect(pdf.toString('latin1').match(/\/Subtype \/Image\b/g)).toHaveLength(1);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['commercialoffers', 'offerbackgrounds', 'organizations', 'settings']) await db().collection(c).deleteMany({});
    siy = String((await db().collection('organizations').insertOne({ name: 'СпортИН-ЮГ', isOurCompany: true, inn: '2310000001', vatRate: 22, deletedAt: null })).insertedId);
    privat = String((await db().collection('organizations').insertOne({ name: 'Приват-деал', isOurCompany: true, inn: '2308066456', vatRate: 22, deletedAt: null })).insertedId);
    ssyu = String((await db().collection('organizations').insertOne({ name: 'ССЮ', isOurCompany: true, inn: '2310000002', vatRate: 22, deletedAt: null })).insertedId);
    for (const [name, companyId, background] of [['СИЮ', siy, '#ee1122'], ['Приват', privat, '#22dd33'], ['ССЮ', ssyu, '#3344aa']] as const) {
      const png = await sharp({ create: { width: 210, height: 297, channels: 3, background } }).png().toBuffer();
      const { body } = await http().post('/api/offers/backgrounds').set(auth()).field('name', name).field('page', '1').field('companyId', companyId)
        .attach('file', png, { filename: 'b.png', contentType: 'image/png' }).expect(201);
      const jpeg = await sharp(png).flatten({ background: '#ffffff' }).resize({ width: 1654, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      blanks.set(companyId, { id: body.id, jpeg });
    }
    const first = (await http().post('/api/offers').set(auth()).send({
      companyId: siy, customer: 'ООО ИнжПроектСтрой', objectName: 'Мостик 5×2 м', date: '2026-11-06', validUntil: '2026-11-16',
      items: [{ productName: 'Мостик', quantity: 1, unit: 'шт', unitPrice: 680000 }],
      vatMode: 'with', vatRate: 22, delivery: 'included', bg1Id: blanks.get(privat)!.id,
    }).expect(201)).body;
    offerId = first.id;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('companies: hasBlank у фирм с бланком', async () => {
    const r = (await http().get('/api/offers/companies').set(auth()).expect(200)).body;
    expect(r.items.find((c: { id: string }) => c.id === siy)).toMatchObject({ hasBlank: true });
    expect(r.items.find((c: { id: string }) => c.id === privat)).toMatchObject({ hasBlank: true });
  });

  it('copies: исходное + 2 фирмы → 3 КП с одним packId, цены +3 % и +5 %', async () => {
    expectBrand(await getPdf(offerId), privat); // Одиночное КП сохраняет явно выбранный бланк.
    const r = (await http().post(`/api/offers/${offerId}/copies`).set(auth()).send({
      companies: [
        { companyId: privat, markupPercent: 3 },
        { companyId: ssyu, markupPercent: 5 },
      ],
    }).expect(201)).body;
    expect(r.packId).toBeTruthy();
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ total: 700400, status: 'draft', copyOf: offerId, packId: r.packId });
    expect(r.items[1]).toMatchObject({ total: 714000, status: 'draft', copyOf: offerId, packId: r.packId });
    const src = (await http().get(`/api/offers/${offerId}`).set(auth()).expect(200)).body;
    expect(src.packId).toBe(r.packId);
    expect(src.packSize).toBe(3);
    const list = (await http().get('/api/offers').query({ packId: r.packId }).set(auth()).expect(200)).body;
    expect(list.total).toBe(3);
    expect(list.items.every((o: { packId: string; packSize: number }) => o.packId === r.packId && o.packSize === 3)).toBe(true);
    for (const entry of list.items) expectBrand(await getPdf(entry.id), entry.companyId);
  });

  it('pack: три многостраничных PDF на бланках фирм, общий фон второй страницы не попадает в пакет', async () => {
    const png = await sharp({ create: { width: 210, height: 297, channels: 3, background: '#aaaa11' } }).png().toBuffer();
    await http().post('/api/offers/backgrounds').set(auth()).field('name', 'Общий фон').field('page', '2').field('isDefault', 'true')
      .attach('file', png, { filename: 'b.png', contentType: 'image/png' }).expect(201);
    const { body } = await http().post('/api/offers/pack').set(auth()).send({
      customer: 'Заказчик',
      items: Array.from({ length: 35 }, (_, index) => ({ productName: 'Мостик ' + (index + 1), quantity: 1, unitPrice: 100 })),
      companies: [{ companyId: siy }, { companyId: privat, markupPercent: 3 }, { companyId: ssyu, markupPercent: 5 }],
    }).expect(201);
    expect(body.packId).toBeTruthy();
    expect(body.items.map((offer: { total: number }) => offer.total)).toEqual([3500, 3605, 3675]);
    for (const offer of body.items) {
      const pdf = await getPdf(offer.id);
      expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
      expectBrand(pdf, offer.companyId);
    }
  });

  it('copies: та же фирма / без бланка / повтор — 400', async () => {
    await http().post(`/api/offers/${offerId}/copies`).set(auth()).send({ companies: [{ companyId: siy }] }).expect(400);
    await http().post(`/api/offers/${offerId}/copies`).set(auth())
      .send({ companies: [{ companyId: privat }, { companyId: privat, markupPercent: 1 }] }).expect(400);
    const noBlank = String((await db().collection('organizations').insertOne({ name: 'Без бланка', isOurCompany: true, deletedAt: null })).insertedId);
    const err = await http().post(`/api/offers/${offerId}/copies`).set(auth()).send({ companies: [{ companyId: noBlank }] }).expect(400);
    expect(String(err.body.message || err.body.error || '')).toMatch(/нет бланка/);
  });
});
