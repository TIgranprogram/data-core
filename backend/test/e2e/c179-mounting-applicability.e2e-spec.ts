import * as renderer from '../../src/modules/product-passport/passport-pdf-v2';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { Types } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { uploadsRoot } from '../../src/common/uploads/safe-path';
import { PassportPdfService } from '../../src/modules/product-passport/passport-pdf.service';
import { ProductPassportService } from '../../src/modules/product-passport/product-passport.service';

describe('C179: редактор выданного экземпляра с историей', () => {
  let ctx: TestContext, access: string, actorId: string;
  const anchor = new Types.ObjectId();
  const firm = new Types.ObjectId(), install = new Types.ObjectId(), photo = new Types.ObjectId();
  const file = `c179-${randomUUID()}.png`;
  const db = () => ctx.connection.db!;
  const http = () => request(ctx.app.getHttpServer());
  const auth = () => authHeader(access);
  const read = async (id: string) => db().collection('productpassports').findOne({ _id: new Types.ObjectId(id) });
  async function make(status: 'draft' | 'issued' = 'issued') {
    const product = (await db().collection('products').insertOne({
      sku: `C179-${randomUUID()}`, name: 'C179 Исходное название', deletedAt: null,
      dimensions: { length: 500, width: 400, height: 450, unit: 'мм' }, weightKg: 25, purpose: 'Для кратковременного отдыха.',
      passportDefaults: { passportCategory: 'BLG', installationTypeId: install, simpleDescription: { text: 'Исходное краткое описание.', partIds: [] } },
    })).insertedId;
    await db().collection('productphotos').insertMany(['overview', 'dimensions', 'foundation', 'holes'].map(kind => ({ productId: product, photoId: photo, kind, purpose: 'passport', sortOrder: 0 })));
    const draft = (await http().post('/api/passports').set(auth()).send({ productId: String(product), presentationVersion: 1, variant: 'short', supplierOrgId: String(firm), creationKey: randomUUID() }).expect(201)).body;
    return status === 'draft' ? draft : (await http().post(`/api/passports/${draft.id}/issue`).set(auth()).send({ presentationVersion: 1, variant: 'short' }).expect(200)).body;
  }
  beforeAll(async () => {
    const name = process.env.MONGO_DB_TEST ?? 'datacore-test';
    const host = new URL(process.env.MONGO_URI ?? 'mongodb://localhost:27017/datacore-test').hostname;
    if (!/^datacore-test(?:-[a-z0-9-]+)?$/.test(name) || !['127.0.0.1', 'localhost'].includes(host)) throw Error('C179: только локальная test-БД');
    ctx = await createTestApp({ strictValidation: true });
    await ctx.connection.model('ProductPassport').init();
    const login = await loginAsAdmin(ctx.app); access = login.access; actorId = login.user.id;
    await db().collection('organizations').insertOne({ _id: firm, name: 'C179 Тестовая фирма', inn: '2310000178', isOurCompany: true, deletedAt: null });
    await db().collection('dict_values').insertMany([
      { dict: 'passportCategories', code: 'BLG', name: 'Благоустройство', serviceLifeYears: 5, warrantyMonths: 12, requiredImages: 'dimensions', deletedAt: null },
      { dict: 'passportInstall', _id: install, code: 'EMBEDDED', name: 'Закладные', montage: 'Монтаж на закладные детали.', deletedAt: null },
      { dict: 'passportInstall', _id: anchor, code: 'ANCHORS', name: 'Анкеры на бетон', montage: 'Закрепите анкерами на готовом основании.', traits: 'concrete,anchors', requiredImages: 'foundation\nholes', deletedAt: null },
    ]);
    await db().collection('passporttemplates').insertMany(['ALL_V2', 'BLG'].map(category => ({ category, version: 1, isActive: true, deletedAt: null,
      sections: [{ key: 'general', title: 'Безопасность', paragraphs: ['Исходное правило безопасности.'] }], tables: [],
    })));
    await fs.mkdir(uploadsRoot(), { recursive: true });
    await sharp({ create: { width: 30, height: 24, channels: 3, background: '#aabbcc' } }).png().toFile(join(uploadsRoot(), file));
    await db().collection('photos').insertOne({ _id: photo, storageUrl: '/uploads/' + file, mimeType: 'image/png', deletedAt: null });
  });
  afterAll(async () => { await ctx?.cleanup(); await fs.unlink(join(uploadsRoot(), file)).catch(() => undefined); });

  it('issued смена метода → missing схема → загрузка → ready; история и PDF согласованы', async () => {
    const issued = await make(), before = (await read(issued.id))!;
    await http().patch(`/api/passports/${issued.id}/snapshot-field`).set(auth()).send({ field: 'install', text: 'Старый собственный бетонный монтаж.' }).expect(200);
    const old = (await read(issued.id))!;
    const changed = (await http().patch(`/api/passports/${issued.id}`).set(auth()).send({ installationTypeId: String(anchor) }).expect(200)).body;
    const after = (await read(issued.id))!;
    expect(after).toMatchObject({ status: 'issued', passportNumber: before.passportNumber, revision: 3, installationTypeId: anchor });
    expect(after.textSnapshot.install.text).toContain('Закрепите анкерами');
    expect(after.textSnapshot.description).toBe(before.textSnapshot.description);
    expect(after.textSnapshot.traits).not.toContain('concrete');
    expect(after.printSnapshot.installationPlan).toMatchObject({ code: 'ANCHORS', requiredKinds: ['mounting'] });
    expect(after.printSnapshot.readiness.ready).toBe(false);
    expect(after.printSnapshot.readiness.missing.map((r: { key: string }) => r.key)).toEqual(['img_mounting']);
    expect(after.printSnapshot.effectiveImages.map((r: { kind: string }) => r.kind)).not.toContain('holes');
    expect(after.revisions.at(-1).data.textSnapshot).toEqual(old.textSnapshot);
    const card = (await http().get(`/api/passports/${issued.id}`).set(auth()).expect(200)).body;
    expect(card.installationPlan.code).toBe('ANCHORS'); expect(changed.status).toBe('issued');
    await expect(ctx.app.get(PassportPdfService).pdf(issued.id, { readOnly: true })).rejects.toThrow('обязательные рисунки');
    await http().patch(`/api/passports/${issued.id}`).set(auth()).send({ images: [...after.images, { kind: 'mounting', photoId: String(photo) }] }).expect(200);
    const ready = (await read(issued.id))!; expect(ready.revision).toBe(4); expect(ready.printSnapshot.readiness.ready).toBe(true);
    expect((await ctx.app.get(PassportPdfService).pdf(issued.id, { readOnly: true })).buf.subarray(0,5).toString()).toBe('%PDF-');
    const historical = { ...old, printSnapshot: before.printSnapshot };
    expect((await (ctx.app.get(PassportPdfService) as unknown as { render(row: Record<string, unknown>, opts: Record<string, unknown>): Promise<Buffer> }).render(historical, {})).subarray(0,5).toString()).toBe('%PDF-');
  });
  it('legacy issued без plan: CAD меняет managed policy целиком, история/PDF и повтор сохранены', async () => {
    const issued = await make(), original = (await read(issued.id))!;
    await db().collection('products').updateOne({ _id: original.productId }, { $set: { 'passportDefaults.installationTypeId': anchor } });
    const oldImages = [...original.images.filter((r: { kind: string }) => r.kind !== 'holes'), { kind: 'holes', photoId: photo, order: 8 }];
    const legacy = { ...original.printSnapshot, install: 'anchor', effectiveImages: oldImages.map(r => ({ ...r, url: original.printSnapshot.photoUrls[String(r.photoId)] })), readiness: { ...original.printSnapshot.readiness, requiredImages: ['overview','dimensions','foundation','holes'], imageSlots: ['overview','dimensions','foundation','holes','assembly'], ready: true } };
    delete legacy.installationPlan; delete legacy.readiness.installationPlan;
    await db().collection('productpassports').updateOne({ _id: original._id }, { $set: { installationTypeId: anchor, images: oldImages, printSnapshot: legacy } });
    const before = (await read(issued.id))!, pdfs = ctx.app.get(PassportPdfService), render = jest.spyOn(renderer, 'renderPassportPdfV2');
    try {
      await pdfs.pdf(issued.id, { readOnly: true });
      expect(render.mock.calls.at(-1)![0].images.holes).toHaveLength(1);
      const url = '/api/products/' + original.productId + '/passport-import';
      const token = (await http().get(url + '-context').set(auth()).expect(200)).body.contextToken;
      const body = { contextToken: token, images: ['overview','dimensions','foundation'].map(kind => ({ kind, photoId: String(photo) })), confirmed: {} };
      await http().post(url).set(auth()).send(body).expect(200);
      const after = (await read(issued.id))!;
      expect(after.passportNumber).toBe(before.passportNumber); expect(after.revision).toBe(2);
      expect(after.textSnapshot).toEqual(before.textSnapshot);
      expect(after.printSnapshot.installationPlan.code).toBe('ANCHORS');
      expect(after.printSnapshot.readiness).toMatchObject({ ready: true, requiredImages: ['overview','dimensions','mounting'] });
      expect(after.printSnapshot.readiness.imageSlots).toContain('assembly');
      expect(after.printSnapshot.readiness.imageSlots).not.toContain('holes');
      expect(after.revisions[0].data.printSnapshot).toEqual(before.printSnapshot);
      await pdfs.pdf(issued.id, { readOnly: true });
      expect(render.mock.calls.at(-1)![0].images.mounting).toHaveLength(1);
      expect(render.mock.calls.at(-1)![0].images.holes).toBeUndefined();
      expect(render.mock.calls.at(-1)![0].images.foundation).toBeUndefined();
      await (pdfs as unknown as { render(row: Record<string, unknown>, opts: Record<string, unknown>): Promise<Buffer> }).render({ ...after, ...after.revisions[0].data }, {});
      expect(render.mock.calls.at(-1)![0].images.holes).toHaveLength(1);
      await http().post(url).set(auth()).send(body).expect(200);
      expect((await read(issued.id))!.revision).toBe(2);
      await db().collection('productpassports').updateOne({ _id: original._id }, { $set: { note: 'Конкурентная правка' } });
      const stable = (await read(issued.id))!, product = await db().collection('products').findOne({ _id: original.productId });
      await http().post(url).set(auth()).send({ ...body, confirmed: { weightKg: 99 } }).expect(409);
      expect(await read(issued.id)).toEqual(stable);
      expect(await db().collection('products').findOne({ _id: original.productId })).toEqual(product);
    } finally { render.mockRestore(); }
  });
  it('новая image-only редакция unknown не становится ready из frozen текста', async () => {
    const issued = await make(), before = (await read(issued.id))!;
    const unknown = new Types.ObjectId();
    await db().collection('dict_values').insertOne({ _id: unknown, dict: 'passportInstall', code: 'FUTURE_C179', deletedAt: null });
    const legacy = { ...before.printSnapshot }; delete legacy.installationPlan;
    await db().collection('productpassports').updateOne({ _id: before._id }, { $set: { installationTypeId: unknown, printSnapshot: legacy } });
    const stable = await read(issued.id);
    await http().patch('/api/passports/' + issued.id).set(auth()).send({ images: before.images.map((r: { kind: string; photoId: unknown }) => ({ kind: r.kind, photoId: String(r.photoId), caption: 'Изменённый рисунок' })) }).expect(400);
    expect(await read(issued.id)).toEqual(stable);
  });

});
