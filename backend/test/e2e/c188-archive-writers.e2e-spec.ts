import sharp from 'sharp';
import * as orderWrites from '../../src/common/order-archive/write';
import { createHash } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { Types } from 'mongoose';
import request from 'supertest';
import { uploadsRoot } from '../../src/common/uploads/safe-path';
import * as archiveFiles from '../../src/modules/salesorders/order-archive-files';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';

describe('C188 — писатели архивного комплекта на Mongo rs0', () => {
  let ctx: TestContext, token: string;
  const diskFiles: string[] = [];
  const db = () => ctx.connection.db!;
  const api = () => request(ctx.app.getHttpServer());
  const auth = () => authHeader(token);
  const newid = () => new Types.ObjectId();
  beforeAll(async () => {
    const name = process.env.MONGO_DB_TEST;
    if (!(name === 'datacore-test' || name?.startsWith('datacore-test-')) || !['localhost', '127.0.0.1'].includes(new URL(process.env.MONGO_URI!).hostname)) throw new Error('C188 требует отдельную локальную БД');
    ctx = await createTestApp({ strictValidation: true });
    expect(ctx.connection.name).toBe(name);
    // Mongo 4.4 требует эксклюзивную фазу построения индекса. Не ставим паузу в тестовой транзакции до завершения индексов.
    await Promise.all(['Income', 'SalesOrder', 'ProductPassport', 'Photo', 'Shipment'].map(n => ctx.connection.model(n).init()));
    token = (await loginAsAdmin(ctx.app)).access;
    await mkdir(uploadsRoot(), { recursive: true });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await ctx?.cleanup();
    for (const file of diskFiles) await unlink(file).catch(() => undefined);
  });

  async function fixture() {
    const order = newid(), line = newid(), passport = newid(), photo = newid();
    const name = 'c188-' + photo + '.pdf', path = join(uploadsRoot(), name);
    const bytes = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF');
    await writeFile(path, bytes);
    diskFiles.push(path);
    await db().collection('photos').insertOne({ _id: photo, storageUrl: '/uploads/' + name, mimeType: 'application/pdf', deletedAt: null });
    await db().collection('salesorders').insertOne({ _id: order, productionNo: 'C188-' + order, orderNo: String(order), stage: 'production', deletedAt: null,
      legal: { state: 'verified', currency: 'RUB', documents: [{ uid: 'act', kind: 'acceptance', date: '2020-01-01', fileId: photo, sourceSha256: createHash('sha256').update(bytes).digest('hex') }] } });
    await db().collection('incomes').insertOne({ _id: line, orderId: order, lineType: 'service', serviceId: newid(), title: 'Монтаж C188',
      qty: 1, unitPrice: 100, amount: 100, paidDate: new Date('2020-01-01'), deletedAt: null });
    await db().collection('productpassports').insertOne({ _id: passport, salesOrderId: order, status: 'draft', passportNumber: 'draft-' + passport, deletedAt: null });
    const close = () => api().post('/api/salesorders/' + order + '/archive').set(auth()).send({
      clientUid: 'c188-' + order, expectedStateVersion: 0, reason: 'Исполнение по акту', evidenceDocumentUid: 'act',
      manufactureComplete: true, documentsComplete: true, servicesComplete: true, installationComplete: true,
    });
    return { order, line, passport, photo, close };
  }

  async function linePhoto(f: Awaited<ReturnType<typeof fixture>>) {
    const photo = newid(), alias = newid(), name = 'c188-' + photo + '.png';
    const path = join(uploadsRoot(), name);
    diskFiles.push(path);
    await sharp({ create: { width: 2, height: 2, channels: 3, background: '#f00' } }).png().toFile(path);
    await db().collection('photos').insertMany([photo, alias].map(_id => ({ _id, storageUrl: '/uploads/' + name, deletedAt: null })));
    await db().collection('incomes').updateOne({ _id: f.line }, { $set: { photoIds: [photo] } });
    return alias;
  }

  async function inventor(f: Awaited<ReturnType<typeof fixture>>) {
    const install = (await db().collection('dict_values').findOne({ dict: 'passportInstall', code: 'CONCRETE_POSTS' }))?._id
      ?? (await db().collection('dict_values').insertOne({ dict: 'passportInstall', code: 'CONCRETE_POSTS', name: 'Бетонирование', deletedAt: null })).insertedId;
    const product = (await db().collection('products').insertOne({ name: 'Скамья', passportDefaults: { installationTypeId: install }, weightKg: 5, deletedAt: null })).insertedId;
    await db().collection('productpassports').updateOne({ _id: f.passport }, { $set: { productId: product, installationTypeId: install, weight: 5 } });
    const images: Array<{ kind: string; photoId: string }> = [];
    for (const kind of ['overview', 'dimensions', 'foundation']) {
      const photo = newid(), name = 'c188-' + photo + '.png', path = join(uploadsRoot(), name);
      diskFiles.push(path);
      await sharp({ create: { width: 2, height: 2, channels: 3, background: '#00f' } }).png().toFile(path);
      await db().collection('photos').insertOne({ _id: photo, mimeType: 'image/png', storageUrl: '/uploads/' + name, deletedAt: null });
      images.push({ kind, photoId: String(photo) });
    }
    const url = '/api/products/' + product + '/passport-import';
    const token = async () => (await api().get(url + '-context').set(auth()).expect(200)).body.contextToken;
    return async () => api().post(url).set(auth()).send({ contextToken: await token(), images, confirmed: { weightKg: 10 } });
  }

  it('защита действует для шапки, строки, платежа, добавления строк, прямой отмены массовой правки и файлов', async () => {
    const f = await fixture();
    await f.close().expect(200);
    const owner = '/api/salesorders/' + f.order, income = '/api/incomes/' + f.line;
    const calls = [
      () => api().patch(owner).send({ notes: 'Изменить' }),
      () => api().patch(income).send({ notes: 'Изменить' }),
      () => api().post(income + '/payments').send({ amount: 10, date: '2020-01-02' }),
      () => api().post('/api/incomes').send({ orderId: String(f.order), title: 'Ещё одна' }),
      () => api().delete(income + '/photos/' + f.photo),
      () => api().delete('/api/passports/' + f.passport),
      () => api().post('/api/passports/bulk/restore').send({ items: [{ id: String(f.passport), set: { warrantyMonths: 5 } }] }),
      () => api().post(owner + '/shipments').send({ lines: [{ incomeId: String(f.line), qty: 1 }] }),
    ];
    for (const build of calls) {
      const call = build();
      const r = await call.set(auth());
      expect({ path: call.url.split('/api/')[1], status: r.status, code: r.body.code }).toEqual({
        path: call.url.split('/api/')[1], status: 409, code: 'ORDER_ARCHIVED',
      });
    }
    await api().delete('/api/photos/' + f.photo).set(auth()).expect(409);
    expect(await db().collection('incomes').countDocuments({ orderId: f.order })).toBe(1);
    expect(await db().collection('productpassports').findOne({ _id: f.passport })).not.toHaveProperty('warrantyMonths');
  });

  it('присоединение нового договора пересчитывает архивность группы и сохраняет прежний комплект', async () => {
    const f = await fixture();
    await f.close().expect(200);
    const no = 'C188-' + f.order;
    const group = () => api().get('/api/production-orders/' + no).set(auth());
    expect((await group().expect(200)).body.archived).toBe(true);
    await api().post('/api/salesorders').set(auth()).send({ orderNo: 'Доп-' + f.order, productionNo: no }).expect(201);
    expect((await group().expect(200)).body.archived).toBe(false);
    expect((await db().collection('salesorderarchives').findOne({ orderId: f.order, version: 1 }))?.order.productionNo).toBe(no);
  });

  it('массовая правка или отмена с архивным паспортом сохраняет открытый паспорт', async () => {
    const open = await fixture(), closed = await fixture();
    await closed.close().expect(200);
    const ids = [String(open.passport), String(closed.passport)];
    const set = { warrantyMonths: 13 };
    for (const [route, body] of [['bulk', { ids, set }], ['bulk/restore', { items: ids.map(id => ({ id, set })) }]] as const) {
      const r = await api().post('/api/passports/' + route).set(auth()).send(body);
      expect({ status: r.status, code: r.body.code }).toEqual({ status: 409, code: 'ORDER_ARCHIVED' });
      expect((await db().collection('productpassports').findOne({ _id: open.passport }))?.warrantyMonths).toBeUndefined();
    }
    const changed = await api().post('/api/passports/bulk').set(auth()).send({ ids: [String(open.passport)], set }).expect(200);
    expect(changed.body.updated).toBe(1);
    expect((await db().collection('productpassports').findOne({ _id: open.passport }))?.warrantyMonths).toBe(13);
  });

  it('склад и снабжение проверяют обе связи, общий склад остаётся доступным', async () => {
    const f = await fixture(), material = newid(), requestId = newid(), reservation = newid();
    const wh = (await db().collection('warehouses').findOne({ isDefault: true }))?._id
      ?? (await db().collection('warehouses').insertOne({ name: 'Главный', type: 'main', isDefault: true, isActive: true })).insertedId;
    await db().collection('materials').insertOne({ _id: material, name: 'Болт C188', unit: 'шт', deletedAt: null });
    await db().collection('storageitems').insertOne({ warehouseId: wh, materialId: material, quantity: 12, reservedQty: 0, deletedAt: null });
    await db().collection('supplyrequests').insertOne({ _id: requestId, title: 'Отдельная закупка', qty: 1, status: 'received', salesOrderLineId: f.line, deletedAt: null });
    await db().collection('reservations').insertOne({ _id: reservation, qty: 1, warehouseId: wh, materialId: material, status: 'active', isActive: true, deletedAt: null });
    await f.close().expect(200);
    const move = '/api/stock/items/' + material + '/move';
    const writes = [
      () => api().post('/api/supply/requests').send({ title: 'Закупка C188', salesOrderId: String(f.order) }),
      () => api().patch('/api/supply/requests/' + requestId).send({ notes: 'Переписать' }),
      () => api().post('/api/stock/reserve-list').send({ salesOrderId: String(f.order), lines: [{ materialId: String(material), qty: 1 }] }),
      () => api().patch('/api/stock/reservations/' + reservation).send({ salesOrderId: String(f.order), salesOrderLineId: String(f.line) }),
      () => api().post(move).send({ type: 'out', qty: 1, salesOrderLineId: String(f.line) }),
    ];
    for (const write of writes) {
      const r = await write().set(auth());
      expect({ status: r.status, code: r.body.code, message: r.status === 409 ? undefined : r.body.message }).toEqual({ status: 409, code: 'ORDER_ARCHIVED' });
    }
    await api().post(move).set(auth()).send({ type: 'in', qty: 1 }).expect(201);
    expect(await db().collection('stockmovements').countDocuments({ materialId: material })).toBe(1);
    expect((await db().collection('storageitems').findOne({ materialId: material }))?.quantity).toBe(13);
    expect((await db().collection('reservations').findOne({ _id: reservation }))?.salesOrderId).toBeUndefined();
    expect((await db().collection('supplyrequests').findOne({ _id: requestId }))?.notes).toBeUndefined();
  });

  it.each(['правка позиции', 'снятие оплаты', 'новая позиция', 'заявка', 'изменение паспорта', 'отгрузка', 'удаление файла', 'Inventor'])(
    '%s между подготовкой и финальной фиксацией не оставляет устаревший снимок', async action => {
      const f = await fixture(), income = '/api/incomes/' + f.line;
      const alias = action === 'удаление файла' ? await linePhoto(f) : null;
      const apply = action === 'Inventor' ? await inventor(f) : null;
      const real = archiveFiles.prepareFiles;
      let ran = false;
      jest.spyOn(archiveFiles, 'prepareFiles').mockImplementationOnce(async (...args) => {
        const result = await real(...args);
        const write = () => action === 'правка позиции' ? api().patch(income).send({ notes: 'По факту' })
          : action === 'снятие оплаты' ? api().delete(income + '/payments/0')
          : action === 'заявка' ? api().post('/api/supply/requests').send({ title: 'Закупка для исполнения', salesOrderId: String(f.order) })
          : action === 'новая позиция' ? api().post('/api/incomes').send({ orderId: String(f.order), title: 'Дополнение' })
          : action === 'изменение паспорта' ? api().post('/api/passports/bulk/restore').send({ items: [{ id: String(f.passport), set: { warrantyMonths: 5 } }] })
          : action === 'отгрузка' ? api().post('/api/salesorders/' + f.order + '/shipments').send({ lines: [{ incomeId: String(f.line), qty: 1 }] })
          : api().delete('/api/photos/' + alias);
        const r = apply ? await apply() : await write().set(auth());
        expect([200, 201, 204]).toContain(r.status);
        ran = true;
        return result;
      });
      const r = await f.close();
      expect(ran).toBe(true);
      expect(r.status).toBe(409);
      expect(await db().collection('salesorderarchives').countDocuments({ orderId: f.order })).toBe(0);
      expect(await db().collection('salesorders').findOne({ _id: f.order })).not.toHaveProperty('activeArchiveVersion');
    });

  it.each(['позиция', 'оплата', 'отгрузка', 'Inventor'])('фиксация перед записью %s выдерживает конкурирующую транзакцию', async action => {
    const f = await fixture();
    const apply = action === 'Inventor' ? await inventor(f) : null;
    const original = orderWrites.claimWritableOrders;
    const writeOrder = orderWrites.withOrderWrite;
    let fixed = false;
    if (action === 'отгрузка') jest.spyOn(orderWrites, 'withOrderWrite').mockImplementation(async (conn, ids, write) => {
      if (!fixed && ids.some(id => String(id) === String(f.order))) {
        fixed = true;
        await f.close().expect(200);
      }
      return writeOrder(conn, ids, write);
    });
    jest.spyOn(orderWrites, 'claimWritableOrders').mockImplementation(async (db, session, ids) => {
      if (!fixed && ids.some(id => String(id) === String(f.order))) {
        fixed = true;
        await f.close().expect(200);
      }
      return original(db, session, ids);
    });
    const r = apply ? await apply()
      : action === 'позиция' ? await api().patch('/api/incomes/' + f.line).set(auth()).send({ notes: 'После фиксации' })
      : action === 'оплата' ? await api().delete('/api/incomes/' + f.line + '/payments/0').set(auth())
      : await api().post('/api/salesorders/' + f.order + '/shipments').set(auth()).send({ lines: [{ incomeId: String(f.line), qty: 1 }] });
    expect(fixed).toBe(true);
    expect(r.status).toBe(409);
    const saved = await db().collection('incomes').findOne({ _id: f.line });
    expect(saved).toHaveProperty('paidDate');
    expect(saved).not.toHaveProperty('notes');
    expect(await db().collection('shipments').countDocuments({ orderId: f.order })).toBe(0);
    if (apply) {
      expect((await db().collection('productpassports').findOne({ _id: f.passport }))?.weight).toBe(5);
      const fresh = await apply();
      expect(fresh.status).toBe(200);
      expect(fresh.body.skipped).toContainEqual({ id: String(f.passport), reason: 'order_closed' });
    }
  });
});
