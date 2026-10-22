import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * Паспорта изделий (TASKS ПС): паспорт = экземпляр, номера выдаёт сервер (счётчики после максимума),
 * выданные номера не меняются молча, копия на ту же модель, шаблон с версиями, PDF и ZIP, права.
 */
describe('Паспорта изделий', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  let manager = '';
  let orgId = '';
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    for (const c of ['productpassports', 'passporttemplates', 'counters']) await db().collection(c).deleteMany({});
    const username = `ps-manager-${Date.now()}`;
    await http().post('/api/admin/users').set(as(admin.access)).send({ username, password: 'role-pass-123', role: 'manager' }).expect(201);
    manager = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
    const org = await http().post('/api/partners').set(as(admin.access)).send({ kind: 'our', name: 'ООО «СпортИнЮг» ПС', inn: '2310181417', kpp: '231201001', phone: '8 (918) 633-91-91', email: 'sportin-yug@mail.ru', trademark: 'STREET IRON', directorName: 'Тен А.Т.' }).expect(201);
    orgId = org.body.id;
    // «перенесённые» паспорта: максимум № 549, номер изделия 2577
    await db().collection('productpassports').insertMany([
      { passportNumber: '548', passportNo: 548, productCode: '2576', warrantyCode: '202610-548', date: new Date('2026-10-13'), name: 'Стойки волейбольные', productCodeDuplicate: false, images: [], deletedAt: null, source: 'sheet:Pasports' },
      { passportNumber: '549', passportNo: 549, productCode: '2577', warrantyCode: '202610-549', date: new Date('2026-10-13'), name: 'Стойка баскетбольная', productCodeDuplicate: false, images: [], deletedAt: null, source: 'sheet:Pasports' },
    ]);
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  let first = '';
  it('создание: номера выдаёт сервер — № после максимума, талон ГГГГМ-№, номер изделия после 2577', async () => {
    const r = await http().post('/api/passports').set(as(admin.access)).send({ name: 'Урна парковая', date: '2026-11-02', materials: 'листовой стали 2 мм', purpose: 'Предназначено для сбора мусора', installationMethod: 'Изделие устанавливается на ровное основание', supplierOrgId: orgId, height: 800, length: 400, width: 400, weight: 12.5 }).expect(201);
    expect(r.body).toMatchObject({ passportNumber: '550', passportNo: 550, warrantyCode: '202611-550', productCode: '2578', warrantyMonths: 12, source: 'app' });
    expect(r.body.description).toBe('Урна парковая (в дальнейшем именуемое «Изделие»), изготовленное из листовой стали 2 мм. Изделие устанавливается на ровное основание. Предназначено для сбора мусора.');
    expect(r.body.bom).toEqual([{ pos: 1, code: 'И-1', name: 'Изделие в сборе', qty: 1, unit: 'шт.' }]);
    first = r.body.id;
  });

  it('гонка двух создателей — разные номера', async () => {
    const [a, b] = await Promise.all([1, 2].map(() => http().post('/api/passports').set(as(admin.access)).send({ name: 'Скамья' })));
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    expect(a.body.passportNumber).not.toBe(b.body.passportNumber);
    expect(a.body.productCode).not.toBe(b.body.productCode);
  });

  it('занятый номер — 409; выданный номер без подтверждения не меняется', async () => {
    await http().post('/api/passports').set(as(admin.access)).send({ name: 'Дубль', passportNumber: '549' }).expect(409);
    await http().post('/api/passports').set(as(admin.access)).send({ name: 'Дубль', productCode: '2577' }).expect(409);
    await http().patch(`/api/passports/${first}`).set(as(admin.access)).send({ date: '2026-12-01' }).expect(409);
    const ok = await http().patch(`/api/passports/${first}`).set(as(admin.access)).send({ customerName: 'ИП Азизова', objectName: 'парк «Победа»' }).expect(200);
    expect(ok.body.customerName).toBe('ИП Азизова');
    await http().patch(`/api/passports/${first}`).set(as(admin.access)).send({ warrantyCode: '202610-549', confirmNumbers: true }).expect(409);
  });

  it('копия на ту же модель: поля модели — те же, номера — новые, заказчик — пустой', async () => {
    const r = await http().post(`/api/passports/${first}/copy`).set(as(admin.access)).send({}).expect(201);
    expect(r.body).toMatchObject({ name: 'Урна парковая', height: 800, weight: 12.5, supplierOrgId: orgId });
    expect(r.body.passportNumber).not.toBe('550');
    expect(r.body.customerName).toBeUndefined();
  });

  it('список: поиск, фильтры, неполные, {items,total,page,limit}', async () => {
    const all = (await http().get('/api/passports').set(as(manager)).expect(200)).body;
    expect(all).toMatchObject({ total: 6, page: 1, limit: 25 });
    expect(all.items[0].passportNo).toBeGreaterThan(all.items[1].passportNo);
    expect((await http().get('/api/passports').query({ search: 'урна' }).set(as(manager)).expect(200)).body.total).toBe(2);
    expect((await http().get('/api/passports').query({ year: 2026, month: 11 }).set(as(manager)).expect(200)).body.total).toBe(1); // 2026-11-02 — только первый
    expect((await http().get('/api/passports').query({ customer: 'ип азизова' }).set(as(manager)).expect(200)).body.total).toBe(1);
    const inc = (await http().get('/api/passports').query({ incomplete: 1 }).set(as(manager)).expect(200)).body;
    expect(inc.total).toBe(6); // у всех нет общего вида
    expect(inc.items[0].missing).toContain('Общий вид');
    const f = (await http().get('/api/passports/facets').set(as(manager)).expect(200)).body;
    expect(f.years.map((y: { value: number }) => y.value)).toContain(2026);
    expect(f.suppliers[0]).toMatchObject({ value: orgId });
  });

  it('модели и готовые тексты для формы (ПС.5)', async () => {
    const models = (await http().get('/api/passports/models').set(as(manager)).expect(200)).body;
    const urn = models.find((m: { name: string }) => m.name === 'Урна парковая');
    expect(urn).toMatchObject({ n: 2, height: 800, materials: 'листовой стали 2 мм' });
    const ph = (await http().get('/api/passports/phrases').set(as(manager)).expect(200)).body;
    expect(ph.purpose).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Предназначено для сбора мусора', n: 2 })]));
    expect(Object.keys(ph)).toEqual(['materials', 'installationMethod', 'purpose']);
  });

  it('права: менеджер смотрит, но не создаёт и не скачивает PDF', async () => {
    await http().get(`/api/passports/${first}`).set(as(manager)).expect(200);
    await http().post('/api/passports').set(as(manager)).send({ name: 'x' }).expect(403);
    await http().get(`/api/passports/${first}/pdf`).set(as(manager)).expect(403);
  });

  it('шаблон: встроенный (версия 0) → правка = новая версия', async () => {
    const t0 = (await http().get('/api/passports/template').set(as(manager)).expect(200)).body;
    expect(t0.version).toBe(0);
    expect(t0.sections.map((s: { key: string }) => s.key)).toEqual(['mounting', 'warranty', 'storage', 'transport', 'service']);
    const sections = t0.sections.map((s: { title: string }, i: number) => (i === 0 ? { ...s, title: '3 Монтаж' } : s));
    const t1 = (await http().put('/api/passports/template').set(as(admin.access)).send({ sections }).expect(200)).body;
    expect(t1.version).toBe(1);
    expect(t1.sections[0].title).toBe('3 Монтаж');
    await http().put('/api/passports/template').set(as(manager)).send({ sections }).expect(403);
  });

  it('шаблон: версия категории TRN хранится отдельно, без параметра — «Для всех»', async () => {
    const all = (await http().get('/api/passports/template').set(as(manager)).expect(200)).body;
    const sections = all.sections.map((s: { title: string }, i: number) => (i === 0 ? { ...s, title: '3 Монтаж TRN' } : s));
    const t = (await http().put('/api/passports/template').set(as(admin.access)).send({ category: 'TRN', sections }).expect(200)).body;
    expect(t.category).toBe('TRN');
    expect(t.version).toBe(1);
    expect((await http().get('/api/passports/template').query({ category: 'TRN' }).set(as(manager)).expect(200)).body.sections[0].title).toBe('3 Монтаж TRN');
    expect((await http().get('/api/passports/template').query({ category: 'DIO' }).set(as(manager)).expect(200)).body.sections[0].title).toBe(all.sections[0].title);
    expect((await http().get('/api/passports/template').set(as(manager)).expect(200)).body.version).toBe(all.version);
    await http().put('/api/passports/template').set(as(admin.access)).send({ category: 'XXX', sections }).expect(400);
  });

  it('PDF: application/pdf, постранично и «в печать», отметка выдачи', async () => {
    const r = await http().get(`/api/passports/${first}/pdf`).set(as(admin.access)).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); }).expect(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(String(r.headers['content-disposition'])).toContain('filename*=UTF-8');
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const p = await http().get(`/api/passports/${first}/pdf`).query({ mode: 'print', stamp: 1 }).set(as(admin.access)).expect(200);
    expect(p.headers['content-type']).toContain('application/pdf');
    expect((await http().get(`/api/passports/${first}`).set(as(admin.access)).expect(200)).body.pdfIssuedAt).toBeTruthy();
  });

  it('ZIP по фильтру', async () => {
    const z = await http().get('/api/passports/zip').query({ search: 'урна' }).set(as(admin.access)).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); }).expect(200);
    expect(z.headers['content-type']).toContain('application/zip');
    expect((z.body as Buffer).readUInt32LE(0)).toBe(0x04034b50);
  });

  it('удаление в корзину и восстановление', async () => {
    await http().delete(`/api/passports/${first}`).set(as(admin.access)).expect(200);
    expect((await http().get('/api/passports').query({ deleted: 1 }).set(as(admin.access)).expect(200)).body.total).toBe(1);
    await http().post(`/api/passports/${first}/restore`).set(as(admin.access)).expect(200);
  });
});
