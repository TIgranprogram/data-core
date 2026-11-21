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

describe('C178: редактор выданного экземпляра с историей', () => {
  let ctx: TestContext, access: string, actorId: string;
  const firm = new Types.ObjectId(), install = new Types.ObjectId(), photo = new Types.ObjectId();
  const file = `c178-${randomUUID()}.png`;
  const db = () => ctx.connection.db!;
  const http = () => request(ctx.app.getHttpServer());
  const auth = () => authHeader(access);
  const read = async (id: string) => db().collection('productpassports').findOne({ _id: new Types.ObjectId(id) });
  async function make(status: 'draft' | 'issued' = 'issued') {
    const product = (await db().collection('products').insertOne({
      sku: `C178-${randomUUID()}`, name: 'C178 Исходное название', deletedAt: null,
      dimensions: { length: 500, width: 400, height: 450, unit: 'мм' }, weightKg: 25, purpose: 'Для кратковременного отдыха.',
      passportDefaults: { passportCategory: 'BLG', installationTypeId: install, simpleDescription: { text: 'Исходное краткое описание.', partIds: [] } },
    })).insertedId;
    await db().collection('productphotos').insertMany(['overview', 'dimensions'].map(kind => ({ productId: product, photoId: photo, kind, purpose: 'passport', sortOrder: 0 })));
    const draft = (await http().post('/api/passports').set(auth()).send({ productId: String(product), presentationVersion: 1, variant: 'short', supplierOrgId: String(firm), creationKey: randomUUID() }).expect(201)).body;
    return status === 'draft' ? draft : (await http().post(`/api/passports/${draft.id}/issue`).set(auth()).send({ presentationVersion: 1, variant: 'short' }).expect(200)).body;
  }
  beforeAll(async () => {
    const name = process.env.MONGO_DB_TEST ?? 'datacore-test';
    const host = new URL(process.env.MONGO_URI ?? 'mongodb://localhost:27017/datacore-test').hostname;
    if (!/^datacore-test(?:-[a-z0-9-]+)?$/.test(name) || !['127.0.0.1', 'localhost'].includes(host)) throw Error('C178: только локальная test-БД');
    ctx = await createTestApp({ strictValidation: true });
    await ctx.connection.model('ProductPassport').init();
    const login = await loginAsAdmin(ctx.app); access = login.access; actorId = login.user.id;
    await db().collection('organizations').insertOne({ _id: firm, name: 'C178 Тестовая фирма', inn: '2310000178', isOurCompany: true, deletedAt: null });
    await db().collection('dict_values').insertMany([
      { dict: 'passportCategories', code: 'BLG', name: 'Благоустройство', serviceLifeYears: 5, warrantyMonths: 12, requiredImages: 'mounting', deletedAt: null },
      { dict: 'passportInstall', _id: install, code: 'anchor', name: 'Анкерное крепление', schemesMounting: [photo], deletedAt: null },
    ]);
    await db().collection('passporttemplates').insertMany(['ALL_V2', 'BLG'].map(category => ({ category, version: 1, isActive: true, deletedAt: null,
      sections: [{ key: 'general', title: 'Безопасность', paragraphs: ['Исходное правило безопасности.'] }], tables: [],
    })));
    await fs.mkdir(uploadsRoot(), { recursive: true });
    await sharp({ create: { width: 30, height: 24, channels: 3, background: '#aabbcc' } }).png().toFile(join(uploadsRoot(), file));
    await db().collection('photos').insertOne({ _id: photo, storageUrl: '/uploads/' + file, mimeType: 'image/png', deletedAt: null });
  });
  afterAll(async () => { await ctx?.cleanup(); await fs.unlink(join(uploadsRoot(), file)).catch(() => undefined); });

  it('issued short description: одна редакция, старый print/text в истории, новый PDF использует новый текст', async () => {
    const issued = await make(), before = (await read(issued.id))!;
    const pdfs = ctx.module.get(PassportPdfService);
    const render = jest.spyOn(pdfs as unknown as { render(row: Record<string, unknown>, opts: Record<string, unknown>): Promise<Buffer> }, 'render');
    try {
      await http().patch(`/api/passports/${issued.id}/snapshot-field`).set(auth()).send({ field: 'description', text: 'C178 Новое описание только этого экземпляра.' }).expect(200);
      const after = (await read(issued.id))!;
      expect(after).toMatchObject({ status: 'issued', passportNumber: before.passportNumber, productCode: before.productCode, warrantyCode: before.warrantyCode, revision: 2,
        simpleDescription: { text: 'C178 Новое описание только этого экземпляра.' }, textSnapshot: { description: 'C178 Новое описание только этого экземпляра.', src: { description: 'manual' }, simpleDescriptionSource: { kind: 'own' } } });
      expect(after.printSnapshot).toEqual(before.printSnapshot); expect(after.images).toEqual(before.images);
      expect(after.revisions).toHaveLength(1);
      expect(after.revisions[0]).toMatchObject({ revision: 1, by: actorId, data: { name: before.name, textSnapshot: before.textSnapshot, printSnapshot: before.printSnapshot, images: before.images } });
      expect(after.revisions[0].data.revisions).toBeUndefined();
      const pdf = await pdfs.pdf(issued.id, { readOnly: true }); expect(pdf.buf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(render.mock.calls.at(-1)![0]).toMatchObject({ textSnapshot: { description: 'C178 Новое описание только этого экземпляра.' } });
      // toObject() рендера минимизирует пустую assets-карту; непустые URL и весь остальной frozen context обязаны совпасть.
      const usedPrint = render.mock.calls.at(-1)![0].printSnapshot as Record<string, unknown>;
      expect({ ...usedPrint, assets: usedPrint.assets ?? {} }).toEqual({ ...before.printSnapshot, assets: before.printSnapshot.assets ?? {} });
      const oldProjection = { ...after, ...after.revisions[0].data };
      const historical = await (pdfs as unknown as { render(row: Record<string, unknown>, opts: Record<string, unknown>): Promise<Buffer> }).render(oldProjection, {});
      expect(historical.subarray(0, 5).toString()).toBe('%PDF-');
      expect(render.mock.calls.at(-1)![0].textSnapshot).toEqual(before.textSnapshot);
      const stable = await read(issued.id);
      await http().patch(`/api/passports/${issued.id}/snapshot-field`).set(auth()).send({ field: 'description', text: 'C178 Новое описание только этого экземпляра.' }).expect(200);
      expect(await read(issued.id)).toEqual(stable);
    } finally { render.mockRestore(); }
  });

  it('snapshot-item сохраняет старую проекцию и samevalue не создаёт следующую редакцию', async () => {
    const issued = await make(), before = (await read(issued.id))!;
    const section = before.textSnapshot.sections.find((s: { items: unknown[] }) => s.items.length), item = section.items[0];
    const body = { sectionKey: section.key, itemKey: item.key, text: 'C178 Собственный пункт безопасности.' };
    await http().patch(`/api/passports/${issued.id}/snapshot-item`).set(auth()).send(body).expect(200);
    const after = (await read(issued.id))!;
    expect(after.revision).toBe(2); expect(after.revisions[0].data.textSnapshot).toEqual(before.textSnapshot);
    expect(after.textSnapshot.sections.find((s: { key: string }) => s.key === section.key).items[0].text).toBe(body.text);
    await http().patch(`/api/passports/${issued.id}/snapshot-item`).set(auth()).send(body).expect(200);
    expect(await read(issued.id)).toEqual(after);
  });

  it('параллельные snapshot edits дают один CASwinner и 409 без потери истории', async () => {
    const issued = await make();
    const service = ctx.module.get(ProductPassportService);
    const original = service.findById.bind(service);
    let arrivals = 0, release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
    const spy = jest.spyOn(service, 'findById').mockImplementation(async id => {
      const doc = await original(id); if (id === issued.id && arrivals < 2) { arrivals++; if (arrivals === 2) release(); await barrier; } return doc;
    });
    try {
      const responses = await Promise.all(['А', 'Б'].map(text => http().patch(`/api/passports/${issued.id}/snapshot-field`).set(auth()).send({ field: 'purpose', text: 'C178 Правка ' + text })));
      expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
      const after = (await read(issued.id))!; expect(after.revision).toBe(2); expect(after.revisions).toHaveLength(1);
    } finally { spy.mockRestore(); }
  });

  it('ordinary name edit сохраняет номер/issued, печатает новое имя; старое остаётся в истории', async () => {
    const issued = await make(), before = (await read(issued.id))!;
    await http().patch(`/api/passports/${issued.id}`).set(auth()).send({ name: 'C178 Исправленное название' }).expect(200);
    const after = (await read(issued.id))!;
    expect(after).toMatchObject({ name: 'C178 Исправленное название', status: 'issued', revision: 2, passportNumber: before.passportNumber });
    expect(after.revisions[0].data.name).toBe(before.name);
    const pdfs = ctx.module.get(PassportPdfService);
    const render = jest.spyOn(pdfs as unknown as { render(row: Record<string, unknown>, opts: Record<string, unknown>): Promise<Buffer> }, 'render');
    try { const pdf = await pdfs.pdf(issued.id, { readOnly: true }); expect(pdf.buf.subarray(0, 5).toString()).toBe('%PDF-'); expect(render.mock.calls.at(-1)![0].name).toBe('C178 Исправленное название'); }
    finally { render.mockRestore(); }
  });

  it('promote-to-source не меняет текст, редакцию или печатный снимок самого экземпляра', async () => {
    const issued = await make(), before = (await read(issued.id))!;
    const productId = String(before.productId);
    const product = (await db().collection('products').findOne({ _id: before.productId }))!;
    await db().collection('productpassports').updateOne({ _id: before._id }, { $set: {
      'textSnapshot.purpose': product.purpose,
      'textSnapshot.refs.purpose': { kind: 'product', id: productId, field: 'purpose' },
    } });
    const stable = await read(issued.id);
    await http().post(`/api/passports/${issued.id}/snapshot-field/promote`).set(auth()).send({ field: 'purpose', text: 'C178 Новое назначение источника.' }).expect(200);
    expect((await db().collection('products').findOne({ _id: before.productId }))?.purpose).toBe('C178 Новое назначение источника.');
    expect(await read(issued.id)).toEqual(stable);
  });

  it('draft/annulled и readonly/privileged numbers сохраняют прежние границы', async () => {
    const draft = await make('draft');
    await http().patch(`/api/passports/${draft.id}/snapshot-field`).set(auth()).send({ field: 'description', text: 'Не здесь' }).expect(409);
    await http().patch(`/api/passports/${draft.id}/snapshot-field`).set(auth()).send({ field: 'purpose', text: 'C178 Черновик' }).expect(200);
    expect((await read(draft.id))?.revisions).toBeUndefined();
    const issued = await make(); await db().collection('productpassports').updateOne({ _id: new Types.ObjectId(issued.id) }, { $set: { status: 'annulled' } });
    const stable = await read(issued.id);
    await http().patch(`/api/passports/${issued.id}/snapshot-field`).set(auth()).send({ field: 'purpose', text: 'Нельзя' }).expect(409); expect(await read(issued.id)).toEqual(stable);
    const live = await make();
    await http().patch(`/api/passports/${live.id}`).set(auth()).send({ passportNumber: '987654321' }).expect(409);
    for (const role of ['user', 'manager']) {
      const id = new Types.ObjectId(); await db().collection('users').insertOne({ _id: id, username: `c178-${role}`, role, isActive: true, isOwner: false, passwordHash: 'unused' });
      const accessToken = await ctx.module.get(JwtService).signAsync({ sub: String(id), username: `c178-${role}`, role, version: 0 }, { secret: process.env.JWT_SECRET });
      await http().patch(`/api/passports/${live.id}/snapshot-field`).set(authHeader(accessToken)).send({ field: 'purpose', text: 'Прямой доступ' }).expect(role === 'user' ? 403 : 200);
      if (role === 'manager') await http().patch(`/api/passports/${live.id}`).set(authHeader(accessToken)).send({ passportNumber: '987654321', confirmNumbers: true }).expect(403);
    }
  });
});
