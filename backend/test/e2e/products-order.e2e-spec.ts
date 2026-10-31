import request from 'supertest';
import { Types } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/* eslint-disable @typescript-eslint/no-require-imports */
const fillDefaults = require('../../scripts/products-fill-defaults.js');
const seriesFill = require('../../scripts/series-dict-fill.js');

/** Порядок в «Изделиях» (ИЗ-18, docs/roles/tz/PRODUCTS-ORDER.md): категория и поля паспорта из изделия, серия из справочника, скрипты. */
describe('Изделия: порядок (ИЗ)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const as = () => authHeader(admin.access);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    for (const c of ['productpassports', 'products', 'dict_values']) await db().collection(c).deleteMany({});
    await db().collection('dict_values').insertMany([
      { dict: 'passportCategories', code: 'TRN', name: 'Уличный тренажёр', deletedAt: null },
      { dict: 'passportCategories', code: 'BLG', name: 'Игровой комплекс', deletedAt: null },
      { dict: 'productSeries', name: 'Сказка', deletedAt: null },
    ]);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  const prod = async (over: Record<string, unknown> = {}) => (await db().collection('products').insertOne({ name: 'Турник', sku: `T-${new Types.ObjectId()}`, deletedAt: null, passportDefaults: { passportCategory: 'TRN' }, weightKg: 20, ...over })).insertedId;
  const bin = (res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); };

  it('черновик с изделием: категория и поля из изделия при GET/PATCH/PDF', async () => {
    const pid = await prod();
    const p = (await http().post('/api/passports').set(as()).send({ productId: String(pid), name: 'Старое имя', passportCategory: 'BLG' }).expect(201)).body;
    const g = (await http().get(`/api/passports/${p.id}`).set(as()).expect(200)).body;
    expect(g.passportCategory).toBe('TRN');
    expect(g.name).toBe('Турник');
    expect(g.fromProduct).toBe(true);
    const u = (await http().patch(`/api/passports/${p.id}`).set(as()).send({ passportCategory: 'BLG', name: 'Чужое' }).expect(200)).body;
    expect(u.passportCategory).toBe('TRN');
    expect(u.name).toBe('Турник');
    await db().collection('products').updateOne({ _id: pid }, { $set: { 'passportDefaults.passportCategory': 'BLG' } });
    await http().get(`/api/passports/${p.id}/pdf`).set(as()).buffer(true).parse(bin as never).expect(200);
    expect((await http().get(`/api/passports/${p.id}`).set(as()).expect(200)).body.passportCategory).toBe('BLG');
  });

  it('выданный не меняется; паспорт без изделия сохраняет свой выбор', async () => {
    const pid = await prod();
    const iss = await db().collection('productpassports').insertOne({ passportNumber: `X${Date.now()}`, passportNo: 90001, status: 'issued', productId: pid, name: 'Выданный', passportCategory: 'BLG', images: [], deletedAt: null });
    const g = (await http().get(`/api/passports/${iss.insertedId}`).set(as()).expect(200)).body;
    expect(g.passportCategory).toBe('BLG');
    expect(g.name).toBe('Выданный');
    expect(g.categoryDiffers).toBe(true);
    const free = (await http().post('/api/passports').set(as()).send({ name: 'Без изделия', passportCategory: 'BLG' }).expect(201)).body;
    const u = (await http().patch(`/api/passports/${free.id}`).set(as()).send({ passportCategory: 'TRN' }).expect(200)).body;
    expect(u.passportCategory).toBe('TRN');
    expect(u.name).toBe('Без изделия');
  });

  it('снимок с ручной правкой (editedAt) не пересобирается при смене категории изделия', async () => {
    const pid = await prod();
    const p = (await http().post('/api/passports').set(as()).send({ productId: String(pid) }).expect(201)).body;
    const at = new Date('2026-01-01');
    await db().collection('productpassports').updateOne({ _id: new Types.ObjectId(p.id) }, { $set: { 'textSnapshot.editedAt': at, 'textSnapshot.marker': 'ручной' } });
    await db().collection('products').updateOne({ _id: pid }, { $set: { 'passportDefaults.passportCategory': 'BLG' } });
    await http().get(`/api/passports/${p.id}`).set(as()).expect(200);
    const raw = await db().collection('productpassports').findOne({ _id: new Types.ObjectId(p.id) });
    expect(raw!.textSnapshot.marker).toBe('ручной');
    expect(raw!.textSnapshot.editedAt).toEqual(at);
  });

  it('fullName изделие не пишет; серия — только из справочника', async () => {
    const mk = (over: Record<string, unknown>) => http().post('/api/showcase').set(as()).send({ sku: `S-${new Types.ObjectId()}`, name: 'Горка', type: 'Спорт', status: 'draft', ...over });
    const a = (await mk({ fullName: 'Длинное название', series: 'Сказка' }).expect(201)).body;
    const raw = await db().collection('products').findOne({ _id: new Types.ObjectId(a.id) });
    expect(raw!.fullName ?? null).toBeNull();
    expect(raw!.series).toBe('Сказка');
    await mk({ series: 'Выдуманная' }).expect(400);
    await mk({ series: '' }).expect(201);
    await http().patch(`/api/showcase/${a.id}`).set(as()).send({ series: 'Нет такой' }).expect(400);
    await http().patch(`/api/showcase/${a.id}`).set(as()).send({ series: '' }).expect(200);
  });

  it('скрипты: план ничего не пишет, повторный apply = 0', async () => {
    await db().collection('dict_values').deleteMany({ dict: 'productSeries' });
    await db().collection('products').deleteMany({});
    const ph = new Types.ObjectId();
    const p1 = (await db().collection('products').insertOne({ name: 'А', sku: 'A1', series: 'Новая', deletedAt: null })).insertedId;
    await db().collection('products').insertOne({ name: 'Б', sku: 'B1', series: 'новая', orderName: 'Б по договору', deletedAt: null });
    await db().collection('productpassports').insertOne({ passportNumber: `Y${Date.now()}`, productId: p1, images: [{ kind: 'overview', photoId: ph }], updatedAt: new Date(), deletedAt: null });
    const list = () => db().collection('products').find({ deletedAt: null }).toArray();
    const pps = () => db().collection('productpassports').find({}).toArray();
    const before = JSON.stringify(await list());
    const plan1 = fillDefaults.buildPlan(await list(), await pps());
    const plan2 = seriesFill.buildPlan(await list(), []);
    expect(plan1.orderName.length).toBe(1);
    expect(plan1.photos.length).toBe(1);
    expect(plan2.add.length).toBe(1);
    expect(JSON.stringify(await list())).toBe(before);
    expect(await db().collection('dict_values').countDocuments({ dict: 'productSeries' })).toBe(0);
    expect(await fillDefaults.applyPlan(db(), plan1, { ObjectId: Types.ObjectId })).toEqual({ names: 1, photos: 1 });
    expect((await seriesFill.applyPlan(db(), plan2)).length).toBe(1);
    const again = fillDefaults.buildPlan(await list(), await pps());
    expect(again.orderName.length + again.photos.length).toBe(0);
    expect(await fillDefaults.applyPlan(db(), again, { ObjectId: Types.ObjectId })).toEqual({ names: 0, photos: 0 });
    const names = (await db().collection('dict_values').find({ dict: 'productSeries', deletedAt: null }).toArray()).map((x) => x.name);
    expect(seriesFill.buildPlan(await list(), names).add.length).toBe(0);
  });
});
