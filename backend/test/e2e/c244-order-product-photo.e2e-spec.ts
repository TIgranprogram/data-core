import request from 'supertest';
import { createHash } from 'crypto';
import { Types, mongo } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { ARCHIVES, CHUNKS } from '../../src/modules/salesorders/order-archive.schema';

describe('C244 — фото сопоставленного изделия в заказе', () => {
  let ctx: TestContext | undefined, app: INestApplication, token: AuthTokens;
  let orderId: string, lineId: string;
  const productId = new Types.ObjectId(), otherId = new Types.ObjectId();
  const overviewId = new Types.ObjectId(), dimensionsId = new Types.ObjectId(), ownId = new Types.ObjectId(), catalogueId = new Types.ObjectId(), replacementId = new Types.ObjectId();
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  const photo = async () => (await http().get('/api/salesorders/' + orderId).set(auth()).expect(200)).body.lines.find((l: { id: string }) => l.id === lineId).photo;

  beforeAll(async () => {
    const uri = new URL(process.env.MONGO_URI ?? 'mongodb://127.0.0.1');
    if (process.env.MONGO_DB_TEST !== 'datacore-test-c244-photo' || !['127.0.0.1', 'localhost'].includes(uri.hostname)) throw new Error('C244: только выделенная локальная datacore-test-c244-photo');
    ctx = await createTestApp(); app = ctx.app; token = await loginAsAdmin(app);
    expect(ctx.connection.name).toBe('datacore-test-c244-photo');
    await db().collection('products').insertMany([{ _id: productId, name: 'Скамья2м', sku: '3413', photoIds: [], deletedAt: null }, { _id: otherId, name: 'Другое изделие', sku: '3414', photoIds: [], deletedAt: null }]);
    await db().collection('photos').insertMany([overviewId, dimensionsId, ownId, catalogueId, replacementId].map((_id) => ({ _id, variant: 'original', storageUrl: `/uploads/c244-${String(_id)}.png`, deletedAt: null })));
    await db().collection('productphotos').insertMany([{ productId, photoId: dimensionsId, purpose: 'passport', kind: 'dimensions', deletedAt: null }, { productId, photoId: overviewId, purpose: 'passport', kind: 'overview', sortOrder: 1, deletedAt: null }]);
    orderId = (await http().post('/api/salesorders').set(auth()).send({ orderNo: 'Договор C244', productionNo: '22-26', customer: 'Проверка C244' }).expect(201)).body.id;
    lineId = (await http().post('/api/incomes').set(auth()).send({ orderId, title: 'Позиция поставки', qty: 6, unit: 'шт', productId: String(productId) }).expect(201)).body.id;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('реальный3413-like: showcase/detail/production показывают одинoverview без записи photoIds', async () => {
    const productBefore = await db().collection('products').findOne({ _id: productId });
    const incomeBefore = await db().collection('incomes').findOne({ _id: new Types.ObjectId(lineId) });
    const catalogue = (await http().get('/api/showcase/' + String(productId)).set(auth()).expect(200)).body;
    expect(catalogue).toMatchObject({ photos: [], photoSource: 'passport', photo: { id: String(overviewId) } });
    const actual = await photo();
    expect(actual.url).toBe(`/uploads/c244-${String(overviewId)}.png`);
    const production = (await http().get('/api/production-orders/22-26').set(auth()).expect(200)).body;
    expect(production.orders[0].lines[0].photo).toEqual(actual);
    const lookup = (await http().get('/api/salesorders/lookup').query({ filter: 'all', lines: '1' }).set(auth()).expect(200)).body;
    expect(lookup.items.find((o: { id: string }) => o.id === orderId).lines[0].photo).toEqual(actual);
    expect(await db().collection('products').findOne({ _id: productId })).toEqual(productBefore);
    expect(await db().collection('incomes').findOne({ _id: new Types.ObjectId(lineId) })).toEqual(incomeBefore);
    expect((await http().get('/api/salesorders/' + orderId + '/lines-lookup').set(auth()).expect(200)).body[0].photoId).toBeNull(); // отдельный explicit-only контракт вне C244.
  });
  it('incomeoriginal выше catalogue, catalogue выше overview; повторное чтение видит новыйimport', async () => {
    await db().collection('products').updateOne({ _id: productId }, { $set: { photoIds: [catalogueId] } });
    expect((await photo()).url).toBe(`/uploads/c244-${String(catalogueId)}.png`);
    await http().post('/api/incomes/' + lineId + '/photos').set(auth()).send({ photoId: String(ownId) }).expect(200);
    expect((await photo()).url).toBe(`/uploads/c244-${String(ownId)}.png`);
    await db().collection('incomes').updateOne({ _id: new Types.ObjectId(lineId) }, { $set: { photoIds: [] } });
    await db().collection('products').updateOne({ _id: productId }, { $set: { photoIds: [] } });
    await db().collection('productphotos').updateOne({ productId, kind: 'overview' }, { $set: { photoId: replacementId } });
    expect((await photo()).url).toBe(`/uploads/c244-${String(replacementId)}.png`);
  });
  it('deletedoverview/другойkind/другоеизделие не дают чужое фото; после сменыproduct нет старого резерва', async () => {
    await db().collection('photos').updateOne({ _id: replacementId }, { $set: { deletedAt: new Date() } });
    expect(await photo()).toBeNull(); // dimensions не становится общим видом.
    await db().collection('productphotos').insertOne({ productId: otherId, photoId: ownId, purpose: 'passport', kind: 'overview', deletedAt: null });
    expect(await photo()).toBeNull();
    await http().patch('/api/incomes/' + lineId).set(auth()).send({ productId: String(otherId) }).expect(200);
    expect((await photo()).url).toBe(`/uploads/c244-${String(ownId)}.png`);
    await db().collection('productphotos').updateOne({ productId: otherId, kind: 'overview' }, { $set: { deletedAt: new Date() } });
    expect(await photo()).toBeNull();
  });
  it('closed/live photo projection не меняет frozen bundle/chunks/SHA и выдаёт сохранённые байты', async () => {
    const orderKey = new Types.ObjectId(orderId), data = Buffer.from('C244 immutable original'), sha256 = createHash('sha256').update(data).digest('hex');
    const archivedLine = { _id: new Types.ObjectId(lineId), title: 'Зафиксированная строка', photoIds: [catalogueId], productId, qty: 6 };
    await db().collection(ARCHIVES).insertOne({ orderId: orderKey, version: 1, archivedAt: new Date(), archivedBy: 'fixture', order: { _id: orderKey, stage: 'closed' }, lines: [archivedLine], work: [], plans: [], design: [], passports: [], shipments: [], reservations: [], requests: [], files: [{ id: 'c244-original', name: 'original.bin', mime: 'application/octet-stream', size: data.length, sha256 }] });
    await db().collection(CHUNKS).insertOne({ orderId: orderKey, version: 1, fileId: 'c244-original', seq: 0, data: new mongo.Binary(data) });
    await db().collection('salesorders').updateOne({ _id: orderKey }, { $set: { stage: 'closed', activeArchiveVersion: 1 } });
    const before = { archive: await db().collection(ARCHIVES).findOne({ orderId: orderKey }), chunks: await db().collection(CHUNKS).find({ orderId: orderKey }).toArray() };
    await db().collection('productphotos').updateOne({ productId: otherId, kind: 'overview' }, { $set: { deletedAt: null } });
    expect((await photo()).url).toBe(`/uploads/c244-${String(ownId)}.png`);
    const archive = (await http().get('/api/salesorders/' + orderId + '/archive/1').set(auth()).expect(200)).body;
    expect(archive.lines[0]).toMatchObject({ title: 'Зафиксированная строка', productId: String(productId) });
    const download = await http().get('/api/salesorders/' + orderId + '/archive/1/files/c244-original').set(auth()).expect(200);
    expect(Buffer.from(download.body)).toEqual(data);
    expect(createHash('sha256').update(download.body).digest('hex')).toBe(sha256);
    expect({ archive: await db().collection(ARCHIVES).findOne({ orderId: orderKey }), chunks: await db().collection(CHUNKS).find({ orderId: orderKey }).toArray() }).toEqual(before);
  });
});
