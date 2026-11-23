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
    // До общего cleanup: только локальная отдельная БД, включая owned-копии параллельной QA.
    const testDb = process.env.MONGO_DB_TEST ?? 'datacore-test';
    const mongoHost = process.env.MONGO_URI ? new URL(process.env.MONGO_URI).hostname : 'localhost';
    if (!/^datacore-test(?:-[a-z0-9-]+)?$/.test(testDb) || !['127.0.0.1', 'localhost'].includes(mongoHost)) {
      throw new Error('C155 e2e требует локальный Mongo и отдельную БД datacore-test или datacore-test-*');
    }
    ctx = await createTestApp({ strictValidation: true });
    expect(ctx.connection.name).toBe(testDb);
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

  it('C236 whole-block CAS, capture, clear и запрет instance payload', async () => {
    const model = await makeProduct();
    const exercise = { initialPosition: ' Сесть.\r\n\r\nДержаться за рукояти. ', movement: 'Плавно двигаться.', muscles: 'Мышцы ног.' };
    const normalized = { ...exercise, initialPosition: 'Сесть.\n\nДержаться за рукояти.' };
    const patch = (changes: Record<string, unknown>, expected: Record<string, unknown>) => http().patch(templateUrl(model)).set(auth()).send({ changes, expected });
    const count = await passports().countDocuments();
    const original = (await products().findOne({ _id: model }))!.passportDefaults;
    await patch({ exerciseInstructions: exercise }, { exerciseInstructions: null }).expect(200);
    const baseline = (await products().findOne({ _id: model }))!.passportDefaults;
    expect(baseline).toEqual({ ...original, exerciseInstructions: normalized });
    for (const variant of ['short', 'full']) {
      const t = (await http().get(templateUrl(model) + '?variant=' + variant).set(auth()).expect(200)).body;
      expect(t.defaults.exerciseInstructions).toEqual(normalized);
      expect(t.textSnapshot.exerciseInstructions).toEqual({ ...normalized, source: { kind: 'product', productId: String(model) } });
    }
    expect(await passports().countDocuments()).toBe(count);
    await patch({ exerciseInstructions: { ...exercise, movement: 'Другой текст' } }, { exerciseInstructions: null }).expect(409);
    await patch({ foundationDepth: 0 }, { foundationDepth: null }).expect(200);
    for (const bad of [{ ...exercise, muscles: '' }, { ...exercise, extra: 'x' }, { ...exercise, movement: '<b>Шаг</b>' }, { ...exercise, movement: '{name}' }, { ...exercise, movement: 'а'.repeat(4000) }]) await patch({ exerciseInstructions: bad }, { exerciseInstructions: normalized }).expect(400);
    const created = await http().post('/api/passports').set(auth()).send({ presentationVersion: 1, variant: 'short', productId: String(model), supplierOrgId: String(our), creationKey: randomUUID() }).expect(201);
    const savedId = created.body.id;
    const before = await passports().findOne({ _id: new Types.ObjectId(savedId) });
    expect(before!.exerciseInstructions).toEqual(normalized);
    await http().patch('/api/passports/' + savedId).set(auth()).send({ exerciseInstructions: normalized }).expect(400);
    await http().post('/api/passports').set(auth()).send({ productId: String(model), exerciseInstructions: normalized }).expect(400);
    await patch({ exerciseInstructions: null }, { exerciseInstructions: normalized }).expect(200);
    expect((await products().findOne({ _id: model }))!.passportDefaults.foundationDepth).toBe(0);
    for (let repeat = 0; repeat < 2; repeat++) await http().get('/api/passports/' + savedId).set(auth()).expect(200);
    expect(await passports().findOne({ _id: new Types.ObjectId(savedId) })).toEqual(before);
    const fresh = (await http().get(templateUrl(model)).set(auth()).expect(200)).body;
    expect(fresh.defaults).not.toHaveProperty('exerciseInstructions');
    expect(fresh.textSnapshot).not.toHaveProperty('exerciseInstructions');
  });

  it('C236 два concurrent CAS редактора не затирают модельный блок', async () => {
    const model = await makeProduct();
    const make = (movement: string) => ({ initialPosition: 'Сесть.', movement, muscles: 'Мышцы ног.' });
    const send = (movement: string) => http().patch(templateUrl(model)).set(auth()).send({ expected: { exerciseInstructions: null }, changes: { exerciseInstructions: make(movement) } });
    const responses = await Promise.all([send('Первая правка.'), send('Вторая правка.')]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const own = (await products().findOne({ _id: model }))!.passportDefaults.exerciseInstructions;
    expect(['Первая правка.', 'Вторая правка.']).toContain(own.movement);
    await http().patch(templateUrl(model)).set(auth()).send({ expected: { exerciseInstructions: own }, changes: { exerciseInstructions: own } }).expect(200);
    expect((await products().findOne({ _id: model }))!.passportDefaults.exerciseInstructions).toEqual(own);
  });

  it('C236 issued снимок/номер/история не меняются после правки модели, copy сохраняет свой блок', async () => {
    const exercise = { initialPosition: 'Сесть.', movement: 'Двигаться плавно.', muscles: 'Мышцы ног.' };
    const model = await makeProduct({ passportDefaults: { passportCategory: 'BLG', installationTypeId: install, simpleDescription: shortDescription, exerciseInstructions: exercise } });
    await db().collection('productphotos').insertOne({ productId: model, purpose: 'passport', kind: 'overview', photoId: photo, deletedAt: null });
    const created = (await http().post('/api/passports').set(auth()).send({ productId: String(model), presentationVersion: 1, supplierOrgId: String(our), creationKey: randomUUID() }).expect(201)).body;
    const url = '/api/passports/' + created.id;
    await http().post(url + '/issue').set(auth()).send({ presentationVersion: 1, variant: 'short' }).expect(200);
    const before = await passports().findOne({ _id: new Types.ObjectId(created.id) });
    const pdfBefore = await http().get(url + '/pdf').query({ readOnly: 1 }).set(auth()).expect(200);
    await http().patch(templateUrl(model)).set(auth()).send({ expected: { exerciseInstructions: exercise }, changes: { exerciseInstructions: { ...exercise, movement: 'Новый текст модели.' } } }).expect(200);
    for (let repeat = 0; repeat < 2; repeat++) {
      const read = (await http().get(url).set(auth()).expect(200)).body;
      expect(read.textSnapshot.exerciseInstructions.movement).toBe(exercise.movement);
      const pdf = await http().get(url + '/pdf').query({ readOnly: 1 }).set(auth()).expect(200);
      expect(pdf.headers['content-type']).toMatch(/pdf/);
      expect(pdfBefore.headers['content-type']).toMatch(/pdf/);
    }
    expect(await passports().findOne({ _id: new Types.ObjectId(created.id) })).toEqual(before);
    const copied = (await http().post(url + '/copy').set(auth()).send({}).expect(201)).body;
    expect(copied.exerciseInstructions).toEqual(exercise);
    await http().patch('/api/passports/' + copied.id).set(auth()).send({ note: 'Обычная правка' }).expect(200);
    const other = await makeProduct();
    const sameBefore = await passports().findOne({ _id: new Types.ObjectId(copied.id) });
    const rejected = await http().patch('/api/passports/' + copied.id).set(auth()).send({ productId: String(other) }).expect(409);
    expect(rejected.body.message).toContain('создайте новый паспорт');
    expect(await passports().findOne({ _id: new Types.ObjectId(copied.id) })).toEqual(sameBefore);
    const swapped = (await http().post(url + '/copy').set(auth()).send({ productId: String(other) }).expect(201)).body;
    expect(swapped).not.toHaveProperty('exerciseInstructions');
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

  it('C163: критерии и defaults сохраняются единым CAS; конфликт не оставляет частичной записи', async () => {
    const p = await makeProduct();
    const facet = new Types.ObjectId(), value = new Types.ObjectId(), other = new Types.ObjectId(), foreignFacet = new Types.ObjectId(), foreign = new Types.ObjectId(), element = new Types.ObjectId();
    await db().collection('dict_values').insertMany([
      { _id: facet, dict: 'productFacets', category: 'BLG', multi: false, deletedAt: null },
      { _id: value, dict: 'productFacetValues', parentId: facet, elementIds: [element], deletedAt: null },
      { _id: element, dict: 'passportElements', name: 'Опора изделия C163', kind: 'product', deletedAt: null },
      { _id: other, dict: 'productFacetValues', parentId: facet, deletedAt: null },
      { _id: foreignFacet, dict: 'productFacets', category: 'TRN', multi: false, deletedAt: null },
      { _id: foreign, dict: 'productFacetValues', parentId: foreignFacet, deletedAt: null },
    ]);
    const get = async () => (await http().get(templateUrl(p)).set(auth()).expect(200)).body;
    const patch = (changes: Record<string, unknown>, expected: Record<string, unknown>) => http().patch(templateUrl(p)).set(auth()).send({ changes, expected });
    expect((await get()).product.facetValueIds).toBeNull();
    await patch({ facetValueIds: [String(value)], foundationDepth: 150 }, { facetValueIds: null, foundationDepth: null }).expect(200);
    expect((await get()).product.facetValueIds).toEqual([String(value)]);
    expect((await get()).document.elements).toEqual([String(element)]);
    expect((await products().findOne({ _id: p }))?.passportDefaults).not.toHaveProperty('elements');
    await patch({ facetValueIds: [], foundationDepth: 900 }, { facetValueIds: null, foundationDepth: 150 }).expect(409);
    expect((await get()).defaults.foundationDepth).toBe(150);
    await patch({ facetValueIds: [String(value), String(other)] }, { facetValueIds: [String(value)] }).expect(400);
    await patch({ facetValueIds: [String(foreign)] }, { facetValueIds: [String(value)] }).expect(400);
    await patch({ facetValueIds: [] }, { facetValueIds: [String(value)] }).expect(200);
    expect((await get()).product.facetValueIds).toEqual([]);
    await patch({ facetValueIds: null }, { facetValueIds: [] }).expect(200);
    expect((await get()).product.facetValueIds).toBeNull();
    expect(await products().findOne({ _id: p })).not.toHaveProperty('facetValueIds');
    expect((await get()).defaults).not.toHaveProperty('facetValueIds');
    await patch({ 'product.facetValueIds': [] }, { 'product.facetValueIds': null }).expect(400);
    await products().updateOne({ _id: p }, { $set: { facetValueIds: [foreign] } });
    await patch({ facetValueIds: [String(foreign), String(value)] }, { facetValueIds: [String(foreign)] }).expect(200);
    expect((await get()).product.facetValueIds).toEqual([String(foreign), String(value)]);
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

  it('C161: хранит выбранные части, проверяет старое значение и пересобирает только новые документы', async () => {
    const frame = new Types.ObjectId(), grip = new Types.ObjectId(), pedal = new Types.ObjectId();
    const dictionary = db().collection('dict_values');
    await dictionary.insertMany([
      { _id: frame, name: 'Каркас', genSingular: 'каркаса' },
      { _id: grip, name: 'Рукоятка', genSingular: 'рукоятки' },
      { _id: pedal, name: 'Педаль', genSingular: 'педали' },
    ].map((row) => ({ ...row, dict: 'passportParts', deletedAt: null })));
    const product = await makeProduct({ passportDefaults: { passportCategory: 'BLG', installationTypeId: install } });
    await db().collection('productphotos').insertOne({ productId: product, purpose: 'passport', kind: 'overview', photoId: photo, deletedAt: null });
    const target = templateUrl(product);
    const project = async () => (await http().get(target).set(auth()).expect(200)).body;
    const patch = (value: object, previous: object | null) => http().patch(target).set(auth())
      .send({ changes: { simpleDescription: value }, expected: { simpleDescription: previous } });
    const partIds = [frame, grip, pedal].map(String);
    const auto = { mode: 'parts', partIds };
    const text = 'Изделие состоит из каркаса, рукоятки и педали.';
    const manual = { text: 'Ручная редакция описания.', partIds };
    const first = (await patch({ ...auto, partIds: [...partIds, partIds[0]], text: 'Подмена.' }, null).expect(200)).body;
    expect(first).toMatchObject({
      defaults: { simpleDescription: auto }, simpleDescriptionSource: { kind: 'parts', partIds, text },
      readiness: { ready: true }, textSnapshot: { description: text },
    });
    expect(first.defaults.simpleDescription).toEqual(auto);
    await patch(manual, null).expect(409);
    for (const partIds of [[], [String(new Types.ObjectId())]]) {
      await patch({ mode: 'parts', partIds }, auto).expect(400);
    }
    expect((await project()).defaults.simpleDescription).toEqual(auto);
    await patch(manual, auto).expect(200);
    expect(await project()).toMatchObject({ defaults: { simpleDescription: manual }, textSnapshot: { description: manual.text } });
    await patch(auto, manual).expect(200);
    await http().put(`/api/showcase/${product}/passport-defaults`).set(auth()).send({ passportCategory: 'BLG', installationTypeId: String(install) }).expect(200);
    const bulk = await http().post('/api/showcase/bulk').set(auth()).send({
      ids: [String(product)], set: { passportDefaults: { foundationDepth: 145 } },
    });
    expect(bulk.status).toBeLessThan(300);
    expect(bulk.body.updated).toBe(1);
    expect((await project()).defaults.simpleDescription).toEqual(auto);

    const beforePreview = await passports().countDocuments();
    const countersBefore = await db().collection('counters').find().toArray();
    await http().post('/api/passports/preview').set(auth()).send({
      productId: String(product), presentationVersion: 1, variant: 'short', mode: 'pages', pack: 'passport',
    }).expect(201).expect('Content-Type', /pdf/);
    expect(await passports().countDocuments()).toBe(beforePreview);
    expect(await db().collection('counters').find().toArray()).toEqual(countersBefore);
    const draft = (await http().post('/api/passports').set(auth()).send({
      productId: String(product), presentationVersion: 1, variant: 'short', supplierOrgId: String(our), creationKey: randomUUID(),
    }).expect(201)).body;
    const card = `/api/passports/${draft.id}`;
    const issued = (await http().post(card + '/issue').set(auth()).send({ presentationVersion: 1, variant: 'short' }).expect(200)).body;
    expect(issued).toMatchObject({ status: 'issued', textSnapshot: { description: text } });
    const persisted = await passports().findOne({ _id: new Types.ObjectId(draft.id) });
    expect(persisted?.printSnapshot).toBeDefined();

    await dictionary.updateOne({ _id: pedal }, { $unset: { genSingular: '' } });
    expect((await project()).textSnapshot.description).toBe('Основные части изделия: Каркас, Рукоятка и Педаль.');
    await dictionary.updateOne({ _id: pedal }, { $set: { deletedAt: new Date() } });
    const broken = await project();
    expect(broken.readiness.ready).toBe(false);
    expect(broken.readiness.missing).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'simpleDescription' })]));
    expect(broken.simpleDescriptionSource).toMatchObject({ kind: 'parts', partIds, text: '', invalidPartIds: [String(pedal)] });
    const printable = (await http().get(card).query({ readOnly: 1 }).set(auth()).expect(200)).body;
    expect(printable.textSnapshot.description).toBe(text);
    await http().post(card + '/snapshot').set(auth()).expect(409);
    await http().get(card + '/pdf').query({ readOnly: 1 }).set(auth()).expect(200).expect('Content-Type', /pdf/);
    expect(await passports().findOne({ _id: new Types.ObjectId(draft.id) })).toEqual(persisted);

    await http().post(card + '/annul').set(auth()).send({ reason: 'Проверка C161.' }).expect(200);
    const annulled = await passports().findOne({ _id: new Types.ObjectId(draft.id) });
    expect(annulled?.textSnapshot).toEqual(persisted?.textSnapshot);
    expect(annulled?.printSnapshot).toEqual(persisted?.printSnapshot);
    await http().post(card + '/snapshot').set(auth()).expect(409);
    expect((await http().get(card).query({ readOnly: 1 }).set(auth()).expect(200)).body.textSnapshot.description).toBe(text);
    expect(await passports().findOne({ _id: new Types.ObjectId(draft.id) })).toEqual(annulled);
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
