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

describe('C178: название паспорта из изделия, ручное имя и история', () => {
  let ctx: TestContext, access: string, actorId: string;
  const firm = new Types.ObjectId(), install = new Types.ObjectId(), photo = new Types.ObjectId(), material = new Types.ObjectId();
  const file = `c178-name-${randomUUID()}.png`;
  const db = () => ctx.connection.db!;
  const http = () => request(ctx.app.getHttpServer());
  const auth = () => authHeader(access);
  const read = async (id: string) => db().collection('productpassports').findOne({ _id: new Types.ObjectId(id) });
  beforeAll(async () => {
    const name = process.env.MONGO_DB_TEST ?? 'datacore-test';
    const host = new URL(process.env.MONGO_URI ?? 'mongodb://localhost:27017/datacore-test').hostname;
    if (!/^datacore-test(?:-[a-z0-9-]+)?$/.test(name) || !['127.0.0.1', 'localhost'].includes(host)) throw Error('C178: только локальная test-БД');
    ctx = await createTestApp({ strictValidation: true });
    await ctx.connection.model('ProductPassport').init();
    const login = await loginAsAdmin(ctx.app); access = login.access; actorId = login.user.id;
    await db().collection('organizations').insertOne({ _id: firm, name: 'C178 Тестовая фирма', inn: '2310000178', isOurCompany: true, deletedAt: null });
    await db().collection('dict_values').insertMany([
      { dict: 'passportMaterials', _id: material, code: 'NAME_STEEL', name: 'Сталь', madeOf: 'стали', deletedAt: null },
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

  async function line() {
    const productId = (await db().collection('products').insertOne({ sku: 'NAME-' + randomUUID(), name: 'Имя карточки изделия', deletedAt: null,
      dimensions: { length: 500, width: 400, height: 450, unit: 'мм' }, weightKg: 25, purpose: 'Для отдыха.', materialsText: 'Материалы: сталь.',
      passportDefaults: { passportCategory: 'BLG', materialIds: [material], installationTypeId: install, serviceLifeYears: 5, joints: ['solid'], simpleDescription: { text: 'Описание изделия.', partIds: [] } },
    })).insertedId;
    await db().collection('productphotos').insertMany(['overview','dimensions'].map(kind => ({ productId, photoId: photo, kind, purpose: 'passport', sortOrder: 0, deletedAt: null })));
    const salesOrderId = (await db().collection('salesorders').insertOne({ orderNo: 'NAME-' + randomUUID(), companyId: firm, customer: 'Заказчик', stage: 'new', deletedAt: null })).insertedId;
    const incomeId = (await db().collection('incomes').insertOne({ orderId: salesOrderId, productId, title: 'Иное название строки договора', qty: 1, lineNo: 1, deletedAt: null })).insertedId;
    return { productId, salesOrderId, incomeId };
  }
  const body = (r: Awaited<ReturnType<typeof line>>, variant = 'short') => ({ productId: String(r.productId), salesOrderId: String(r.salesOrderId), incomeId: String(r.incomeId), supplierOrgId: String(firm), presentationVersion: 1, variant });
  it.each(['short','full'])('%s: create/GET/issue/PDF используют имя продукта, line title не становится own', async variant => {
    const r = await line();
    const created = (await http().post('/api/passports').set(auth()).send(body(r, variant)).expect(201)).body;
    expect(created.name).toBe('Имя карточки изделия');
    const stored = (await read(created.id))!;
    expect(stored.instanceManualText ?? []).not.toContain('name'); expect(stored.manualText ?? []).not.toContain('name');
    await db().collection('products').updateOne({ _id: r.productId }, { $set: { name: 'Обновлённое имя изделия' } });
    expect((await http().get('/api/passports/' + created.id).set(auth()).expect(200)).body.name).toBe('Обновлённое имя изделия');
    await http().post('/api/passports/' + created.id + '/issue').set(auth()).send({ presentationVersion: 1, variant }).expect(200);
    const issued = (await read(created.id))!; expect(issued.name).toBe('Обновлённое имя изделия');
    expect(String(issued.productId)).toBe(String(r.productId)); expect(String(issued.incomeId)).toBe(String(r.incomeId));
    const pdfs = ctx.app.get(PassportPdfService), render = jest.spyOn(pdfs as unknown as { render(row: Record<string, unknown>, opts: Record<string, unknown>): Promise<Buffer> }, 'render');
    try { expect((await pdfs.pdf(created.id, { readOnly: true })).buf.subarray(0,5).toString()).toBe('%PDF-'); expect(render.mock.calls.at(-1)![0].name).toBe(issued.name); } finally { render.mockRestore(); }
    await db().collection('products').updateOne({ _id: r.productId }, { $set: { name: 'Позднее изменение карточки' } });
    expect((await http().get('/api/passports/' + created.id).set(auth()).expect(200)).body.name).toBe(issued.name);
    expect((await db().collection('incomes').findOne({ _id: r.incomeId }))!.title).toBe('Иное название строки договора');
  });
  it('настоящее ручное имя bound draft сохраняется при GET/issue; issued PATCH даёт историю и старый PDF', async () => {
    const r = await line(), created = (await http().post('/api/passports').set(auth()).send(body(r)).expect(201)).body;
    await http().patch('/api/passports/' + created.id).set(auth()).send({ name: 'Ручное имя экземпляра', manualText: ['name'] }).expect(200);
    await db().collection('incomes').updateOne({ _id: r.incomeId }, { $set: { title: 'Новая строка договора' } });
    await db().collection('products').updateOne({ _id: r.productId }, { $set: { name: 'Новое имя карточки' } });
    expect((await http().get('/api/passports/' + created.id).set(auth()).expect(200)).body.name).toBe('Ручное имя экземпляра');
    await http().post('/api/passports/' + created.id + '/issue').set(auth()).send({ presentationVersion: 1, variant: 'short' }).expect(200);
    const before = (await read(created.id))!; expect(before.name).toBe('Ручное имя экземпляра');
    const user = new Types.ObjectId(); await db().collection('users').insertOne({ _id: user, username: 'name-reader', role: 'user', isActive: true, isOwner: false, passwordHash: 'unused' });
    const token = await ctx.app.get(JwtService).signAsync({ sub: String(user), username: 'name-reader', role: 'user' });
    await http().patch('/api/passports/' + created.id).set(authHeader(token)).send({ name: 'Запрещено' }).expect(403);
    await http().patch('/api/passports/' + created.id).set(auth()).send({ name: 'Осознанная новая редакция' }).expect(200);
    const after = (await read(created.id))!;
    expect(after).toMatchObject({ name: 'Осознанная новая редакция', passportNumber: before.passportNumber, revision: 2 });
    expect(after.revisions[0]).toMatchObject({ by: actorId, data: { name: before.name, printSnapshot: before.printSnapshot } });
    const pdfs = ctx.app.get(PassportPdfService), render = jest.spyOn(pdfs as unknown as { render(row: Record<string, unknown>, opts: Record<string, unknown>): Promise<Buffer> }, 'render');
    try {
      await pdfs.pdf(created.id, { readOnly: true }); expect(render.mock.calls.at(-1)![0].name).toBe(after.name);
      const previous = { ...after, ...after.revisions[0].data };
      expect((await (pdfs as unknown as { render(row: Record<string, unknown>, opts: Record<string, unknown>): Promise<Buffer> }).render(previous, {})).subarray(0,5).toString()).toBe('%PDF-');
      expect(render.mock.calls.at(-1)![0].name).toBe(before.name);
    } finally { render.mockRestore(); }
  });
  it.each([undefined, 1])('order batch version %s не передаёт line title как manualname', async presentationVersion => {
    const r = await line();
    const result = (await http().post('/api/passports/order/' + r.salesOrderId + '/issue').set(auth()).send({ ...(presentationVersion ? { presentationVersion, variant: 'short' } : {}) }).expect(200)).body;
    expect(result.counts).toEqual({ issued: 1, skipped: 0 });
    const passport = await db().collection('productpassports').findOne({ incomeId: r.incomeId });
    expect(passport!.name).toBe('Имя карточки изделия'); expect(passport!.manualText ?? []).not.toContain('name');
  });
  it('standalone без productId сохраняет штатное ручное название', async () => {
    const created = (await http().post('/api/passports').set(auth()).send({ name: 'Самостоятельный паспорт', supplierOrgId: String(firm) }).expect(201)).body;
    expect((await http().get('/api/passports/' + created.id).set(auth()).expect(200)).body.name).toBe('Самостоятельный паспорт');
  });
});
