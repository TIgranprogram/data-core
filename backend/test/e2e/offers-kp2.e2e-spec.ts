import { gunzipSync } from 'node:zlib';
import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { Types } from 'mongoose';
import { uploadsRoot } from '../../src/common/uploads/safe-path';
import request from 'supertest';
import sharp from 'sharp';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** KP-2: preview без записи, копия с наценкой, defaults, companies/offersOnly, PATCH бланка, новые поля КП. */
describe('Offers KP-2 (шаблоны, предпросмотр, копия)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  let siy = '', privat = '', offerId = '', bgId = '';
  const body = () => ({
    companyId: siy, customer: 'ООО ИнжПроектСтрой', objectName: 'Мостик 5×2 м', validUntil: '2026-11-16', date: '2026-11-06',
    items: [{ productName: 'Мостик', quantity: 1, unit: 'шт', unitPrice: 680000 }],
    vatMode: 'with', vatRate: 22, delivery: 'included',
  });
  const pdf = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['commercialoffers', 'offerbackgrounds', 'organizations', 'settings']) await db().collection(c).deleteMany({});
    siy = String((await db().collection('organizations').insertOne({ name: 'СпортИН-ЮГ', isOurCompany: true, inn: '2310000001', vatRate: 22, deletedAt: null })).insertedId);
    privat = String((await db().collection('organizations').insertOne({ name: 'Приват-деал', inn: '2308066456', isOurCompany: true, deletedAt: null })).insertedId);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('бланк: загрузка с зоной и текстами, PATCH правит и сбрасывает null, встроенный — 400, зона вне диапазона — 400', async () => {
    const png = await sharp({ create: { width: 210, height: 297, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const up = await http().post('/api/offers/backgrounds').set(auth()).field('name', 'СИЮ').field('page', '1').field('companyId', siy).field('isDefault', 'true')
      .field('textTop', '0.26').field('textBottom', '0.78').field('defaultTerms', 'Аванс 80 %.').attach('file', png, { filename: 'b.png', contentType: 'image/png' }).expect(201);
    bgId = up.body.id;
    expect(up.body).toMatchObject({ textTop: 0.26, textBottom: 0.78, defaultTerms: 'Аванс 80 %.' });
    const p = await http().patch(`/api/offers/backgrounds/${bgId}`).set(auth()).send({ textTop: 0.3, defaultTerms: 'Аванс 50 %.' }).expect(200);
    expect(p.body).toMatchObject({ textTop: 0.3, textBottom: 0.78, defaultTerms: 'Аванс 50 %.' });
    const n = await http().patch(`/api/offers/backgrounds/${bgId}`).set(auth()).send({ textBottom: null }).expect(200);
    expect(n.body.textBottom ?? null).toBeNull();
    await http().patch(`/api/offers/backgrounds/${bgId}`).set(auth()).send({ textTop: 0.9 }).expect(400);
    await http().patch('/api/offers/backgrounds/builtin-1').set(auth()).send({ name: 'x' }).expect(400);
    const list = (await http().get('/api/offers/backgrounds').set(auth()).expect(200)).body.items.find((b: { id: string }) => b.id === bgId);
    expect(list).toMatchObject({ textTop: 0.3, defaultTerms: 'Аванс 50 %.' });
  });

  it('defaults: стандартные тексты фирмы и НДС по ставке', async () => {
    const d = (await http().get('/api/offers/defaults').query({ companyId: siy }).set(auth()).expect(200)).body;
    expect(d).toMatchObject({ terms: 'Аванс 50 %.', vatMode: 'with', vatRate: 22 });
    const d2 = (await http().get('/api/offers/defaults').query({ companyId: privat }).set(auth()).expect(200)).body;
    expect(d2.terms ?? '').toBe('');
  });

  it('preview: PDF без записи в базу и без траты номера', async () => {
    const before = await db().collection('commercialoffers').countDocuments({});
    const r = await http().post('/api/offers/preview').set(auth()).send(body()).buffer(true).parse(pdf).expect(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect((r.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect(await db().collection('commercialoffers').countDocuments({})).toBe(before);
    // без цены строки — тоже печатается
    await http().post('/api/offers/preview').set(auth()).send({ ...body(), items: [{ productName: 'Мостик', quantity: 1 }] }).expect(200);
    await http().post('/api/offers/preview').set(auth()).send({ ...body(), customer: '' }).expect(400);
    await http().post('/api/offers/preview').send(body()).expect(401);
    const first = (await http().post('/api/offers').set(auth()).send(body()).expect(201)).body;
    offerId = first.id;
    expect(first.number).toMatch(/^КП-\d{4}-001$/); // preview номер не потратил
    expect(first).toMatchObject({ objectName: 'Мостик 5×2 м', vatMode: 'with', vatRate: 22, delivery: 'included', total: 680000 });
  });

  it('новые поля КП: плохие значения — 400, правка и сброс', async () => {
    await http().post('/api/offers').set(auth()).send({ ...body(), vatMode: 'x' }).expect(400);
    await http().post('/api/offers').set(auth()).send({ ...body(), delivery: 'maybe' }).expect(400);
    await http().post('/api/offers').set(auth()).send({ ...body(), vatRate: 40 }).expect(400);
    await http().post('/api/offers').set(auth()).send({ ...body(), objectName: 'x'.repeat(501) }).expect(400);
    const r = await http().patch(`/api/offers/${offerId}`).set(auth()).send({ vatMode: 'without', delivery: 'excluded' }).expect(200);
    expect(r.body).toMatchObject({ vatMode: 'without', delivery: 'excluded' });
    await http().patch(`/api/offers/${offerId}`).set(auth()).send({ vatMode: 'with', delivery: 'included' }).expect(200);
  });

  it('копия: +3 % → 700 400, +5 % → 714 000, бланк новой фирмы, copyOf, оригинал цел', async () => {
    const c3 = (await http().post(`/api/offers/${offerId}/copy`).set(auth()).send({ companyId: privat, markupPercent: 3 }).expect(201)).body;
    expect(c3).toMatchObject({ status: 'draft', total: 700400, copyOf: offerId, companyName: 'Приват-деал', customer: 'ООО ИнжПроектСтрой', objectName: 'Мостик 5×2 м' });
    expect(c3.id).not.toBe(offerId);
    expect(c3.bg1Id ?? null).toBeNull();
    expect(c3.items[0].unitPrice).toBe(700400);
    const c5 = (await http().post(`/api/offers/${offerId}/copy`).set(auth()).send({ companyId: privat, markupPercent: 5 }).expect(201)).body;
    expect(c5.total).toBe(714000);
    const c0 = (await http().post(`/api/offers/${offerId}/copy`).set(auth()).send({ companyId: privat }).expect(201)).body;
    expect(c0.total).toBe(680000);
    expect((await http().get(`/api/offers/${offerId}`).set(auth()).expect(200)).body.total).toBe(680000);
    await http().post(`/api/offers/${offerId}/copy`).set(auth()).send({ companyId: privat, markupPercent: 101 }).expect(400);
    await http().post(`/api/offers/${offerId}/copy`).set(auth()).send({ companyId: privat, markupPercent: -51 }).expect(400);
    await http().post(`/api/offers/${offerId}/copy`).set(auth()).send({ companyId: '5f0000000000000000000000' }).expect(400);
    await http().post('/api/offers/5f0000000000000000000000/copy').set(auth()).send({ companyId: privat }).expect(404);
    const logs = await db().collection('auditlogs').countDocuments({ action: 'offer.copied' });
    expect(logs).toBeGreaterThanOrEqual(1);
  });

  it('«только для КП»: Приват-деал в /offers/companies, но не в списках «Денег»', async () => {
    const before = (await http().get('/api/offers/companies').set(auth()).expect(200)).body;
    expect(before.items.find((c: { name: string }) => c.name === 'Приват-деал')).toMatchObject({ offersOnly: false });
    await http().patch(`/api/offers/companies/${privat}`).set(auth()).send({ offersOnly: true }).expect(200);
    const after = (await http().get('/api/offers/companies').set(auth()).expect(200)).body;
    expect(after.total).toBe(2);
    expect(after.items.find((c: { name: string }) => c.name === 'Приват-деал')).toMatchObject({ offersOnly: true });
    const lk = (await http().get('/api/incomes/lookups').set(auth()).expect(200)).body;
    const names = JSON.stringify(lk);
    expect(names).toContain('СпортИН-ЮГ');
    expect(names).not.toContain('Приват-деал');
    // КП на такую фирму всё равно создаётся
    await http().post('/api/offers').set(auth()).send({ ...body(), companyId: privat }).expect(201);
    await http().patch(`/api/offers/companies/${privat}`).set(auth()).send({ offersOnly: 'да' }).expect(400);
    await http().patch(`/api/offers/companies/${privat}`).set(auth()).send({ offersOnly: false }).expect(200);
    expect(JSON.stringify((await http().get('/api/incomes/lookups').set(auth()).expect(200)).body)).toContain('Приват-деал');
  });

  it('старое КП (без новых полей) печатается', async () => {
    const old = await db().collection('commercialoffers').insertOne({
      number: 'КП-2026-900', status: 'draft', companyId: siy, companyName: 'СпортИН-ЮГ', customer: 'Старый', date: new Date(), validUntil: null,
      items: [{ productName: 'Урна', quantity: 1, unit: 'шт', unitPrice: 100, total: 100 }], total: 100, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
    });
    const r = await http().get(`/api/offers/${String(old.insertedId)}/pdf`).set(auth()).buffer(true).parse(pdf).expect(200);
    expect((r.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('номерной предпросмотр раскладки не пишет в КП, PATCH сохраняет версию и отклоняет старую правку', async () => {
    const created = await http().post('/api/offers').set(auth()).send(body()).expect(201);
    const url = '/api/offers/' + created.body.id;
    await http().post(url + '/status').set(auth()).send({ status: 'sent' }).expect(200);
    const before = (await http().get(url).set(auth()).expect(200)).body;
    const changes = { expectedUpdatedAt: before.updatedAt, date: '2026-11-09', notes: 'Положение проверено',
      layout: { blocks: ['notes', 'text:intro', 'table', 'info', 'terms'], texts: [{ id: 'intro', text: 'Гарантия на изделие', xMm: 6, gapMm: 4 }], table: { gapMm: 3, xMm: 2 }, tableWidthMm: 163 },
      items: [{ ...body().items[0], rowMm: 32, photoMm: 21, pageBreakBefore: true }] };
    const preview = await http().post(url + '/preview').set(auth()).send(changes).buffer(true).parse(pdf).expect(200);
    expect(preview.body.subarray(0, 4).toString()).toBe('%PDF');
    expect(JSON.parse(preview.headers['x-offer-pages'])).toMatchObject({ count: 2, blocks: { document: 1, table: 2 }, rows: [2] });
    const unpack = (encoded: string) => JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')).toString());
    const g = unpack(preview.headers['x-offer-geometry']);
    expect(g.pages[0]).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'text:intro', x: 57 })]));
    expect(g.pages[1]).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'row', row: 0 })]));
    expect((await http().get(url).set(auth()).expect(200)).body.updatedAt).toBe(before.updatedAt);
    const saved = (await http().patch(url).set(auth()).send(changes).expect(200)).body;
    expect(saved).toMatchObject({ layout: changes.layout, number: before.number, versionCount: 1 });
    expect(saved.versions[0].snapshot.items[0].rowMm).toBeUndefined();
    expect(saved.date.slice(0, 10)).toBe(changes.date);
    const output = await http().get(url + '/pdf?geometryPage=2').set(auth()).buffer(true).parse(pdf).expect(200);
    expect(unpack(output.headers['x-offer-geometry'])).toMatchObject({ page: 2, pages: [g.pages[1]] });
    await http().get(url + '/pdf?geometryPage=99').set(auth()).expect(400);
    await http().post(url + '/preview').set(auth()).send({ layout: { ...changes.layout, texts: [] } }).expect(400);
    await http().post(url + '/preview').set(auth()).send({ layout: { ...changes.layout, texts: [{ id: 'intro', text: '  ' }] } }).expect(400);
    const cleared = await http().patch(url).set(auth()).send({ expectedUpdatedAt: saved.updatedAt,
      layout: { blocks: ['table', 'info', 'terms', 'notes'], texts: [] } }).expect(200);
    expect(cleared.body.layout.texts).toEqual([]);
    await http().patch(url).set(auth()).send(changes).expect(409);
    await http().post(url + '/preview').set(auth()).send({ expectedUpdatedAt: cleared.body.updatedAt,
      layout: { blocks: ['table', 'table', 'info', 'terms'] } }).expect(400);
  });

  it('старые строки: печать и готовность используют читаемое фото изделия, снимок строки и прежнюю витрину', async () => {
    await fs.mkdir(uploadsRoot(), { recursive: true });
    const dir = await fs.mkdtemp(join(uploadsRoot(), 'c208-photo-'));
    const files = ['main', 'gallery', 'legacy', 'explicit'];
    const expected: Buffer[] = [];
    const url = (name: string) => '/uploads/' + basename(dir) + '/' + name + '.png';
    try {
      for (const [n, name] of files.entries()) {
        const path = join(dir, name + '.png');
        await sharp({ create: { width: 24, height: 16, channels: 3, background: ['#ab1234', '#12ab34', '#1234ab', '#d08b15'][n] } }).png().toFile(path);
        expected.push(await sharp(path).flatten({ background: '#ffffff' }).resize(240, 240, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer());
      }
      const main = new Types.ObjectId(), other = new Types.ObjectId(), deletedPhoto = new Types.ObjectId();
      const product = new Types.ObjectId(), gallery = new Types.ObjectId(), legacy = new Types.ObjectId(), broken = new Types.ObjectId();
      await db().collection('products').insertMany([
        { _id: product, sku: 'c208-photo-main', mainPhotoId: main, photoIds: [other, main], deletedAt: null },
        { _id: gallery, sku: 'c208-photo-gallery', photoIds: [deletedPhoto, other], deletedAt: null },
        { _id: broken, sku: 'c208-photo-broken', mainPhotoId: deletedPhoto, deletedAt: null },
      ]);
      await db().collection('photos').insertMany([
        { _id: main, storageUrl: url('main'), deletedAt: null }, { _id: other, storageUrl: url('gallery'), deletedAt: null },
        { _id: deletedPhoto, storageUrl: url('gallery'), deletedAt: new Date() },
      ]);
      await db().collection('showcaseitems').insertOne({ _id: legacy, photo: { thumb: url('missing'), url: url('legacy') }, deletedAt: null });
      const item = (productName: string, productId: Types.ObjectId, photoUrl?: string) => ({ productName, productId: String(productId), photoUrl, quantity: 1, unitPrice: 200 });
      const items = [item('Главное', product), item('Из галереи', gallery, url('missing')), item('Прежний каталог', legacy),
        item('Снимок строки', product, url('explicit')), item('Битое фото', broken, url('missing'))];
      const record = (await http().post('/api/offers').set(auth()).send({ ...body(), items }).expect(201)).body;
      const check = (await http().get('/api/offers/' + record.id + '/check').set(auth()).expect(200)).body;
      expect(check.offer.problems.filter((s: string) => s.startsWith('Нет фото'))).toEqual(['Нет фото: «Битое фото»']);
      const result = await http().get('/api/offers/' + record.id + '/pdf').set(auth()).buffer(true).parse(pdf).expect(200);
      for (const jpeg of expected) expect(result.body.includes(jpeg)).toBe(true);
    } finally {
      await Promise.all(files.map((name) => fs.rm(join(dir, name + '.png'), { force: true })));
      await fs.rmdir(dir);
    }
  });
});
