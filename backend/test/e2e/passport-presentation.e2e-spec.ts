import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Types } from 'mongoose';
import sharp from 'sharp';
import request from 'supertest';
import { uploadsRoot } from '../../src/common/uploads/safe-path';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { createTestApp, type TestContext } from '../setup/test-db';

describe('C155. Шаблон и новые паспорта', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: string;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token);
  const our = new Types.ObjectId(), second = new Types.ObjectId(), outside = new Types.ObjectId();
  const part = new Types.ObjectId(), install = new Types.ObjectId(), photo = new Types.ObjectId();
  const phraseRoot = new Types.ObjectId();
  const file = `c155-e2e-${photo}.png`;
  const path = () => join(uploadsRoot(), file);
  const products = () => db().collection('products');
  const passports = () => db().collection('productpassports');
  const templateUrl = (p: Types.ObjectId) => `/api/showcase/${p}/passport-template`;
  const shortDescription = { text: 'Две опоры и сиденье.', partIds: [] };
  const makeProduct = async (extra: Record<string, unknown> = {}) => (await products().insertOne({
    name: 'Скамья для проверки', sku: `C155-${randomUUID()}`, deletedAt: null,
    dimensions: { length: 500, width: 400, height: 450, unit: 'мм' }, weightKg: 25,
    purpose: 'Для кратковременного отдыха.',
    passportDefaults: {
      passportCategory: 'BLG', installationTypeId: install,
      simpleDescription: shortDescription,
    },
    ...extra,
  })).insertedId;

  beforeAll(async () => {
    // Общий харнесс очищает только отдельную тестовую БД.
    if (process.env.MONGO_DB_TEST && process.env.MONGO_DB_TEST !== 'datacore-test') throw new Error('C155 требует datacore-test');
    ctx = await createTestApp();
    app = ctx.app;
    token = (await loginAsAdmin(app)).access;
    await passports().createIndex({ creationScopeKey: 1 }, { name: 'creationScopeKey_1', unique: true, sparse: true });
    await db().collection('organizations').insertMany([
      { _id: our, inn: '2310000155', name: 'Наша фирма 1', isOurCompany: true, deletedAt: null },
      { _id: second, inn: '2310000156', name: 'Наша фирма 2', isOurCompany: true, deletedAt: null },
      { _id: outside, inn: '2310000157', name: 'Поставщик', isOurCompany: false, deletedAt: null },
    ]);
    await db().collection('dict_values').insertMany([
      { dict: 'passportCategories', code: 'BLG', name: 'Благоустройство', serviceLifeYears: 5, warrantyMonths: 12, requiredImages: 'mounting', deletedAt: null },
      { dict: 'passportInstall', _id: install, code: 'anchor', name: 'Анкерное крепление', schemesMounting: [photo], deletedAt: null },
      { dict: 'passportParts', _id: part, name: 'Опора', genPlural: 'опор', genSingular: 'опоры', deletedAt: null },
      { dict: 'passportPhrases', _id: phraseRoot, name: 'Краткое описание', section: 'simple-description', deletedAt: null },
      { dict: 'passportPhrases', parentId: phraseRoot, name: 'Вариант описания', section: 'simple-description', text: 'Состоит из {parts}.', partIds: [part], allCategories: true, deletedAt: null },
    ]);
    const section = { key: 'general', title: 'Правила безопасности', paragraphs: ['Прекратить использование при повреждении.'] };
    await db().collection('passporttemplates').insertMany(['ALL_V2', 'BLG'].map((category) => ({
      category, version: 1, isActive: true, deletedAt: null, sections: [section], tables: [],
    })));
    await fs.mkdir(uploadsRoot(), { recursive: true });
    await sharp({ create: { width: 30, height: 24, channels: 3, background: '#aabbcc' } }).png().toFile(path());
    await db().collection('photos').insertOne({ _id: photo, storageUrl: '/uploads/' + file, mimeType: 'image/png', deletedAt: null });
  });

  afterAll(async () => {
    await ctx?.cleanup();
    await fs.unlink(path()).catch(() => undefined);
  });

  it('GET строит проекцию без паспорта и CAS сохраняет независимые поля, явный null и старый PUT', async () => {
    const p = await makeProduct({ passportDefaults: null });
    const initial = await passports().countDocuments();
    const empty = (await http().get(templateUrl(p)).set(auth()).expect(200)).body;
    expect(empty).toMatchObject({ mode: 'template', productId: String(p), defaults: {}, textSnapshot: null, passportCategory: null, presentationVersion: 1, variant: 'short' });
    for (const key of ['id', '_id', 'passportNumber', 'supplierOrgId', 'salesOrderId']) expect(empty.document).not.toHaveProperty(key);
    expect(empty.readiness.missing).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'category' })]));
    const accepted = { text: shortDescription.text, partIds: [String(part), String(part)] };
    const patch = (changes: Record<string, unknown>, expected: Record<string, unknown>) => http().patch(templateUrl(p)).set(auth()).send({ changes, expected });
    const save = await Promise.all([
      patch({ simpleDescription: accepted }, { simpleDescription: null }),
      patch({ passportCategory: 'BLG', manualPurpose: 'Своя цель.' }, { passportCategory: null, manualPurpose: null }),
    ]);
    expect(save.map((s) => s.status)).toEqual([200, 200]);
    await patch({ manualPurpose: 'Другая цель.' }, { manualPurpose: null }).expect(409);
    await patch({ installationTypeId: '$unset' }, { installationTypeId: null }).expect(400);
    await patch({ simpleDescription: { text: 'Другое изделие.', partIds: [String(outside)] } }, { simpleDescription: { ...shortDescription, partIds: [String(part)] } }).expect(400);
    await http().put(`/api/showcase/${p}/passport-defaults`).set(auth()).send({}).expect(200);
    const final = (await http().get(templateUrl(p)).set(auth()).expect(200)).body;
    expect(final.defaults).toEqual({ simpleDescription: { ...shortDescription, partIds: [String(part)] }, manualPurpose: 'Своя цель.' });
    expect(await passports().countDocuments()).toBe(initial);

    for (const before of [undefined, null, { simpleDescription: shortDescription }]) {
      const product = await makeProduct({ passportDefaults: before });
      if (before === undefined) await products().updateOne({ _id: product }, { $unset: { passportDefaults: '' } });
      await http().patch(`/api/showcase/${product}`).set(auth()).send({ foundationDepth: 145 }).expect(200);
      expect((await products().findOne({ _id: product }))?.passportDefaults).toEqual({ ...before, foundationDepth: 145 });
    }
  });

  it('совпадают шаблон и check, испорченная обязательная картинка блокирует выпуск без номера', async () => {
    const p = await makeProduct();
    const bad = (await db().collection('photos').insertOne({ storageUrl: '/uploads/c155-test-missing.png', deletedAt: null })).insertedId;
    await db().collection('productphotos').insertOne({ productId: p, purpose: 'passport', kind: 'overview', photoId: bad, deletedAt: null });
    const short = (await http().get(templateUrl(p)).set(auth()).expect(200)).body;
    const check = (await http().post('/api/passports/check').set(auth()).send({ productId: String(p), presentationVersion: 1, variant: 'short', mode: 'template' }).expect(200)).body;
    expect(check.missing).toEqual(short.readiness.missing);
    expect(check.missing).toEqual([expect.objectContaining({ key: 'img_overview', label: expect.stringContaining('повреждён') })]);
    expect(short.standardImages).toMatchObject([{ kind: 'mounting', photoId: String(photo) }]);
    expect(short.simpleDescriptionSuggestions).toMatchObject([{ name: 'Вариант описания' }]);
    const full = (await http().get(templateUrl(p)).query({ variant: 'full' }).set(auth()).expect(200)).body;
    expect(full.readiness.missing).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'materials' })]));
    const create = { presentationVersion: 1, productId: String(p), supplierOrgId: String(our), creationKey: randomUUID() };
    const draft = (await http().post('/api/passports').set(auth()).send(create).expect(201)).body;
    const checked = (await http().post('/api/passports/check').set(auth()).send({ passportId: draft.id, mode: 'instance' }).expect(200)).body;
    expect(checked.missing).toEqual(check.missing);
    const counters = await db().collection('counters').find().toArray();
    const issue = await http().post(`/api/passports/${draft.id}/issue`).set(auth()).send({ presentationVersion: 1, variant: 'short' }).expect(400);
    expect(issue.body.missing).toEqual(check.missing);
    expect(await db().collection('counters').find().toArray()).toEqual(counters);
  });

  it('описание само поступает из применимой фразы, а ссылка на часть защищена', async () => {
    const p = await makeProduct({ passportDefaults: { passportCategory: 'BLG', installationTypeId: install } });
    await db().collection('productphotos').insertOne({ productId: p, purpose: 'passport', kind: 'overview', photoId: photo, deletedAt: null });
    const template = (await http().get(templateUrl(p)).set(auth()).expect(200)).body;
    expect(template.defaults).not.toHaveProperty('simpleDescription');
    expect(template.readiness.ready).toBe(true);
    expect(template).toMatchObject({ simpleDescriptionSource: { kind: 'dictionary', rootId: String(phraseRoot), partIds: [String(part)] }, textSnapshot: { description: 'Состоит из опор.' } });
    await http().delete(`/api/dicts/passportParts/${part}`).set(auth()).expect(409);
  });

  it('архивное открытие и PDF прежнего черновика оставляют сохранённую запись без изменений', async () => {
    const p = await makeProduct();
    const legacy = {
      productId: p, name: 'Сохранённое имя', weight: 99, status: 'draft', passportCategory: 'BLG',
      passportNumber: 'draft-legacy-c155', images: [{ kind: 'overview', photoId: photo }], deletedAt: null,
    };
    const { insertedId } = await passports().insertOne(legacy);
    const url = `/api/passports/${insertedId}`;
    const card = (await http().get(url).query({ readOnly: 1 }).set(auth()).expect(200)).body;
    expect(card).toMatchObject({ name: legacy.name, weight: legacy.weight });
    expect(card).not.toHaveProperty('presentationVersion');
    expect(card.textSnapshot.sections[0].title).toBe('Правила безопасности');
    await http().get(url + '/pdf').query({ readOnly: 1 }).set(auth()).expect(200).expect('Content-Type', /pdf/);
    expect(await passports().findOne({ _id: insertedId })).toEqual({ ...legacy, _id: insertedId });
  });

  it('черновик и выпуск получают свежий ручной текст шаблона, собственное назначение остаётся у экземпляра', async () => {
    const p = await makeProduct({ passportDefaults: {
      passportCategory: 'BLG', installationTypeId: install, simpleDescription: shortDescription,
      manualPurpose: 'Назначение А.', manualInstall: 'Монтаж А.',
    } });
    await db().collection('productphotos').insertOne({ productId: p, purpose: 'passport', kind: 'overview', photoId: photo, deletedAt: null });
    const created = (await http().post('/api/passports').set(auth()).send({
      productId: String(p), presentationVersion: 1, supplierOrgId: String(our), creationKey: randomUUID(),
    }).expect(201)).body;
    expect(created.textSnapshot).toMatchObject({ purpose: 'Назначение А.', install: { text: 'Монтаж А.' } });
    const url = `/api/passports/${created.id}`;
    await http().patch(url).set(auth()).send({ purpose: 'Назначение экземпляра.', manualText: ['purpose'] }).expect(200);
    const next = (await http().patch(templateUrl(p)).set(auth()).send({
      changes: { manualInstall: 'Монтаж Б.', manualPurpose: 'Назначение Б.' },
      expected: { manualInstall: 'Монтаж А.', manualPurpose: 'Назначение А.' },
    }).expect(200)).body;
    expect(next.textSnapshot).toMatchObject({ purpose: 'Назначение Б.', install: { text: 'Монтаж Б.' } });
    const draft = (await http().get(url).set(auth()).expect(200)).body;
    expect(draft.textSnapshot).toMatchObject({ purpose: 'Назначение экземпляра.', install: { text: 'Монтаж Б.' } });
    const issued = (await http().post(url + '/issue').set(auth()).send({ presentationVersion: 1, variant: 'short' }).expect(200)).body;
    expect(issued.textSnapshot).toMatchObject({ purpose: 'Назначение экземпляра.', install: { text: 'Монтаж Б.' } });
  });

  it('самостоятельный повтор сохраняет один id, повторный выпуск — один номер, печать живёт по снимку', async () => {
    const p = await makeProduct();
    await db().collection('productphotos').insertOne({ productId: p, purpose: 'passport', kind: 'overview', photoId: photo, deletedAt: null });
    const post = (body: unknown) => http().post('/api/passports').set(auth()).send(body as object);
    const create = { productId: String(p), presentationVersion: 1, variant: 'short', supplierOrgId: String(our), creationKey: randomUUID() };
    await post({ ...create, supplierOrgId: String(outside) }).expect(400);
    const previews = await passports().countDocuments();
    const preview = () => http().post('/api/passports/preview').set(auth()).send({ productId: String(p), presentationVersion: 1, variant: 'short', mode: 'pages', pack: 'passport' }).expect('Content-Type', /pdf/).expect(201);
    await preview();
    await preview();
    expect(await passports().countDocuments()).toBe(previews);
    const pair = await Promise.all([post(create), post(create)]);
    expect(pair.map((r) => r.status)).toEqual([201, 201]);
    const id = pair[0].body.id;
    expect(pair[1].body.id).toBe(id);
    await post({ ...create, variant: 'full' }).expect(409);
    await post({ ...create, supplierOrgId: String(second) }).expect(409);
    const issue = (variant: string) => http().post(`/api/passports/${id}/issue`).set(auth()).send({ presentationVersion: 1, variant });
    await issue('full').expect(409);
    const issued = await Promise.all([issue('short'), issue('short')]);
    expect(issued.map((r) => r.status)).toEqual([200, 200]);
    expect(issued[1].body.passportNumber).toBe(issued[0].body.passportNumber);
    const issuedAt = (await passports().findOne({ _id: new Types.ObjectId(id) }))!;
    expect(issuedAt.textSnapshot.description).toBe(shortDescription.text);
    expect(issuedAt.printSnapshot.standardImages).toMatchObject([{ kind: 'mounting', photoId: String(photo) }]);
    await products().updateOne({ _id: p }, { $set: { 'passportDefaults.simpleDescription.text': 'Новая фраза.' } });
    await db().collection('productphotos').updateMany({ productId: p }, { $set: { deletedAt: new Date() } });
    const printable = await http().get(`/api/passports/${id}/pdf`).query({ variant: 'full' }).set(auth());
    expect({ status: printable.status, message: printable.body.message }).toEqual({ status: 200, message: undefined });
    expect(printable.headers['content-type']).toMatch('application/pdf');
    const after = await passports().findOne({ _id: new Types.ObjectId(id) });
    expect(after?.textSnapshot).toEqual(issuedAt.textSnapshot);
    expect(after?.printSnapshot).toEqual(issuedAt.printSnapshot);

    const replacementId = (await db().collection('photos').insertOne({ storageUrl: '/uploads/' + file, mimeType: 'image/png', deletedAt: null })).insertedId;
    const edit = await http().patch(`/api/passports/${id}`).set(auth()).send({ images: [{ kind: 'overview', photoId: String(replacementId) }] });
    expect({ status: edit.status, message: edit.body.message }).toEqual({ status: 200, message: undefined });
    const revised = edit.body;
    expect(revised).toMatchObject({ revision: 2, passportNumber: issued[0].body.passportNumber });
    const current = (await passports().findOne({ _id: new Types.ObjectId(id) }))!;
    expect(current.revisions[0].data.printSnapshot).toEqual(issuedAt.printSnapshot);
    expect(current.textSnapshot).toEqual(issuedAt.textSnapshot);
    expect(current.printSnapshot.effectiveImages).toMatchObject([{ kind: 'overview', photoId: String(replacementId) }]);
    expect(current.printSnapshot.standardImages).toEqual(issuedAt.printSnapshot.standardImages);
    const card = (await http().get(`/api/passports/${id}`).set(auth()).expect(200)).body;
    expect(card.effectiveImages).toMatchObject([{ photoId: String(replacementId) }]);
    await http().get(`/api/passports/${id}/pdf`).set(auth()).expect(200).expect('Content-Type', /pdf/);
  });

  it('две позиции одного изделия получают разные id, legacy сохраняется и фирма меняется до номера', async () => {
    const p = await makeProduct();
    const order = (await db().collection('salesorders').insertOne({ orderNo: '155-1', companyId: our, deletedAt: null })).insertedId;
    const wrongOrder = (await db().collection('salesorders').insertOne({ orderNo: '155-2', companyId: second, deletedAt: null })).insertedId;
    const position = async (name: string) => (await db().collection('incomes').insertOne({ orderId: order, productId: p, title: name, deletedAt: null })).insertedId;
    const [a, b, archived] = await Promise.all(['Позиция A', 'Позиция B', 'Позиция с архивом'].map(position));
    const make = (incomeId: Types.ObjectId, salesOrderId = order) => ({
      productId: String(p), presentationVersion: 1, variant: 'short', incomeId: String(incomeId), salesOrderId: String(salesOrderId),
    });
    await http().post('/api/passports').set(auth()).send(make(a, wrongOrder)).expect(409);
    const post = (row: Record<string, unknown>) => http().post('/api/passports').set(auth()).send(row).expect(201);
    const [a1, a2, b1] = await Promise.all([post(make(a)), post({ ...make(a), incomeId: String(a).toUpperCase() }), post(make(b))]);
    expect(a1.body.id).toBe(a2.body.id);
    expect(a1.body.id).not.toBe(b1.body.id);
    const legacy = { passportNumber: '155001', name: 'Старый паспорт', incomeId: archived, salesOrderId: order, productId: p, deletedAt: null };
    const legacyId = (await passports().insertOne(legacy)).insertedId;
    expect((await post(make(archived))).body.id).toBe(String(legacyId));
    await http().patch(`/api/passports/${legacyId}`).set(auth()).send({ presentationVersion: 1, variant: 'short' }).expect(409);
    expect(await passports().findOne({ _id: legacyId })).toEqual({ ...legacy, _id: legacyId });
    await db().collection('salesorders').updateOne({ _id: order }, { $set: { companyId: second } });
    await http().post(`/api/passports/${a1.body.id}/issue`).set(auth()).send({ presentationVersion: 1, variant: 'short' }).expect(409);
    expect(await passports().countDocuments({ incomeId: a, status: 'draft' })).toBe(1);
  });
});
