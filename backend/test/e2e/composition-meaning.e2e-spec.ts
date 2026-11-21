import request from 'supertest';
import PDFDocument from 'pdfkit';
import { Types } from 'mongoose';
import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { techSheetRows } from '../../src/common/print/tech-sheet-rows';

/** Настоящие HTTP + Mongo + PDF. Только локальный тестовый Docker Mongo. */
describe('C148: происхождение материалов через API и сохранённый паспорт', () => {
  let ctx: TestContext;
  let token: string;
  let matId: string;
  let instId: string;
  let orgId: string;
  const imageName = `c148-e2e-${new Types.ObjectId()}.png`;
  const imagePath = path.resolve('uploads', imageName);
  const db = () => ctx.connection.db!;
  const http = () => request(ctx.app.getHttpServer());
  const A = () => authHeader(token);
  const oid = () => new Types.ObjectId();
  const insert = async (collection: string, doc: Record<string, unknown>) =>
    (await db().collection(collection).insertOne({ deletedAt: null, ...doc })).insertedId;
  const bin = (res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };
  beforeAll(async () => {
    // До createTestApp: его cleanup удаляет все коллекции; запретить любой иной контур.
    const testDb = process.env.MONGO_DB_TEST ?? 'datacore-test';
    const mongoHost = process.env.MONGO_URI ? new URL(process.env.MONGO_URI).hostname : 'localhost';
    if (!/^datacore-test(?:-[a-z0-9-]+)?$/.test(testDb) ||
      !['127.0.0.1', 'localhost'].includes(mongoHost)) {
      throw new Error('C148 e2e требует локальный Docker Mongo и явную БД datacore-test или datacore-test-*');
    }
    ctx = await createTestApp();
    expect(ctx.connection.name).toBe(testDb);
    token = (await loginAsAdmin(ctx.app)).access;
    matId = String(await insert('dict_values', { dict: 'passportMaterials', name: 'Сталь C148', madeOf: 'стали C148' }));
    instId = String(await insert('dict_values', { dict: 'passportInstall', code: 'ANCHORS', name: 'Анкерами' }));
    await insert('dict_values', { dict: 'passportCategories', code: 'BLG', name: 'Благоустройство' });
    for (const code of ['MINTRUD_883N', 'SP_70', 'GOST_15150', 'GOST_9_014', 'GOST_26653', 'GOST_12_3_009', 'SP_325']) {
      await insert('dict_values', { dict: 'passportStandards', code, name: code, status: 'действует', checkedAt: '2026-11-18' });
    }
    orgId = (await http().post('/api/partners').set(A()).send({ kind: 'our', name: 'ООО C148', inn: '2310181417', kpp: '231201001', phone: '89186339191', email: 'c148@example.org', directorName: 'Директор' }).expect(201)).body.id;
    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).png().toFile(imagePath);
  });
  afterAll(async () => { await ctx?.cleanup(); await fs.unlink(imagePath).catch(() => undefined); });

  const product = async (over: Record<string, unknown> = {}) => {
    const pid = await insert('products', {
      name: 'Изделие C148', sku: `C148-${oid()}`, weightKg: 12,
      dimensions: { length: 400, width: 400, height: 800 }, purpose: 'Для сбора мусора', installation: 'На основание',
      passportDefaults: { passportCategory: 'BLG', materialIds: [matId], installationTypeId: instId, joints: ['solid'], serviceLifeYears: 10, warrantyMonths: 12 }, ...over,
    });
    const photoId = await insert('photos', { storageUrl: `/uploads/${imageName}`, originalFilename: imageName, mimeType: 'image/png' });
    await insert('productphotos', { productId: pid, photoId, purpose: 'passport', kind: 'overview', sortOrder: 0 });
    await insert('productphotos', { productId: pid, photoId, purpose: 'passport', kind: 'mounting', sortOrder: 1 });
    return String(pid);
  };
  const graph = async (count = 2) => {
    const organizationId = oid(); // одинаковые обозначения допустимы у разных изготовителей
    const raw = await insert('materials', { name: 'Труба', materialKind: 'raw', passportSpec: { materialId: new Types.ObjectId(matId), sizes: ['89×3'], passportText: 'Ручной паспорт', techText: 'Ручная техника' } });
    const parts = [];
    for (let i = 0; i < count; i++) parts.push(await insert('materials', { organizationId, name: 'Стойка', article: `СТ.${i + 1}`, materialKind: 'part', composition: [{ _id: oid(), lineType: 'material', refId: raw, quantity: 1 }] }));
    const mod = await insert('productmodules', { name: 'Рама C148', sku: 'РАМ', composition: parts.map((refId) => ({ _id: oid(), lineType: 'material', refId, quantity: 3 })) });
    const pid = await product({ composition: [{ _id: oid(), lineType: 'module', refId: mod, quantity: 2 }], productModuleIds: [mod] });
    return { pid, mod, parts, raw };
  };
  const proposal = async (pid: string) => (await http().get(`/api/showcase/${pid}/materials-spec/from-composition`).set(A()).expect(200)).body;
  const getProduct = async (pid: string) => (await http().get(`/api/showcase/${pid}`).set(A()).expect(200)).body;
  const draft = async (pid: string, over: Record<string, unknown> = {}) => (await http().post('/api/passports').set(A()).send({ productId: pid, supplierOrgId: orgId, ...over }).expect(201)).body;
  const getPassport = async (id: string) => (await http().get(`/api/passports/${id}`).set(A()).expect(200)).body;

  it('точные источники → PATCH/GET → новый draft → технический PDF; необязательные части не блокируют', async () => {
    const { pid, mod, parts, raw } = await graph();
    const p = await proposal(pid);
    expect(p.materialsSpec.rows).toHaveLength(1);
    const refs = p.materialsSpec.rows[0].sourceRefs;
    expect(refs.map((r: { refId: string }) => r.refId)).toEqual(parts.map(String));
    expect(refs[0].path.map((r: { refId: string }) => r.refId)).toEqual([mod, parts[0], raw].map(String));
    expect(refs[0]).toMatchObject({ kind: 'part', name: 'Стойка', code: 'СТ.1' });
    expect((await getProduct(pid)).materialsSpec).toBeFalsy(); // предложение ничего не записало
    await http().patch(`/api/showcase/${pid}`).set(A()).send({ materialsSpec: p.materialsSpec }).expect(200);
    const saved = await getProduct(pid);
    expect(saved.materialsSpec).toEqual(p.materialsSpec);
    expect((await proposal(pid)).materialsSpec).toEqual(p.materialsSpec);
    const created = await draft(pid);
    const got = await getPassport(created.id);
    expect(got.materialsSpec).toEqual(p.materialsSpec);
    expect(got.compositionSheet[0].qty * got.compositionSheet[0].children[0].qty).toBe(6);
    const gaps = (await http().get(`/api/showcase/${pid}/techsheet-gaps`).set(A()).expect(200)).body;
    expect(gaps.ready).toBe(true);
    expect(gaps.missing).toEqual([]);
    const queue = (await http().get(`/api/showcase/${pid}/fill-queue`).set(A()).expect(200)).body;
    expect(queue.items.some((r: { key: string }) => /parts|material/i.test(r.key))).toBe(false);
    const rows = techSheetRows({ spec: got.materialsSpec, mats: [{ id: matId, name: 'Сталь C148' }], parts: [] });
    expect(rows[0]).toEqual({ name: 'Стойка СТ.1, Стойка СТ.2', text: 'Ручная техника' });
    const spy = jest.spyOn(PDFDocument.prototype, 'text'); // call-through: настоящий PDF
    try {
      const pdf = await http().post(`/api/showcase/${pid}/tech-sheet`).set(A()).send({ rows }).buffer(true).parse(bin as never).expect(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect(spy.mock.calls.map(([s]) => String(s)).join('\n')).toContain('Стойка СТ.1, Стойка СТ.2');
    } finally { spy.mockRestore(); }
  });

  it('101 источник проходит producer → PATCH/GET → новый draft без потери 101-го', async () => {
    const { pid, parts } = await graph(101);
    const p = await proposal(pid);
    expect(p.materialsSpec.rows.map((r: { sourceRefs: unknown[] }) => r.sourceRefs.length)).toEqual([100, 1]);
    await http().patch(`/api/showcase/${pid}`).set(A()).send({ materialsSpec: p.materialsSpec }).expect(200);
    const saved = await getProduct(pid);
    expect(saved.materialsSpec).toEqual(p.materialsSpec);
    const got = await getPassport((await draft(pid)).id);
    expect(got.materialsSpec.rows.flatMap((r: { sourceRefs: { refId: string }[] }) => r.sourceRefs.map((s) => s.refId))).toEqual(parts.map(String));
  });

  it('старый ручной текст без BOM и без частей сохраняется; неизвестный материал имеет адрес', async () => {
    const spec = { rows: [{ materialId: matId, sizes: ['12'], partIds: [], passportText: 'Старый паспорт', techText: 'Старая техника' }], coatingIds: [] };
    const pid = await product({ materialsSpec: spec });
    expect((await proposal(pid)).materialsSpec.rows).toEqual([]);
    expect((await getProduct(pid)).materialsSpec).toEqual(spec);
    expect((await getPassport((await draft(pid)).id)).materialsSpec).toEqual(spec);
    const missing = await insert('materials', { name: 'Неизвестное сырьё C148', materialKind: 'raw' });
    const part = await insert('materials', { name: 'Узел без словаря', article: 'НЕИЗВ', materialKind: 'part', composition: [{ lineType: 'material', refId: missing, quantity: 1 }] });
    const unknownPid = await product({ composition: [{ lineType: 'material', refId: part, quantity: 1 }] });
    const p = await proposal(unknownPid);
    expect(p.materialsSpec.rows).toEqual([]);
    expect(p.unmatched).toContain('Неизвестное сырьё C148');
    expect(p.unmatchedSources[0].sourceRefs[0]).toMatchObject({ refId: String(part), name: 'Узел без словаря' });
    expect((await http().get(`/api/showcase/${unknownPid}/techsheet-gaps`).set(A()).expect(200)).body.ready).toBe(false);
  });

  it('ручное название экземпляра переживает изменение каталога и два GET', async () => {
    const pid = await product();
    const own = await draft(pid, { name: 'Название договора C148' });
    const normal = await draft(pid);
    await http().patch(`/api/showcase/${pid}`).set(A()).send({ name: 'Новая модель C148' }).expect(200);
    for (let i = 0; i < 2; i++) {
      expect(await getPassport(own.id)).toMatchObject({ name: 'Название договора C148', manualText: expect.arrayContaining(['name']) });
      expect(await getPassport(normal.id)).toMatchObject({ name: 'Новая модель C148' });
    }
    await http().patch(`/api/passports/${normal.id}`).set(A()).send({ name: 'Ручное переименование', manualText: ['name'] }).expect(200);
    expect((await getPassport(normal.id)).name).toBe('Ручное переименование');
    expect((await getPassport(normal.id)).name).toBe('Ручное переименование');
  });

  it('комплекс сохраняет два изделия с количеством, не смешивает их материалы; самоссылка и цикл запрещены', async () => {
    const childA = await product({ name: 'Изделие комплекса A', materialsSpec: { rows: [{ materialId: matId, sizes: [], partIds: [] }], coatingIds: [] } });
    const childB = await product({ name: 'Изделие комплекса B' });
    const parent = await product({ name: 'Комплекс C148' });
    await http().put(`/api/showcase/${parent}/composition`).set(A()).send({ types: ['product'], lines: [
      { lineType: 'product', productId: childA, quantity: 2 },
      { lineType: 'product', productId: childB, quantity: 3 },
    ] }).expect(200);
    const saved = await getProduct(parent);
    expect(saved.composition).toHaveLength(2);
    expect((await getProduct(parent)).composition).toEqual(saved.composition);
    const got = await getPassport((await draft(parent)).id);
    expect(got.compositionSheet).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'product', label: 'Изделие комплекса A', qty: 2 }),
      expect.objectContaining({ kind: 'product', label: 'Изделие комплекса B', qty: 3 }),
    ]));
    expect((await proposal(parent)).materialsSpec.rows).toEqual([]);
    await http().put(`/api/showcase/${parent}/composition`).set(A()).send({ types: ['product'], lines: [{ lineType: 'product', productId: parent, quantity: 1 }] }).expect(400);
    await http().put(`/api/showcase/${childA}/composition`).set(A()).send({ types: ['product'], lines: [{ lineType: 'product', productId: parent, quantity: 1 }] }).expect(400);
    expect((await getProduct(parent)).composition).toEqual(saved.composition);
  });

  it('реальный draft → issue → PDF сохраняет дерево, богатые modules и замораживает представление', async () => {
    const { pid } = await graph();
    await http().patch(`/api/showcase/${pid}`).set(A()).send({ materialsSpec: (await proposal(pid)).materialsSpec }).expect(200);
    const created = await draft(pid, { name: 'Экземпляр договора для выпуска' });
    // Существующее legacy-поле до выпуска; это настоящая запись тестовой БД, не mock сервиса.
    const modules = [{ name: 'Сохранённый модуль C095', dims: '1200×600×900 мм', qty: 4 }];
    await db().collection('productpassports').updateOne({ _id: new Types.ObjectId(created.id) }, { $set: { modules } });
    await http().post(`/api/passports/${created.id}/issue`).set(A()).expect(200);
    const issued = await getPassport(created.id);
    expect(issued.status).toBe('issued');
    expect(issued.name).toBe('Экземпляр договора для выпуска');
    expect(issued.modules).toEqual(modules);
    expect(issued.compositionPresentation).toBe('both');
    const stored = await db().collection('productpassports').findOne({ _id: new Types.ObjectId(created.id) });
    expect(stored?.modules).toEqual(modules);
    expect(stored?.compositionPresentation).toBe('both');
    expect(issued.compositionSheet[0].label).toBe('Рама C148');
    const spy = jest.spyOn(PDFDocument.prototype, 'text');
    try {
      const pdf = await http().get(`/api/passports/${created.id}/pdf`).set(A()).buffer(true).parse(bin as never).expect(200);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      const printed = spy.mock.calls.map(([s]) => String(s)).join('\n');
      expect(printed).toContain('Рама C148');
      expect(printed).toContain('Сохранённый модуль C095');
      expect(printed).toContain('1200×600×900 мм');
    } finally { spy.mockRestore(); }
    await http().patch(`/api/showcase/${pid}`).set(A()).send({ name: 'Позднее имя' }).expect(200);
    expect((await getPassport(created.id)).name).toBe(issued.name);
    await http().post(`/api/passports/${created.id}/issue`).set(A()).expect(200);
    expect(await getPassport(created.id)).toMatchObject({ compositionSheet: issued.compositionSheet, modules, compositionPresentation: 'both' });
    expect((await getPassport((await draft(pid)).id)).name).toBe('Позднее имя');
  });
});
