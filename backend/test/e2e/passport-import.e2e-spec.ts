import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import request from 'supertest';
import { uploadsRoot } from '../../src/common/uploads/safe-path';
import { ProductPassportService } from '../../src/modules/product-passport/product-passport.service';
import { PassportPdfService } from '../../src/modules/product-passport/passport-pdf.service';
import * as renderer from '../../src/modules/product-passport/passport-pdf-v2';
import { PassportImportService } from '../../src/modules/product-passport/passport-import.service';
import { readPassportImage } from '../../src/modules/product-passport/passport-image-files';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { createTestApp, type TestContext } from '../setup/test-db';

describe('C172: атомарный импорт рисунков Inventor', () => {
  let ctx: TestContext | undefined, app: INestApplication, token: string;
  const files: string[] = [];
  const kinds = ['overview', 'dimensions', 'foundation'];
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token);
  beforeAll(async () => {
    if (!['datacore-test-c172', 'datacore-test-c172-release'].includes(process.env.MONGO_DB_TEST ?? '') || !['localhost', '127.0.0.1'].includes(new URL(process.env.MONGO_URI!).hostname)) throw new Error('Только локальная datacore-test-c172');
    ctx = await createTestApp({ strictValidation: true });
    expect(ctx.connection.name).toBe(process.env.MONGO_DB_TEST);
    app = ctx.app;
    token = (await loginAsAdmin(app)).access;
    await fs.mkdir(uploadsRoot(), { recursive: true });
  });
  afterAll(async () => {
    await ctx?.cleanup();
    await Promise.all(files.map(file => fs.unlink(file).catch(() => undefined)));
  });
  afterEach(() => jest.restoreAllMocks());
  async function images(color: string) {
    return Promise.all(kinds.map(async (kind, index) => {
      const _id = new Types.ObjectId(), name = `c172-${_id}.png`, file = join(uploadsRoot(), name);
      files.push(file);
      await sharp({ create: { width: 16 + index * 4, height: 12, channels: 3, background: color } }).png().toFile(file);
      await db().collection('photos').insertOne({ _id, storageUrl: `/uploads/${name}`, mimeType: 'image/png', deletedAt: null });
      return { kind, photoId: String(_id) };
    }));
  }
  async function fixture() {
    const old = await images('#112233'), fresh = await images('#445566');
    const productId = (await db().collection('products').insertOne({ name: 'C172 урна', dimensions: { length: 400, width: 500, height: 800, unit: 'мм' }, weightKg: 12, deletedAt: null })).insertedId;
    await db().collection('productphotos').insertMany(old.map(i => ({ ...i, photoId: new Types.ObjectId(i.photoId), productId, purpose: 'passport', deletedAt: null })));
    const passportId = (await db().collection('productpassports').insertOne({ productId, name: 'C172 урна', status: 'issued', passportNumber: `C172-${new Types.ObjectId()}`, revision: 1, length: 400, width: 500, height: 800, weight: 12, images: old.map(i => ({ ...i, photoId: new Types.ObjectId(i.photoId) })), manualText: 'Ручное неизменяемое пояснение', deletedAt: null })).insertedId;
    const url = `/api/products/${productId}/passport-import`;
    const context = async () => (await http().get(`${url}-context`).set(auth()).expect(200)).body.contextToken as string;
    const body = { contextToken: await context(), images: fresh, confirmed: { weightKg: 14 } };
    const apply = (b: object = body) => http().post(url).set(auth()).send(b);
    return { productId, passportId, old, fresh, url, context, body, apply };
  }
  it('один commit сохраняет номер, ручное поле, старые источники и историю; устаревший replay unchanged', async () => {
    const f = await fixture();
    const r = (await f.apply().expect(200)).body;
    expect(r).toMatchObject({ status: 'applied', updatedKinds: kinds, issued: [{ id: String(f.passportId), fromRevision: 1, toRevision: 2 }] });
    const p = await db().collection('productpassports').findOne({ _id: f.passportId });
    expect(p).toMatchObject({ revision: 2, weight: 14, manualText: 'Ручное неизменяемое пояснение' });
    expect(p!.revisions[0].data.images.map((i: { photoId: unknown }) => String(i.photoId))).toEqual(f.old.map(i => i.photoId));
    expect(p!.revisions[0].data.weight).toBe(12);
    expect((await f.apply().expect(200)).body.status).toBe('unchanged');
    const aliases = await images('#445566');
    expect((await f.apply({ ...f.body, images: aliases }).expect(200)).body.status).toBe('unchanged');
    expect((await db().collection('productpassports').findOne({ _id: f.passportId }))!.revision).toBe(2);
    expect(await db().collection('photos').countDocuments({ _id: { $in: f.old.map(i => new Types.ObjectId(i.photoId)) }, deletedAt: null })).toBe(3);
  });
  it('CAS отвергает изменившийся паспорт без частичного обновления изделия/связей', async () => {
    const f = await fixture();
    await db().collection('productpassports').updateOne({ _id: f.passportId }, { $set: { note: 'Конкурентная правка' } });
    await f.apply().expect(409);
    expect((await db().collection('products').findOne({ _id: f.productId }))!.weightKg).toBe(12);
    expect(await db().collection('productphotos').countDocuments({ productId: f.productId, deletedAt: null })).toBe(3);
  });
  it('отказ от чисел сохраняет их; чужое изделие и нецелевые виды не меняются', async () => {
    const f = await fixture(), otherProductId = new Types.ObjectId();
    const foreign = (await db().collection('productpassports').insertOne({ productId: otherProductId, status: 'issued', revision: 7, weight: 88, images: [], deletedAt: null })).insertedId;
    await db().collection('productphotos').insertOne({ productId: f.productId, purpose: 'showcase', kind: 'overview', photoId: new Types.ObjectId(f.old[0].photoId), deletedAt: null });
    await db().collection('productpassports').updateOne({ _id: f.passportId }, { $set: { images: [...f.old.map(i => ({ ...i, photoId: new Types.ObjectId(i.photoId) })), { kind: 'mounting', photoId: new Types.ObjectId(f.old[0].photoId) }] } });
    f.body.contextToken = await f.context();
    await f.apply({ ...f.body, confirmed: {} }).expect(200);
    expect((await db().collection('products').findOne({ _id: f.productId }))!.weightKg).toBe(12);
    expect((await db().collection('productpassports').findOne({ _id: f.passportId }))!.images).toContainEqual(expect.objectContaining({ kind: 'mounting', photoId: new Types.ObjectId(f.old[0].photoId) }));
    expect((await db().collection('productpassports').findOne({ _id: foreign }))!.revision).toBe(7);
    expect(await db().collection('productphotos').countDocuments({ productId: f.productId, purpose: 'showcase', deletedAt: null })).toBe(1);
  });
  it('повреждённый PNG и sourceDeleting не дают частичного commit', async () => {
    const f = await fixture();
    const photoId = new Types.ObjectId(f.fresh[1].photoId);
    const photo = (await db().collection('photos').findOne({ _id: photoId }))!;
    const file = join(uploadsRoot(), String(photo.storageUrl).split('/').pop()!);
    const bytes = await fs.readFile(file);
    await fs.writeFile(file, Buffer.from('это не PNG'));
    await f.apply().expect(400);
    expect((await db().collection('products').findOne({ _id: f.productId }))!.weightKg).toBe(12);
    expect((await db().collection('photos').findOne({ _id: new Types.ObjectId(f.fresh[0].photoId) }))!.sourceProtected).not.toBe(true);
    await fs.writeFile(file, bytes);
    await db().collection('photos').updateOne({ _id: photoId }, { $set: { sourceDeleting: true } });
    await f.apply().expect(409);
    expect((await db().collection('productpassports').findOne({ _id: f.passportId }))!.revision).toBe(1);
  });
  it('ошибка пересборки второго паспорта откатывает первый паспорт и изделие', async () => {
    const f = await fixture();
    await db().collection('productpassports').insertOne({ productId: f.productId, passportNumber: `draft-${new Types.ObjectId()}`, status: 'draft', images: [], deletedAt: null });
    f.body.contextToken = await f.context();
    const service = app.get(ProductPassportService), original = service.prepareImportedPassport.bind(service);
    let calls = 0;
    const spy = jest.spyOn(service, 'prepareImportedPassport').mockImplementation(async (...args) => {
      if (++calls === 2) throw new Error('C172 контролируемый сбой');
      return original(...args);
    });
    try { await f.apply().expect(409); } finally { spy.mockRestore(); }
    expect((await db().collection('products').findOne({ _id: f.productId }))!.weightKg).toBe(12);
    expect((await db().collection('productpassports').findOne({ _id: f.passportId }))!.revision).toBe(1);
  });
  it.each(['annulled', 'printFile'])('%s защищён и явно указан в skipped', async reason => {
    const f = await fixture();
    const set = reason === 'annulled' ? { status: 'annulled' } : { printFile: { photoId: new Types.ObjectId() } };
    await db().collection('productpassports').updateOne({ _id: f.passportId }, { $set: set });
    const before = await db().collection('productpassports').findOne({ _id: f.passportId });
    f.body.contextToken = await f.context();
    const r = (await f.apply().expect(200)).body;
    expect(r.skipped).toContainEqual({ id: String(f.passportId), reason });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(await db().collection('productpassports').findOne({ _id: f.passportId })).toEqual(before);
  });
  it('strict DTO не принимает неизвестные числа, повтор kind и отсутствие confirmed; auth обязателен', async () => {
    const f = await fixture();
    await http().post(f.url).send(f.body).expect(401);
    await http().get(`${f.url}-context`).expect(401);
    await f.apply({ ...f.body, confirmed: { price: 10 } }).expect(400);
    await f.apply({ ...f.body, images: [f.fresh[0], f.fresh[0], f.fresh[2]] }).expect(400);
    const missing: Record<string, unknown> = { ...f.body }; delete missing.confirmed;
    await f.apply(missing).expect(400);
  });
  it('закрытый договор даже с недоплатой сохраняет паспорт без изменений', async () => {
    const f = await fixture();
    const orderId = (await db().collection('salesorders').insertOne({ stage: 'closed', total: 100, paid: 0, deletedAt: null })).insertedId;
    await db().collection('productpassports').updateOne({ _id: f.passportId }, { $set: { salesOrderId: orderId } });
    const before = await db().collection('productpassports').findOne({ _id: f.passportId });
    f.body.contextToken = await f.context();
    const r = (await f.apply().expect(200)).body;
    expect(r.skipped).toContainEqual({ id: String(f.passportId), reason: 'order_closed' });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(await db().collection('productpassports').findOne({ _id: f.passportId })).toEqual(before);
  });
  it('договор изменился после context: весь импорт отклонён', async () => {
    const f = await fixture();
    const orderId = (await db().collection('salesorders').insertOne({ stage: 'active', deletedAt: null })).insertedId;
    await db().collection('productpassports').updateOne({ _id: f.passportId }, { $set: { salesOrderId: orderId } });
    f.body.contextToken = await f.context();
    await db().collection('salesorders').updateOne({ _id: orderId }, { $set: { stage: 'closed' } });
    await f.apply().expect(409);
    expect((await db().collection('products').findOne({ _id: f.productId }))!.weightKg).toBe(12);
  });
  it.each(['order_missing', 'source_attachment'])('%s явно защищает связанный паспорт', async reason => {
    const f = await fixture(), orderId = new Types.ObjectId();
    if (reason === 'source_attachment') await db().collection('salesorders').insertOne({ _id: orderId, stage: 'active', deletedAt: null });
    const incomeId = (await db().collection('incomes').insertOne({ orderId, productId: f.productId, passportSelection: { mode: 'attachment' }, deletedAt: null })).insertedId;
    await db().collection('productpassports').updateOne({ _id: f.passportId }, { $set: { salesOrderId: orderId, incomeId } });
    const before = await db().collection('productpassports').findOne({ _id: f.passportId });
    f.body.contextToken = await f.context();
    const r = (await f.apply().expect(200)).body;
    expect(r.skipped).toContainEqual({ id: String(f.passportId), reason });
    expect(await db().collection('productpassports').findOne({ _id: f.passportId })).toEqual(before);
  });
  it('несовпадение изделия позиции защищает паспорт; user не получает импорт', async () => {
    const f = await fixture();
    const orderId = (await db().collection('salesorders').insertOne({ stage: 'active', deletedAt: null })).insertedId;
    const incomeId = (await db().collection('incomes').insertOne({ orderId, productId: new Types.ObjectId(), deletedAt: null })).insertedId;
    await db().collection('productpassports').updateOne({ _id: f.passportId }, { $set: { salesOrderId: orderId, incomeId } });
    f.body.contextToken = await f.context();
    const r = (await f.apply().expect(200)).body;
    expect(r.skipped).toContainEqual({ id: String(f.passportId), reason: 'order_mismatch' });
    const username = `c172-user-${new Types.ObjectId()}`;
    await http().post('/api/admin/users').set(auth()).send({ username, password: 'c172-test-pass', role: 'user' }).expect(201);
    const userToken = (await http().post('/api/auth/login').send({ username, password: 'c172-test-pass' }).expect(200)).body.access;
    await http().post(f.url).set(authHeader(userToken)).send(f.body).expect(403);
  });
  it('PDF восстановленной истории содержит старые рисунки, текущий PDF — новые', async () => {
    const f = await fixture();
    await db().collection('productpassports').updateOne({ _id: f.passportId }, { $set: { passportCategory: 'BLG', textSnapshot: { sections: [{ key: 'general', title: 'C172', paragraphs: ['Исторический текст.'] }], description: 'Историческое описание C172' } } });
    f.body.contextToken = await f.context();
    const pdf = app.get(PassportPdfService);
    const render = jest.spyOn(renderer, 'renderPassportPdfV2');
    const oldPdf = (await pdf.pdf(String(f.passportId), { readOnly: true, pack: 'passport' })).buf;
    await f.apply().expect(200);
    const current = (await db().collection('productpassports').findOne({ _id: f.passportId }))!;
    const restored = { ...current, ...current.revisions[0].data, revisions: [], revision: 1 };
    await db().collection('productpassports').replaceOne({ _id: current._id }, restored);
    const historyPdf = (await pdf.pdf(String(restored._id), { readOnly: true, pack: 'passport' })).buf;
    await db().collection('productpassports').replaceOne({ _id: current._id }, current);
    const newPdf = (await pdf.pdf(String(f.passportId), { readOnly: true, pack: 'passport' })).buf;
    const imageStreams = (buf: Buffer) => [...buf.toString('latin1').matchAll(/\d+ 0 obj\s*<<(?:(?!endobj)[\s\S])*?\/Subtype \/Image(?:(?!endobj)[\s\S])*?stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(m => m[1]);
    const oldImages = imageStreams(oldPdf), historyImages = imageStreams(historyPdf), newImages = imageStreams(newPdf);
    expect(oldPdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(oldImages.length).toBeGreaterThanOrEqual(2);
    expect(new Set(oldImages).size).toBeGreaterThanOrEqual(2);
    expect(historyImages).toEqual(oldImages);
    expect(newImages).not.toEqual(oldImages);
    expect(render.mock.calls.map(call => call[0].passport.weight)).toEqual([12, 12, 14]);
    expect(current.textSnapshot.sizeLayout).toBe(2);
    expect(current.revisions[0].data.weight).toBe(12);
    render.mockRestore();
  });
  it('presentationVersion1: настоящий выпуск обновляет снимок, сохраняя исторические источники', async () => {
    const f = await fixture();
    await db().collection('productpassports').deleteOne({ _id: f.passportId });
    const org = (await db().collection('organizations').insertOne({ name: 'C172 наша фирма', inn: `C172-${new Types.ObjectId()}`, isOurCompany: true, deletedAt: null })).insertedId;
    const install = (await db().collection('dict_values').insertOne({ dict: 'passportInstall', code: 'anchor', name: 'Анкер', schemesMounting: [new Types.ObjectId(f.old[0].photoId)], deletedAt: null })).insertedId;
    await db().collection('dict_values').insertOne({ dict: 'passportCategories', code: 'BLG', name: 'C172', requiredImages: 'mounting', serviceLifeYears: 5, warrantyMonths: 12, deletedAt: null });
    for (const category of ['ALL_V2', 'BLG']) await db().collection('passporttemplates').updateOne({ category, version: 1 }, { $set: { isActive: true, sections: [{ key: 'general', title: 'Безопасность', paragraphs: ['Осмотр перед использованием.'] }], tables: [], deletedAt: null } }, { upsert: true });
    await db().collection('products').updateOne({ _id: f.productId }, { $set: { purpose: 'Отдых', passportDefaults: { passportCategory: 'BLG', installationTypeId: install, simpleDescription: { text: 'Урна для мусора.', partIds: [] } } } });
    const response = await http().post('/api/passports').set(auth()).send({ productId: String(f.productId), supplierOrgId: String(org), presentationVersion: 1, variant: 'short', creationKey: randomUUID() });
    expect({ status: response.status, error: response.body.message }).toEqual({ status: 201, error: undefined });
    const created = response.body;
    await http().post(`/api/passports/${created.id}/issue`).set(auth()).send({ presentationVersion: 1, variant: 'short' }).expect(200);
    const before = (await db().collection('productpassports').findOne({ _id: new Types.ObjectId(created.id) }))!;
    f.body.contextToken = await f.context();
    await f.apply().expect(200);
    const after = (await db().collection('productpassports').findOne({ _id: before._id }))!;
    expect(after).toMatchObject({ revision: 2, weight: 14, passportNumber: before.passportNumber });
    expect(after.revisions[0].data.printSnapshot).toEqual(before.printSnapshot);
    expect(after.printSnapshot.effectiveImages.map((i: { photoId: unknown }) => String(i.photoId))).toEqual(f.fresh.map(i => i.photoId));
    const pdf = await app.get(PassportPdfService).pdf(created.id, { readOnly: true, pack: 'passport' });
    expect(pdf.buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it.each(['attach', 'create'])('snapshot→%s race не оставляет успешный неполный импорт', async operation => {
    const f = await fixture();
    // Private seam разрешён координатором: останавливаем после настоящего snapshot-read.
    const service = app.get(PassportImportService) as unknown as { state: (...args: unknown[]) => Promise<unknown> };
    const original = service.state.bind(service);
    let reached!: () => void, release!: () => void, stopped = false;
    const started = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    jest.spyOn(service, 'state').mockImplementation(async (...args) => {
      const state = await original(...args);
      if (args[1] && !stopped) { stopped = true; reached(); await gate; }
      return state;
    });
    const importing = f.apply().then(r => r);
    let addedId: string | undefined;
    try {
      await started;
      if (operation === 'attach') {
        await http().post(`/api/products/${f.productId}/photos`).set(auth()).send({ purpose: 'passport', kind: 'overview', photoId: f.fresh[0].photoId }).expect(201);
      } else {
        const added = await http().post('/api/passports').set(auth()).send({ name: 'Новый конкурентный паспорт', productId: String(f.productId) }).expect(201);
        addedId = added.body.id;
      }
    } finally { release(); }
    const result = await importing;
    expect([200, 409]).toContain(result.status);
    if (result.status === 409) {
      expect((await db().collection('products').findOne({ _id: f.productId }))!.weightKg).toBe(12);
      expect((await db().collection('productpassports').findOne({ _id: f.passportId }))!.revision).toBe(1);
    } else {
      expect(result.body.status).toBe('applied');
      for (const kind of kinds) expect(await db().collection('productphotos').countDocuments({ productId: f.productId, purpose: 'passport', kind, deletedAt: null })).toBe(1);
      if (addedId) expect((await db().collection('productpassports').findOne({ _id: new Types.ObjectId(addedId) }))!.weight).toBe(14);
    }
  });
  it.each(['anchor', 'concrete'])('%s: третья схема реально передаётся в short/full PDF правильным видом', async code => {
    const f = await fixture();
    const install = (await db().collection('dict_values').insertOne({ dict: 'passportInstall', code, name: code, deletedAt: null })).insertedId;
    await db().collection('products').updateOne({ _id: f.productId }, { $set: { passportDefaults: { installationTypeId: install } } });
    await db().collection('productpassports').updateOne({ _id: f.passportId }, { $set: { installationTypeId: install, passportCategory: 'BLG', textSnapshot: { sections: [{ key: 'general', title: 'C172', paragraphs: ['Безопасность.'] }] }, images: [...f.old.map(i => ({ ...i, photoId: new Types.ObjectId(i.photoId) })), { kind: 'mounting', photoId: new Types.ObjectId(f.old[0].photoId) }] } });
    f.body.contextToken = await f.context();
    await f.apply().expect(200);
    const scheme = (await db().collection('photos').findOne({ _id: new Types.ObjectId(f.fresh[2].photoId) }))!;
    const expected = await readPassportImage(scheme.storageUrl);
    const render = jest.spyOn(renderer, 'renderPassportPdfV2');
    for (const variant of ['short', 'full'] as const) {
      const result = await app.get(PassportPdfService).pdf(String(f.passportId), { readOnly: true, pack: 'passport', variant });
      expect(result.buf.subarray(0, 5).toString()).toBe('%PDF-');
      const input = render.mock.calls.at(-1)![0];
      const kind = code === 'anchor' ? 'mounting' : 'foundation';
      expect(input.images[kind]?.[0]?.buf).toEqual(expected);
      if (code === 'anchor') expect(input.images.foundation).toBeUndefined();
      else expect(input.images.mounting).toHaveLength(1);
    }
  });
  it('черновик с прежним concrete читает новый anchor изделия без дубля схемы в PDF', async () => {
    const f = await fixture();
    const anchor = (await db().collection('dict_values').insertOne({ dict: 'passportInstall', code: 'anchor', name: 'Анкер', deletedAt: null })).insertedId;
    const concrete = (await db().collection('dict_values').insertOne({ dict: 'passportInstall', code: 'concrete', name: 'Бетон', deletedAt: null })).insertedId;
    for (const category of ['ALL_V2', 'BLG']) await db().collection('passporttemplates').updateOne({ category, version: 1 }, { $set: { isActive: true, sections: [{ key: 'general', title: 'Безопасность', paragraphs: ['Осмотр перед использованием.'] }], tables: [], deletedAt: null } }, { upsert: true });
    await db().collection('products').updateOne({ _id: f.productId }, { $set: { purpose: 'Отдых', passportDefaults: { installationTypeId: anchor, passportCategory: 'BLG', simpleDescription: { text: 'Урна для мусора.', partIds: [] } } } });
    await db().collection('productpassports').updateOne({ _id: f.passportId }, { $set: { status: 'draft', presentationVersion: 1, variant: 'short', manualText: [], installationTypeId: concrete, passportCategory: 'BLG', textSnapshot: { sections: [{ key: 'general', title: 'C172', paragraphs: ['Безопасность.'] }] } } });
    f.body.contextToken = await f.context();
    await f.apply().expect(200);
    const card = await http().get(`/api/passports/${f.passportId}`).set(auth()).expect(200);
    expect(String(card.body.installationTypeId)).toBe(String(anchor));
    const template = await http().get(`/api/showcase/${f.productId}/passport-template`).set(auth()).expect(200);
    expect(String(template.body.document.installationTypeId)).toBe(String(anchor));
    const render = jest.spyOn(renderer, 'renderPassportPdfV2');
    await app.get(PassportPdfService).pdf(String(f.passportId), { readOnly: false, pack: 'passport' });
    const input = render.mock.calls.at(-1)![0];
    expect(input.images.mounting).toHaveLength(1);
    expect(input.images.foundation).toBeUndefined();
  });
  it('anchor cleanup защищает каждый старый файл, дубли и own foundation вне productlinks', async () => {
    const f = await fixture(), extra = await images('#778899');
    const install = (await db().collection('dict_values').insertOne({ dict: 'passportInstall', code: 'anchor', name: 'Анкер', deletedAt: null })).insertedId;
    await db().collection('products').updateOne({ _id: f.productId }, { $set: { passportDefaults: { installationTypeId: install } } });
    const oldImages = [...f.old, ...extra].map(i => ({ ...i, photoId: new Types.ObjectId(i.photoId) }));
    await db().collection('productpassports').updateOne({ _id: f.passportId }, { $set: { installationTypeId: install, images: oldImages } });
    await db().collection('productphotos').insertMany(extra.slice(0, 2).map(i => ({ productId: f.productId, purpose: 'passport', kind: i.kind, photoId: new Types.ObjectId(i.photoId), deletedAt: null })));
    expect(await db().collection('productphotos').countDocuments({ productId: f.productId, photoId: new Types.ObjectId(extra[2].photoId) })).toBe(0);
    f.body.contextToken = await f.context();
    await f.apply().expect(200);
    const current = (await db().collection('productpassports').findOne({ _id: f.passportId }))!;
    expect(current.revisions[0].data.images).toEqual(oldImages);
    const historicalIds = [...f.old, ...extra].map(i => new Types.ObjectId(i.photoId));
    expect(await db().collection('photos').countDocuments({ _id: { $in: historicalIds }, deletedAt: null, sourceProtected: true })).toBe(historicalIds.length);
    for (const id of historicalIds) await http().delete(`/api/photos/${id}`).set(auth()).expect(409);
    expect(await db().collection('photos').countDocuments({ _id: { $in: historicalIds }, deletedAt: null, sourceProtected: true })).toBe(historicalIds.length);
    expect(current.images.filter((i: { kind: string }) => i.kind === 'foundation')).toHaveLength(0);
    for (const kind of ['overview', 'dimensions', 'mounting']) expect(await db().collection('productphotos').countDocuments({ productId: f.productId, purpose: 'passport', kind, deletedAt: null })).toBe(1);
  });
  it('legacy issue после readiness перечитывает свежую HTTP-связь рисунка в транзакции', async () => {
    const f = await fixture();
    const org = (await db().collection('organizations').insertOne({ name: 'C172 наша фирма race', isOurCompany: true, deletedAt: null })).insertedId;
    await db().collection('productpassports').updateOne({ _id: f.passportId }, { $set: { status: 'draft', passportNumber: `draft-${f.passportId}`, supplierOrgId: org, manualText: [], description: 'Урна для проверки гонки выпуска', materials: 'Сталь', purpose: 'Для отдыха', installationMethod: 'Установить на основание', category: 'Благоустройство', date: new Date('2026-11-21') } });
    const service = app.get(ProductPassportService), original = service.readiness.bind(service);
    let reached!: () => void, release!: () => void, stopped = false;
    const started = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    jest.spyOn(service, 'readiness').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (!args[1] && !stopped) { stopped = true; reached(); await gate; }
      return result;
    });
    const issuing = http().post(`/api/passports/${f.passportId}/issue`).set(auth()).then(r => r);
    try {
      await started;
      const old = (await db().collection('productphotos').findOne({ productId: f.productId, kind: 'overview', deletedAt: null }))!;
      await http().delete(`/api/products/${f.productId}/photos/${old._id}`).set(auth()).expect(204);
      await http().post(`/api/products/${f.productId}/photos`).set(auth()).send({ purpose: 'passport', kind: 'overview', photoId: f.fresh[0].photoId }).expect(201);
    } finally { release(); }
    const result = await issuing;
    expect({ status: result.status, error: result.body.message }).toEqual({ status: 200, error: undefined });
    const issued = (await db().collection('productpassports').findOne({ _id: f.passportId }))!;
    expect(issued.status).toBe('issued');
    expect(issued.images.filter((i: { kind: string }) => i.kind === 'overview').map((i: { photoId: unknown }) => String(i.photoId))).toEqual([f.fresh[0].photoId]);
  });
});
