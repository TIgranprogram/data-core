import request from 'supertest';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { uploadsRoot } from '../../src/common/uploads/safe-path';

describe('C173: две строки одного заказа и две редакции каждого паспорта', () => {
  let ctx: TestContext, access: string;
  const firm = new Types.ObjectId(), install = new Types.ObjectId(), photo = new Types.ObjectId(), material = new Types.ObjectId();
  const file = `C173-name-${randomUUID()}.png`;
  const db = () => ctx.connection.db!;
  const http = () => request(ctx.app.getHttpServer());
  const auth = () => authHeader(access);
  const read = async (id: string) => db().collection('productpassports').findOne({ _id: new Types.ObjectId(id) });
  beforeAll(async () => {
    const name = process.env.MONGO_DB_TEST ?? 'datacore-test';
    const host = new URL(process.env.MONGO_URI ?? 'mongodb://localhost:27017/datacore-test').hostname;
    if (name !== 'datacore-test-c173' || host !== '127.0.0.1' || !process.env.C173_EVIDENCE || !process.env.UPLOAD_DIR) throw Error('C173: нужны выделенные локальные ресурсы');
    ctx = await createTestApp({ strictValidation: true });
    await ctx.connection.model('ProductPassport').init();
    access = (await loginAsAdmin(ctx.app)).access;
    await db().collection('organizations').insertOne({ _id: firm, name: 'C173 Тестовая фирма', inn: '2310000178', isOurCompany: true, deletedAt: null });
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
  it('short/full: шаблон → позиция → повтор создания и выпуска → PDF → история', async () => {
    const first = await line();
    const second = { ...first, incomeId: (await db().collection('incomes').insertOne({
      orderId: first.salesOrderId, productId: first.productId, title: 'Вторая строка договора', qty: 1, lineNo: 2, deletedAt: null,
    })).insertedId };
    const rows = db().collection('productpassports');
    const counters = () => db().collection('counters').find().sort({ _id: 1 }).toArray();
    const baseline = await counters();
    const ids = new Set<string>();
    const numbers = new Set<string>();
    const evidence: Record<string, unknown>[] = [];
    for (const variant of ['short', 'full']) {
      await http().get('/api/showcase/' + first.productId + '/passport-template').set(auth()).query({ variant }).expect(200);
      await http().post('/api/passports/preview').set(auth()).send({ productId: String(first.productId), presentationVersion: 1, variant, pack: 'passport', mode: 'pages' }).expect(201).expect('Content-Type', /pdf/);
    }
    expect(await rows.countDocuments()).toBe(0);
    expect(await counters()).toEqual(baseline);
    for (const [variant, position] of [['short', first], ['full', second]] as const) {
      const make = () => http().post('/api/passports').set(auth()).send(body(position, variant)).expect(201);
      const beforeCreate = await counters();
      const draft = (await make()).body;
      expect((await make()).body.id).toBe(draft.id);
      ids.add(draft.id);
      expect(draft.status).toBe('draft');
      expect(draft.passportNumber).toMatch(/^draft-/);
      expect(await counters()).toEqual(beforeCreate);
      const card = '/api/passports/' + draft.id;
      const issue = () => http().post(card + '/issue').set(auth()).send({ presentationVersion: 1, variant }).expect(200);
      const issued = (await issue()).body;
      expect(issued.passportNumber).toMatch(/^\d+$/);
      expect(issued.warrantyCode).toMatch(new RegExp('-' + issued.passportNumber + '$'));
      expect(issued).toMatchObject({ status: 'issued', variant, productId: String(first.productId), salesOrderId: String(first.salesOrderId), incomeId: String(position.incomeId) });
      numbers.add(issued.passportNumber);
      const priorCounters = await counters();
      expect((await issue()).body).toMatchObject({ id: draft.id, passportNumber: issued.passportNumber, warrantyCode: issued.warrantyCode });
      expect(await counters()).toEqual(priorCounters);
      const pdf = async (suffix: string) => {
        const result = await http().get(card + '/pdf').set(auth()).query({ mode: 'pages', readOnly: '1' }).buffer(true).parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        }).expect(200).expect('Content-Type', /pdf/);
        expect(result.body.subarray(0, 5).toString()).toBe('%PDF-');
        await fs.writeFile(join(process.env.C173_EVIDENCE!, variant + '-' + suffix + '.pdf'), result.body);
      };
      await pdf('r1');
      const original = (await read(draft.id))!;
      const name = variant === 'short' ? 'Редакция короткого паспорта' : 'Редакция полного паспорта';
      await http().patch(card).set(auth()).send({ name }).expect(200);
      const revised = (await http().get(card).set(auth()).expect(200)).body;
      expect(revised).toMatchObject({ name, revision: 2, passportNumber: issued.passportNumber, warrantyCode: issued.warrantyCode });
      const stored = (await read(draft.id))!;
      expect(stored.revisions).toHaveLength(1);
      expect(stored.revisions[0].data).toMatchObject({ name: original.name, printSnapshot: original.printSnapshot, textSnapshot: original.textSnapshot });
      await pdf('r2');
      expect(await counters()).toEqual(priorCounters);
      evidence.push({ variant, id: draft.id, orderId: issued.salesOrderId, incomeId: issued.incomeId, productId: issued.productId, passportNumber: issued.passportNumber, warrantyCode: issued.warrantyCode, revision: revised.revision, historyLength: stored.revisions.length, previousName: original.name, name });
    }
    expect(ids.size).toBe(2);
    expect(numbers.size).toBe(2);
    expect(await rows.countDocuments()).toBe(2);
    await fs.writeFile(join(process.env.C173_EVIDENCE!, 'trace.json'), JSON.stringify(evidence, null, 2) + '\n');
  });
});
