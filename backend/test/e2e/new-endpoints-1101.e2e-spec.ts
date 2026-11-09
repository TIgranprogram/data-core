import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * Новые эндпоинты 2026-11-01: предпросмотр паспорта, проверка по шаблону, паспорта на весь заказ (ПНЗ),
 * фото изделия (purpose), свободные настройки me/prefs, галочка «Деньги» у роли, история КП.
 */
describe('Новые эндпоинты 2026-11-01', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  const A = () => as(admin.access);
  const bin = (res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); };
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  let orgId = '', instId = '', matId = '';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    for (const c of ['productpassports', 'products', 'productphotos', 'photos', 'dict_values', 'salesorders', 'incomes', 'counters', 'commercialoffers']) await db().collection(c).deleteMany({});
    await db().collection('dict_values').insertMany([
      { dict: 'passportCategories', code: 'BLG', name: 'Благоустройство', deletedAt: null },
      { dict: 'passportCategories', code: 'TRN', name: 'Уличный тренажёр', requiredImages: 'overview\nfoundation', deletedAt: null },
    ]);
    const dv = db().collection('dict_values');
    instId = String((await dv.insertOne({ dict: 'passportInstall', name: 'Анкерами', deletedAt: null })).insertedId);
    matId = String((await dv.insertOne({ dict: 'passportMaterials', code: 'ST', name: 'Сталь', madeOf: 'листовой стали', deletedAt: null })).insertedId);
    for (const c of ['MINTRUD_883N', 'SP_70', 'GOST_15150', 'GOST_9_014', 'GOST_26653', 'GOST_12_3_009', 'SP_325']) await dv.insertOne({ dict: 'passportStandards', code: c, name: c, status: 'действует', checkedAt: new Date().toISOString().slice(0, 10), deletedAt: null });
    orgId = (await http().post('/api/partners').set(A()).send({ kind: 'our', name: 'ООО «СпортИнЮг» НЭ', inn: '2310181417', kpp: '231201001', phone: '8 (918) 633-91-91', email: 'sportin-yug@mail.ru', trademark: 'STREET IRON', directorName: 'Тен А.Т.' }).expect(201)).body.id;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  const mkUser = async (role: string, tag: string) => {
    const username = `ne-${tag}-${Date.now()}`;
    await http().post('/api/admin/users').set(A()).send({ username, password: 'role-pass-123', role }).expect(201);
    return (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access as string;
  };
  /** Изделие, готовое к выпуску: категория BLG, габариты, вес, материал, способ установки, конструкция, сроки; фото «для паспорта» — addImg. */
  const mkProduct = async (name: string, over: Record<string, unknown> = {}) =>
    String((await db().collection('products').insertOne({ name, sku: `NE-${new Types.ObjectId()}`, deletedAt: null, weightKg: 12.5, dimensions: { length: 400, width: 400, height: 800 }, purpose: 'Для сбора мусора', installation: 'На ровное основание',
      passportDefaults: { passportCategory: 'BLG', materialIds: [matId], installationTypeId: instId, joints: ['solid'], serviceLifeYears: 10, warrantyMonths: 12 }, ...over })).insertedId);
  const addImg = async (productId: string, kind = 'overview') => {
    const ph = (await db().collection('photos').insertOne({ storageUrl: '/uploads/ne.png', originalFilename: 'ne.png', mimeType: 'image/png' })).insertedId;
    await db().collection('productphotos').insertOne({ productId: new Types.ObjectId(productId), photoId: ph, purpose: 'passport', kind, sortOrder: 0, deletedAt: null, createdAt: new Date() });
  };

  describe('1. preview и check (шаблон)', () => {
    it('POST /passports/preview: PDF без записи в базу; short и full; без категории — 400; менеджеру — 403', async () => {
      const pid = await mkProduct('Урна предпросмотр');
      await addImg(pid);
      const before = await db().collection('productpassports').countDocuments({});
      for (const variant of ['short', 'full']) {
        const r = await http().post('/api/passports/preview').set(A()).send({ productId: pid, variant }).buffer(true).parse(bin as never);
        expect(r.status).toBe(201); // POST без @HttpCode — как у остальных создающих
        expect(r.headers['content-type']).toContain('application/pdf');
        expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      }
      expect(await db().collection('productpassports').countDocuments({})).toBe(before); // ничего не пишет
      const nocat = await mkProduct('Без категории', { passportDefaults: {} });
      await http().post('/api/passports/preview').set(A()).send({ productId: nocat }).expect(400);
      await http().post('/api/passports/preview').set(A()).send({ productId: pid, variant: 'huge' }).expect(400);
      await http().post('/api/passports/preview').set(A()).send({}).expect(400);
      await http().post('/api/passports/preview').set(as(await mkUser('manager', 'pv'))).send({ productId: pid }).expect(403);
    });

    it('POST /passports/check с productId: mode template — поля экземпляра не требуются, «Способ установки» один раз', async () => {
      const pid = await mkProduct('Тренажёр шаблон', { passportDefaults: { passportCategory: 'TRN' } });
      const t = (await http().post('/api/passports/check').set(A()).send({ productId: pid }).expect(200)).body;
      expect(t.mode).toBe('template');
      const keys = t.missing.map((m: { key: string }) => m.key);
      for (const k of ['date', 'supplierOrgId', 'customerName', 'orderNo']) expect(keys).not.toContain(k);
      expect(t.missing.filter((m: { label: string }) => m.label === 'Способ установки')).toHaveLength(1);
      expect(t.missing.map((m: { label: string }) => m.label)).not.toContain('Дата');
      // тот же запрос в режиме «экземпляр» — поля экземпляра требуются
      const inst = (await http().post('/api/passports/check').set(A()).send({ productId: pid, mode: 'instance' }).expect(200)).body;
      expect(inst.mode).toBe('instance');
      expect(inst.missing.map((m: { key: string }) => m.key)).toEqual(expect.arrayContaining(['date', 'supplierOrgId']));
      expect(inst.missing.filter((m: { label: string }) => m.label === 'Способ установки')).toHaveLength(1);
    });
  });

  describe('2. паспорта на весь заказ (ПНЗ)', () => {
    let orderId = '';
    let okLine = '', freshLine = '', noProdLine = '', noCatLine = '';

    it('plan: позиции с состояниями ready / blocked, счётчики, 404 на чужой заказ', async () => {
      orderId = (await http().post('/api/salesorders').set(A()).send({ orderNo: 'НЭ-1', customer: 'Школа 5', stage: 'new' }).expect(201)).body.id;
      const okPid = await mkProduct('Урна заказ'); await addImg(okPid);
      const freshPid = await mkProduct('Скамья заказ'); await addImg(freshPid);
      const noCatPid = await mkProduct('Изделие без категории', { passportDefaults: {} });
      const line = async (title: string, productId?: string) => {
        const id = (await http().post('/api/incomes').set(A()).send({ orderId, title, qty: 2, unit: 'шт' }).expect(201)).body.id as string;
        if (productId) await db().collection('incomes').updateOne({ _id: new Types.ObjectId(id) }, { $set: { productId: new Types.ObjectId(productId) } });
        return id;
      };
      okLine = await line('Урна', okPid); freshLine = await line('Скамья', freshPid); noProdLine = await line('Монтаж'); noCatLine = await line('Без категории', noCatPid);
      const p = (await http().get(`/api/passports/order/${orderId}/plan`).set(A()).expect(200)).body;
      expect(p).toMatchObject({ orderId, orderNo: 'НЭ-1', total: 4, ready: 2, blocked: 2, issued: 0 });
      const by = (id: string) => p.lines.find((l: { incomeId: string }) => l.incomeId === id);
      expect(by(okLine)).toMatchObject({ state: 'ready', missing: [], passport: null, qty: 2, productName: 'Урна заказ' });
      expect(by(noProdLine)).toMatchObject({ state: 'blocked', missing: ['К позиции не привязано изделие'] });
      expect(by(noCatLine).state).toBe('blocked');
      expect(by(noCatLine).missing).toEqual(expect.arrayContaining(['Категория']));
      expect((await http().get(`/api/passports/order/${orderId}/plan`).query({ variant: 'full' }).set(A()).expect(200)).body.total).toBe(4);
      await http().get(`/api/passports/order/${new Types.ObjectId()}/plan`).set(A()).expect(404);
      await http().get(`/api/passports/order/${orderId}/plan`).set(as(await mkUser('manager', 'pnz'))).expect(403);
    });

    it('pdf до выпуска — 400', async () => {
      await http().get(`/api/passports/order/${orderId}/pdf`).set(A()).expect(400);
    });

    it('issue: черновик с поставщиком выпускается; без поставщика и неготовые — в skipped с причиной; повтор без дублей', async () => {
      // черновики на позиции с изделием; поставщика проставляем только у «Урны»
      await http().post(`/api/salesorders/${orderId}/passports/draft-all`).set(A()).expect(200);
      const draft = (await db().collection('productpassports').findOne({ incomeId: new Types.ObjectId(okLine) }))!;
      await http().patch(`/api/passports/${draft._id}`).set(A()).send({ supplierOrgId: orgId }).expect(200);
      const r = (await http().post(`/api/passports/order/${orderId}/issue`).set(A()).send({}).expect(200)).body;
      expect(r.counts).toEqual({ issued: 2, skipped: 2 });
      expect(r.issued[0]).toEqual({ incomeId: okLine, passportId: String(draft._id) });
      const reasons = Object.fromEntries(r.skipped.map((x: { incomeId: string; reason: string }) => [x.incomeId, x.reason]));
      expect(reasons[noProdLine]).toBe('Не готово: К позиции не привязано изделие');
      expect(reasons[noCatLine]).toMatch(/^Не готово: .*Категория/);
      // «готовая» позиция без своего поставщика выпускается с нашей фирмой по умолчанию (план и выпуск согласованы)
      expect(r.issued.map((x: { incomeId: string }) => x.incomeId)).toContain(freshLine);
      expect(await db().collection('productpassports').countDocuments({ incomeId: new Types.ObjectId(okLine), status: 'issued' })).toBe(1);
      // повтор: новых выпусков нет, выпущенная — «уже выпущен», дублей нет
      const total = await db().collection('productpassports').countDocuments({});
      const again = (await http().post(`/api/passports/order/${orderId}/issue`).set(A()).send({}).expect(200)).body;
      expect(again.issued).toEqual([]);
      expect(again.skipped.find((s: { incomeId: string }) => s.incomeId === okLine).reason).toMatch(/^Паспорт № \d+ уже выпущен/);
      expect(await db().collection('productpassports').countDocuments({ incomeId: new Types.ObjectId(okLine) })).toBe(1);
      expect(await db().collection('productpassports').countDocuments({ deletedAt: null, status: 'draft', incomeId: new Types.ObjectId(freshLine) })).toBeLessThanOrEqual(1); // своих черновиков не копит
      expect(await db().collection('productpassports').countDocuments({})).toBe(total);
      // lines: только выбранные; чужая позиция — причина; плохой id — 400
      const foreign = String(new Types.ObjectId());
      const f = (await http().post(`/api/passports/order/${orderId}/issue`).set(A()).send({ lines: [foreign] }).expect(200)).body;
      expect(f.skipped).toEqual([{ incomeId: foreign, title: '', reason: 'Позиции нет в этом заказе' }]);
      await http().post(`/api/passports/order/${orderId}/issue`).set(A()).send({ lines: ['не-id'] }).expect(400);
      const pl = (await http().get(`/api/passports/order/${orderId}/plan`).set(A()).expect(200)).body;
      expect(pl).toMatchObject({ issued: 2, ready: 0, blocked: 2 });
      expect(pl.lines.find((l: { incomeId: string }) => l.incomeId === okLine)).toMatchObject({ state: 'issued', passport: { status: 'issued' } });
    });

    it('pdf после выпуска — один PDF с выпущенными', async () => {
      const r = await http().get(`/api/passports/order/${orderId}/pdf`).set(A()).buffer(true).parse(bin as never);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('application/pdf');
      expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      await http().get(`/api/passports/order/${orderId}/pdf`).query({ variant: 'full', mode: 'print', stamp: 1 }).set(A()).expect(200);
    });
  });

  describe('3. фото изделия: upload purpose, products/:id/photos', () => {
    it('POST /photos/upload: картинка проходит; dwg/dxf и чертёж-pdf — только purpose=drawing и с верной сигнатурой; exe — 400', async () => {
      const img = await http().post('/api/photos/upload').query({ purpose: 'passport' }).set(A()).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
      expect(img.status).toBe(201);
      expect(img.body.id).toBeTruthy();
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
      const dwg = Buffer.from('AC1015\0\0\0\0\0\0\0\0fake-dwg');
      const up = (q: Record<string, string>, buf: Buffer, filename: string, contentType = 'application/octet-stream') => http().post('/api/photos/upload').query(q).set(A()).attach('file', buf, { filename, contentType });
      const ok = await up({ purpose: 'drawing' }, pdf, 'c.pdf', 'application/pdf');
      expect(ok.status).toBe(201);
      expect(ok.body.id).toBeTruthy();
      expect((await up({ purpose: 'drawing' }, dwg, 'plan.dwg')).status).toBe(201);
      await up({}, dwg, 'plan.dwg').then((r) => expect(r.status).toBe(400)); // без purpose=drawing dwg не принимается
      await up({ purpose: 'passport' }, dwg, 'plan.dwg').then((r) => expect(r.status).toBe(400));
      await up({ purpose: 'drawing' }, Buffer.from('просто текст'), 'fake.dwg').then((r) => expect(r.status).toBe(400)); // сигнатура не совпала
      const exe = Buffer.from('MZ\x90\x00fake');
      await up({ purpose: 'drawing' }, exe, 'x.exe').then((r) => expect(r.status).toBe(400));
      await up({}, exe, 'x.exe', 'application/x-msdownload').then((r) => expect(r.status).toBe(400));
    });

    /** Строки productphotos заводим напрямую: POST /products/:id/photos. */
    const rawPhoto = async (productId: string, over: Record<string, unknown>) =>
      String((await db().collection('productphotos').insertOne({ productId: new Types.ObjectId(productId), photoId: new Types.ObjectId(), sortOrder: 0, deletedAt: null, createdAt: new Date(), ...over })).insertedId);

    it('GET /products/:id/photos?purpose=: фильтр по назначению; неизвестное — 400; DELETE — мягкое, соседние не тронуты', async () => {
      const pid = await mkProduct('Фото-изделие');
      const show = await rawPhoto(pid, { isMain: true });
      const old = await rawPhoto(pid, { purpose: null }); // записи CRM без поля purpose — тоже витрина
      const pass = await rawPhoto(pid, { purpose: 'passport', kind: 'overview' });
      const drw = await rawPhoto(pid, { purpose: 'drawing' });
      const ids = async (purpose?: string) => ((await http().get(`/api/products/${pid}/photos`).query(purpose ? { purpose } : {}).set(A()).expect(200)).body as Array<{ id: string }>).map((x) => x.id).sort();
      expect(await ids()).toEqual([show, old].sort());
      expect(await ids('showcase')).toEqual([show, old].sort());
      expect(await ids('passport')).toEqual([pass]);
      expect(await ids('drawing')).toEqual([drw]);
      await http().get(`/api/products/${pid}/photos`).query({ purpose: 'zzz' }).set(A()).expect(400);
      await http().delete(`/api/products/${pid}/photos/${pass}`).set(A()).expect(204);
      expect(await ids('passport')).toEqual([]);
      const raw = await db().collection('productphotos').findOne({ _id: new Types.ObjectId(pass) });
      expect(raw).toBeTruthy(); // мягкое удаление: запись осталась
      expect(raw!.deletedAt).toBeTruthy();
      expect(await ids('drawing')).toEqual([drw]);
      expect(await ids()).toEqual([show, old].sort());
      const obs = await mkUser('user', 'ph'); // наблюдатель читает, но не пишет
      await http().get(`/api/products/${pid}/photos`).set(as(obs)).expect(200);
      await http().delete(`/api/products/${pid}/photos/${drw}`).set(as(obs)).expect(403);
    });

    it('POST /products/:id/photos с purpose/kind создаёт запись productphotos с назначением, плохая пара — 400', async () => {
      const pid = await mkProduct('Фото-POST');
      const photoId = String(new Types.ObjectId());
      const pass = (await http().post(`/api/products/${pid}/photos`).set(A()).send({ photoId, purpose: 'passport', kind: 'overview' }).expect(201)).body;
      expect(pass).toMatchObject({ purpose: 'passport', kind: 'overview' });
      await http().post(`/api/products/${pid}/photos`).set(A()).send({ photoId, purpose: 'passport' }).expect(400);
      await http().post(`/api/products/${pid}/photos`).set(A()).send({ photoId, kind: 'overview' }).expect(400);
    });
  });

  describe('4. PATCH /auth/me/prefs: свободные ключи', () => {
    it('bgrp:x → 200 и сохраняется, null сбрасывает; плохой ключ, не строка, длинное значение — 400', async () => {
      const t = await mkUser('manager', 'pr');
      const r = (await http().patch('/api/auth/me/prefs').set(as(t)).send({ 'bgrp:x': 'a,b' }).expect(200)).body;
      expect(r.uiPrefs).toMatchObject({ 'bgrp:x': 'a,b' });
      const me = (await http().get('/api/auth/me').set(as(t)).expect(200)).body;
      expect((me.user ?? me).uiPrefs ?? me.uiPrefs).toMatchObject({ 'bgrp:x': 'a,b' });
      const cleared = (await http().patch('/api/auth/me/prefs').set(as(t)).send({ 'bgrp:x': null }).expect(200)).body;
      expect(cleared.uiPrefs['bgrp:x']).toBeUndefined();
      await http().patch('/api/auth/me/prefs').set(as(t)).send({ '1bad key!': 'x' }).expect(400);
      await http().patch('/api/auth/me/prefs').set(as(t)).send({ 'bgrp:y': 5 }).expect(400);
      await http().patch('/api/auth/me/prefs').set(as(t)).send({ 'bgrp:z': 'я'.repeat(1) + 'x'.repeat(4097) }).expect(400);
      await http().patch('/api/auth/me/prefs').set(as(t)).send({ ['k'.repeat(81)]: 'x' }).expect(400);
      await http().patch('/api/auth/me/prefs').set(as(t)).send({ sidebarW: 5 }).expect(400); // известный ключ — прежние пределы
    });
  });

  describe('5. роль с money:false', () => {
    let hide = '', plain = '';
    let materialId = '';
    beforeAll(async () => {
      const rHide = (await http().post('/api/roles').set(A()).send({ label: 'Без денег', baseRole: 'manager', money: false }).expect(201)).body;
      const rPlain = (await http().post('/api/roles').set(A()).send({ label: 'Как менеджер', baseRole: 'manager' }).expect(201)).body;
      expect(rHide.money).toBe(false);
      hide = await mkUser(rHide.name, 'nomoney');
      plain = await mkUser(rPlain.name, 'plain');
      // данные с ценами
      materialId = (await http().post('/api/stock/items').set(A()).send({ name: 'Труба с ценой НЭ', unit: 'м', categoryName: 'Трубы', pricePerUnit: 250 }).expect(201)).body.id;
      await http().post('/api/stock/batch').set(A()).send({ type: 'in', lines: [{ materialId, qty: 5 }] }).expect(201);
      await http().post('/api/showcase').set(A()).send({ sku: 'NE-SHOW', name: 'Изделие с ценой НЭ', type: 'Благоустройство', price: 125000 }).expect(201);
      await db().collection('organizations').insertOne({ name: 'СпортИН-ЮГ НЭ', isOurCompany: true, deletedAt: null });
      const company = String((await db().collection('organizations').findOne({ name: 'СпортИН-ЮГ НЭ' }))!._id);
      await http().post('/api/offers').set(A()).send({ customer: 'ООО Цена', companyId: company, items: [{ productName: 'Урна', quantity: 2, unitPrice: 1000 }] }).expect(201);
    });
    const hasKey = (v: unknown, keys: string[], d = 0): boolean => {
      if (d > 8 || v === null || typeof v !== 'object') return false;
      if (Array.isArray(v)) return v.some((x) => hasKey(x, keys, d + 1));
      return Object.entries(v as object).some(([k, x]) => (keys.includes(k) && x !== null && x !== undefined) || hasKey(x, keys, d + 1));
    };

    it('/auth/me: canMoney=false у роли с money:false, true у роли без поля', async () => {
      const me = async (t: string) => { const b = (await http().get('/api/auth/me').set(as(t)).expect(200)).body; return b.user ?? b; };
      expect((await me(hide)).canMoney).toBe(false);
      expect((await me(plain)).canMoney).toBe(true);
    });

    it('/showcase: у роли без поля цена на месте, у money:false список читается', async () => {
      const q = (t: string) => http().get('/api/showcase').query({ search: 'Изделие с ценой НЭ' }).set(as(t)).expect(200);
      expect((await q(plain)).body.items[0].price).toBe(125000);
      expect((await q(hide)).body.items[0].name).toBe('Изделие с ценой НЭ');
    });
    it('/showcase: цена вырезана у money:false', async () => {
      const h = (await http().get('/api/showcase').query({ search: 'Изделие с ценой НЭ' }).set(as(hide)).expect(200)).body;
      expect(hasKey(h, ['price', 'listPrice', 'basePrice', 'priceWithVat'])).toBe(false);
    });

    it('/stock: список читается; «Поставщики / цены» (items/:id/ordered) — цена за единицу только у роли с деньгами', async () => {
      const list = (t: string) => http().get('/api/stock/items').query({ search: 'Труба с ценой НЭ' }).set(as(t)).expect(200);
      expect((await list(hide)).body.items.length).toBe(1);
      expect(hasKey((await list(hide)).body, ['pricePerUnit', 'lastPrice', 'unitPrice'])).toBe(false);
      await db().collection('supplyrequests').insertOne({ title: 'Труба с ценой НЭ', qty: 5, priceHint: 1250, status: 'received', materialId: new Types.ObjectId(materialId), receivedAt: new Date(), requestDate: new Date(), deletedAt: null });
      const a = (await http().get(`/api/stock/items/${materialId}/ordered`).set(as(plain)).expect(200)).body;
      expect(a.suppliers[0].lastPrice).toBe(250);
      const h = (await http().get(`/api/stock/items/${materialId}/ordered`).set(as(hide)).expect(200)).body;
      expect(h.suppliers[0].count).toBe(1);
      expect(h.suppliers[0].lastPrice ?? null).toBeNull(); // ключ вырезан MoneyMask
    });

    it('/offers: цены позиций вырезаны у money:false (у роли без поля — на месте)', async () => {
      const a = (await http().get('/api/offers').set(as(plain)).expect(200)).body;
      expect(a.items[0].total).toBe(2000);
      expect(a.items[0].items[0].unitPrice).toBe(1000);
      const h = (await http().get('/api/offers').set(as(hide)).expect(200)).body;
      expect(h.items.length).toBeGreaterThan(0);
      expect(hasKey(h, ['unitPrice', 'amount', 'sum'])).toBe(false);
    });
    it('/offers: суммы КП (total) вырезаны у money:false', async () => {
      const h = (await http().get('/api/offers').set(as(hide)).expect(200)).body;
      expect(typeof h.total).toBe('number'); // пагинация цела
      expect(hasKey(h.items, ['total'])).toBe(false);
    });

    it('/finance и /payroll — 403 у money:false; у роли без поля finance открыт, payroll — как у менеджера (403)', async () => {
      await http().get('/api/finance/summary').set(as(hide)).expect(403);
      await http().get('/api/finance/cashflow').set(as(hide)).expect(403);
      await http().get('/api/payroll/summary').set(as(hide)).expect(403);
      await http().get('/api/finance/summary').set(as(plain)).expect(200);
      await http().get('/api/payroll/summary').set(as(plain)).expect(403);
    });
  });

  describe('6. GET /audit-logs/record для КП', () => {
    it('CommercialOffer → 200 с историей создания и правки', async () => {
      const company = String((await db().collection('organizations').findOne({ isOurCompany: true }))!._id);
      const o = (await http().post('/api/offers').set(A()).send({ customer: 'ООО История КП', companyId: company, items: [{ productName: 'Урна', quantity: 1, unitPrice: 100 }] }).expect(201)).body;
      await http().patch(`/api/offers/${o.id}`).set(A()).send({ notes: 'Монтаж отдельно' }).expect(200);
      const h = (await http().get('/api/audit-logs/record').query({ entityType: 'CommercialOffer', entityId: o.id }).set(A()).expect(200)).body;
      expect(h.total).toBeGreaterThanOrEqual(2);
      expect(h.items.map((x: { action: string }) => x.action)).toEqual(['offer.updated', 'offer.created']);
      await http().get('/api/audit-logs/record').query({ entityType: 'CommercialOffer', entityId: o.id }).set(as(await mkUser('user', 'au'))).expect(200);
      await http().get('/api/audit-logs/record').query({ entityType: 'CommercialOffer' }).set(A()).expect(400); // нет записи
    });
  });
});
