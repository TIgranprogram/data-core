import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { Types } from 'mongoose';

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
    await db().collection('productpassports').createIndex({ passportNumber: 1 }, { unique: true, name: 'passportNumber_unique' }); // как на проде: черновиков много — у каждого своя служебная метка
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  let first = '';
  let copyId = '';
  const photo = String(new Types.ObjectId());
  // полный паспорт без категории (v1): всё обязательное для выпуска есть
  const full = (over: Record<string, unknown> = {}) => ({ name: 'Урна парковая', date: '2026-11-02', materials: 'листовой стали 2 мм', purpose: 'Предназначено для сбора мусора', installationMethod: 'Изделие устанавливается на ровное основание',
    category: 'Благоустройство', supplierOrgId: orgId, height: 800, length: 400, width: 400, weight: 12.5, images: [{ kind: 'overview', photoId: photo }], ...over });

  it('НМ: новый паспорт — черновик без номера; номера — только при «Выпустить» (после максимума, талон ГГГГМ-№)', async () => {
    const r = await http().post('/api/passports').set(as(admin.access)).send(full()).expect(201);
    expect(r.body).toMatchObject({ status: 'draft', warrantyMonths: 12, source: 'app' });
    expect(String(r.body.passportNumber)).toMatch(/^draft-/); // служебная метка черновика, не номер
    expect(r.body.productCode ?? null).toBeNull();
    expect(r.body.description).toBe('Урна парковая (в дальнейшем именуемое «Изделие»), изготовленное из листовой стали 2 мм. Изделие устанавливается на ровное основание. Предназначено для сбора мусора.');
    expect(r.body.bom).toEqual([{ pos: 1, code: 'И-1', name: 'Изделие в сборе', qty: 1, unit: 'шт.' }]);
    first = r.body.id;
    // черновик правится сколько угодно — номер не появляется
    expect(String((await http().patch(`/api/passports/${first}`).set(as(admin.access)).send({ note: 'черновик', date: '2026-11-02' }).expect(200)).body.passportNumber)).toMatch(/^draft-/);
    const i = (await http().post(`/api/passports/${first}/issue`).set(as(admin.access)).expect(200)).body;
    expect(i).toMatchObject({ status: 'issued', passportNumber: '550', passportNo: 550, warrantyCode: '202611-550', productCode: '2578', revision: 1 });
    // повторное нажатие — тот же номер
    expect((await http().post(`/api/passports/${first}/issue`).set(as(admin.access)).expect(200)).body.passportNumber).toBe('550');
  });

  it('НМ: неполный черновик не выпускается (400 со списком); двойной клик — один номер; два выпуска подряд — номера без пропусков', async () => {
    const bare = (await http().post('/api/passports').set(as(admin.access)).send({ name: 'Скамья' }).expect(201)).body;
    const no = (await http().post(`/api/passports/${bare.id}/issue`).set(as(admin.access)).expect(400)).body;
    expect(no.missing).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'supplierOrgId' })]));
    const [a, b] = await Promise.all([1, 2].map(() => http().post('/api/passports').set(as(admin.access)).send(full({ name: 'Скамья парковая' }))));
    const twice = await Promise.all([a, a].map((x) => http().post(`/api/passports/${x.body.id}/issue`).set(as(admin.access))));
    expect(twice.map((x) => x.status)).toEqual([200, 200]);
    expect(twice[0].body.passportNumber).toBe(twice[1].body.passportNumber);
    const other = (await http().post(`/api/passports/${b.body.id}/issue`).set(as(admin.access)).expect(200)).body;
    expect(Number(other.passportNumber)).toBe(Number(twice[0].body.passportNumber) + 1);
    await http().delete(`/api/passports/${bare.id}`).set(as(admin.access)).expect(200); // черновик удаляется свободно
  });

  it('НМ: выпущенный — свободно только «после печати», остальное — «Новая редакция»; номер — только админ, с проверкой', async () => {
    await http().post('/api/passports').set(as(admin.access)).send({ name: 'Дубль', passportNumber: '549' }).expect(409); // перенос с занятым номером
    await http().patch(`/api/passports/${first}`).set(as(admin.access)).send({ date: '2026-12-01' }).expect(409);
    const ok = await http().patch(`/api/passports/${first}`).set(as(admin.access)).send({ customerName: 'ИП Азизова', objectName: 'парк «Победа»' }).expect(200);
    expect(ok.body.customerName).toBe('ИП Азизова');
    const locked = (await http().patch(`/api/passports/${first}`).set(as(admin.access)).send({ weight: 13 }).expect(409)).body;
    expect(locked.message).toMatch(/Новая редакция/);
    const rev = (await http().patch(`/api/passports/${first}`).query({ newRevision: 1 }).set(as(admin.access)).send({ weight: 13, passportCategory: 'MAF' }).expect(200)).body;
    expect(rev).toMatchObject({ weight: 13, revision: 2, passportNumber: '550' });
    expect(rev.revisions).toHaveLength(1);
    expect(rev.revisions[0].data.weight).toBe(12.5);
    await http().patch(`/api/passports/${first}`).set(as(admin.access)).send({ warrantyCode: '202610-549', confirmNumbers: true }).expect(409); // занят
  });

  it('копия — черновик без номера: поля модели те же, заказчик пустой', async () => {
    const r = await http().post(`/api/passports/${first}/copy`).set(as(admin.access)).send({}).expect(201);
    expect(r.body).toMatchObject({ status: 'draft', name: 'Урна парковая', height: 800, weight: 13, supplierOrgId: orgId, passportCategory: 'MAF' });
    expect(String(r.body.passportNumber)).toMatch(/^draft-/); // служебная метка черновика, не номер
    expect(r.body.customerName).toBeUndefined();
    copyId = r.body.id;
  });

  it('список: статус-фильтр, поиск, фильтры, {items,total,page,limit}', async () => {
    const all = (await http().get('/api/passports').set(as(manager)).expect(200)).body;
    expect(all).toMatchObject({ total: 6, page: 1, limit: 25 });
    expect((await http().get('/api/passports').query({ status: 'draft' }).set(as(manager)).expect(200)).body.total).toBe(1);
    expect((await http().get('/api/passports').query({ status: 'issued' }).set(as(manager)).expect(200)).body.total).toBe(5); // в т. ч. 2 старых без статуса
    expect((await http().get('/api/passports').query({ search: 'урна' }).set(as(manager)).expect(200)).body.total).toBe(2);
    expect((await http().get('/api/passports').query({ customer: 'ип азизова' }).set(as(manager)).expect(200)).body.total).toBe(1);
    const inc = (await http().get('/api/passports').query({ incomplete: 1 }).set(as(manager)).expect(200)).body;
    expect(inc.items.find((x: { passportNumber: string }) => x.passportNumber === '548').missing).toContain('Фото изделия');
    const f = (await http().get('/api/passports/facets').set(as(manager)).expect(200)).body;
    expect(f.years.map((y: { value: number }) => y.value)).toContain(2026);
    expect(f.suppliers[0]).toMatchObject({ value: orgId });
  });

  it('модели и готовые тексты для формы (ПС.5)', async () => {
    const models = (await http().get('/api/passports/models').set(as(manager)).expect(200)).body;
    const urn = models.find((m: { name: string }) => m.name === 'Урна парковая');
    expect(urn).toMatchObject({ n: 2, height: 800, materials: 'листовой стали 2 мм' });
    const ph = (await http().get('/api/passports/phrases').set(as(manager)).expect(200)).body;
    expect(ph.purpose).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Предназначено для сбора мусора', n: 4 })]));
    expect(Object.keys(ph)).toEqual(['materials', 'installationMethod', 'purpose']);
  });

  it('права: менеджер смотрит, но не создаёт, не выпускает и не скачивает PDF', async () => {
    await http().get(`/api/passports/${first}`).set(as(manager)).expect(200);
    await http().post('/api/passports').set(as(manager)).send({ name: 'x' }).expect(403);
    await http().post(`/api/passports/${copyId}/issue`).set(as(manager)).expect(403);
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

  it('«Разделы и тексты» v2: тексты категории, предпросмотр без сохранения, запись новой версии, «Для всех» — 400 (БЗ-6 Э2d)', async () => {
    const t = (await http().get('/api/passports/texts').query({ category: 'DSP' }).set(as(manager)).expect(200)).body;
    expect(t.source).toBe('code');
    expect(t.all.sections.length).toBeGreaterThan(5);
    const origins = t.tree.flatMap((s: { items: Array<{ origin: string }> }) => s.items.map((i) => i.origin));
    expect(origins).toEqual(expect.arrayContaining(['all', 'own', 'override']));
    // предпросмотр со своим (несохранённым) разделом — пункт в собранном тексте, в базе ничего не появилось
    const own = [...t.own.sections, { key: 'e2dx', title: 'Проверка предпросмотра', paragraphs: ['Пункт предпросмотра для {name}.'] }];
    const p = (await http().post('/api/passports/texts/preview').set(as(manager)).send({ category: 'DSP', own }).expect(200)).body;
    expect(JSON.stringify(p.sections)).toContain('Пункт предпросмотра для [{name} не заполнено].');
    expect(p.missing).toContain('name');
    expect((await http().get('/api/passports/texts').query({ category: 'DSP' }).set(as(manager)).expect(200)).body.source).toBe('code');
    // запись: менеджеру нельзя; «Для всех» v2 — своя версия (ALL_V2), шаблон «Для всех» PDF v1 не меняется (Э9.4)
    await http().put('/api/passports/texts').set(as(manager)).send({ category: 'DSP', sections: own }).expect(403);
    const v1Before = (await http().get('/api/passports/template').set(as(admin.access)).expect(200)).body;
    const allNow = (await http().get('/api/passports/texts').query({ category: 'ALL' }).set(as(admin.access)).expect(200)).body;
    const allEdited = allNow.own.sections.map((x: { paragraphs: string[] }, i: number) => (i === 0 ? { ...x, paragraphs: ['Свой общий пункт для проверки.', ...x.paragraphs.slice(1)] } : x));
    const allSaved = (await http().put('/api/passports/texts').set(as(admin.access)).send({ category: 'ALL', sections: allEdited }).expect(200)).body;
    expect(allSaved).toMatchObject({ source: 'db', version: 1 });
    const v1After = (await http().get('/api/passports/template').set(as(admin.access)).expect(200)).body;
    expect({ v: v1After.version, s: v1After.sections }).toEqual({ v: v1Before.version, s: v1Before.sections });
    const pv = (await http().post('/api/passports/texts/preview').set(as(admin.access)).send({ category: 'TRN' }).expect(200)).body;
    expect(JSON.stringify(pv.sections)).toContain('Свой общий пункт для проверки.');
    const saved = (await http().put('/api/passports/texts').set(as(admin.access)).send({ category: 'DSP', sections: own }).expect(200)).body;
    expect(saved).toMatchObject({ source: 'db', version: 1 });
    expect(JSON.stringify(saved.tree)).toContain('Проверка предпросмотра');
  });

  it('PDF: выпущенный — с номером и отметкой выдачи; черновик — тоже можно, с пометкой «ЧЕРНОВИК», без отметки выдачи', async () => {
    const bin = (res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); };
    const r = await http().get(`/api/passports/${first}/pdf`).set(as(admin.access)).buffer(true).parse(bin as never).expect(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(String(r.headers['content-disposition'])).toContain('filename*=UTF-8');
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    await http().get(`/api/passports/${first}/pdf`).query({ mode: 'print', stamp: 1 }).set(as(admin.access)).expect(200);
    expect((await http().get(`/api/passports/${first}`).set(as(admin.access)).expect(200)).body.pdfIssuedAt).toBeTruthy();
    await http().get(`/api/passports/${copyId}/pdf`).set(as(admin.access)).expect(200);
    expect((await http().get(`/api/passports/${copyId}`).set(as(admin.access)).expect(200)).body.pdfIssuedAt ?? null).toBeNull();
  });

  it('ZIP по фильтру — только выпущенные', async () => {
    const bin = (res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); };
    const z = await http().get('/api/passports/zip').query({ search: '550' }).set(as(admin.access)).buffer(true).parse(bin as never).expect(200);
    expect(z.headers['content-type']).toContain('application/zip');
    expect((z.body as Buffer).readUInt32LE(0)).toBe(0x04034b50);
  });

  it('НМ: дубли — черновик того же изделия; свой паспорт не считается', async () => {
    const pid = String(new Types.ObjectId());
    const d1 = (await http().post('/api/passports').set(as(admin.access)).send({ name: 'Турник', productId: pid, orderNo: '77' }).expect(201)).body;
    const dup = (await http().get('/api/passports/duplicates').query({ productId: pid, orderNo: '77' }).set(as(admin.access)).expect(200)).body;
    expect(dup.items.map((x: { id: string }) => x.id)).toEqual([d1.id]);
    expect((await http().get('/api/passports/duplicates').query({ productId: pid, exceptId: d1.id }).set(as(admin.access)).expect(200)).body.items).toEqual([]);
    await http().delete(`/api/passports/${d1.id}`).set(as(admin.access)).expect(200);
  });

  it('удаление: черновик — в корзину и обратно; выпущенный — нельзя, только «Аннулировать» с причиной; номер не выдаётся повторно', async () => {
    await http().delete(`/api/passports/${copyId}`).set(as(admin.access)).expect(200);
    expect((await http().get('/api/passports').query({ deleted: 1 }).set(as(admin.access)).expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(copyId);
    await http().post(`/api/passports/${copyId}/restore`).set(as(admin.access)).expect(200);
    await http().delete(`/api/passports/${first}`).set(as(admin.access)).expect(409);
    await http().post(`/api/passports/${first}/annul`).set(as(admin.access)).send({}).expect(400);
    const an = (await http().post(`/api/passports/${first}/annul`).set(as(admin.access)).send({ reason: 'дубль' }).expect(200)).body;
    expect(an).toMatchObject({ status: 'annulled', annulReason: 'дубль', passportNumber: '550' });
    await http().patch(`/api/passports/${first}`).set(as(admin.access)).send({ note: 'x' }).expect(409);
    await http().delete(`/api/passports/${first}`).set(as(admin.access)).expect(409);
    const n = (await http().post('/api/passports').set(as(admin.access)).send(full({ name: 'После аннулирования' })).expect(201)).body;
    expect(Number((await http().post(`/api/passports/${n.id}/issue`).set(as(admin.access)).expect(200)).body.passportNumber)).toBe(553);
  });
  it('v2: паспорт с категорией — снимок текста; правка шаблона не меняет выданный, «обновить текст» — меняет (БЗ-6 Э4c)', async () => {
    const dv = db().collection('dict_values');
    await dv.deleteMany({ dict: { $in: ['passportElements', 'passportMaterials', 'passportCategories'] } });
    const el = await dv.insertOne({ dict: 'passportElements', code: 'BAR', name: 'Турник', inDescription: 'перекладина для подтягиваний', purpose: 'подтягиваний', usageRules: 'Перед занятием осмотрите изделие', deletedAt: null });
    const mat = await dv.insertOne({ dict: 'passportMaterials', code: 'ST', name: 'Сталь', madeOf: 'стальной трубы с порошковым покрытием', deletedAt: null });
    await dv.insertOne({ dict: 'passportCategories', code: 'TRN', name: 'Уличный тренажёр', requiredImages: ['overview', 'foundation'].join(String.fromCharCode(10)), deletedAt: null });
    const created = (await http().post('/api/passports').set(as(admin.access))
      .send({ name: 'Тренажёр «Турник»', passportCategory: 'TRN', elements: [String(el.insertedId)], materialIds: [String(mat.insertedId)], supplierOrgId: orgId }).expect(201)).body;
    expect(created.textSnapshot?.category).toBe('TRN');
    expect(created.textSnapshot.description).toContain('перекладина для подтягиваний');
    expect(created.textSnapshot.description).toContain('стальной трубы');
    const before = JSON.stringify(created.textSnapshot.sections);
    const card = (await http().get(`/api/passports/${created.id}`).set(as(admin.access)).expect(200)).body;
    expect(card.missing).toEqual(expect.arrayContaining(['Способ установки', 'Рост пользователя от', 'Рисунок: Схема фундамента']));
    // ФП: проверка черновика формы — те же правила, с ключом поля; ничего не пишет; менеджеру — 403
    const chk = (await http().post('/api/passports/check').set(as(admin.access)).send({ name: 'Черновик', passportCategory: 'TRN', heightMin: '1400', images: [{ kind: 'safety', photoId: 'x' }] }).expect(200)).body;
    const keyOf = Object.fromEntries(chk.missing.map((m: { label: string; key: string }) => [m.label, m.key]));
    expect(keyOf['Способ установки']).toBe('installationTypeId');
    expect(keyOf['Рост пользователя от']).toBeUndefined();
    expect(keyOf['Рисунок: Зона безопасности']).toBeUndefined(); // safety из формы = safety_zone категории
    expect(chk.requiredImages).toEqual(expect.arrayContaining(['overview']));
    // правка шаблона категории — выданный паспорт не меняется
    const tpl = (await http().get('/api/passports/template').query({ category: 'TRN' }).set(as(admin.access)).expect(200)).body;
    const sections = tpl.sections.map((x: { paragraphs: string[] }, i: number) => (i === 0 ? { ...x, paragraphs: [...x.paragraphs, 'Новый пункт для проверки снимка.'] } : x));
    await http().put('/api/passports/template').set(as(admin.access)).send({ category: 'TRN', sections, tables: tpl.tables }).expect(200);
    const after = (await http().get(`/api/passports/${created.id}`).set(as(admin.access)).expect(200)).body;
    expect(JSON.stringify(after.textSnapshot.sections)).toBe(before);
    // «обновить текст по справочникам» — новый пункт появился
    const re = (await http().post(`/api/passports/${created.id}/snapshot`).set(as(admin.access)).expect(200)).body;
    expect(JSON.stringify(re.textSnapshot.sections)).toContain('Новый пункт для проверки снимка.');
    // паспорт v1 (без категории) — снимок не нужен
    const bare = (await http().post('/api/passports').set(as(admin.access)).send({ name: 'Паспорт без категории' }).expect(201)).body;
    await http().post(`/api/passports/${bare.id}/snapshot`).set(as(admin.access)).expect(400);
    // БЗ-7: паспорту без категории выбрали категорию правкой — текст собирается сразу; повторная правка готовый текст не пересобирает
    const old = (await http().post('/api/passports').set(as(admin.access)).send({ name: 'Старый тренажёр' }).expect(201)).body;
    expect(old.textSnapshot ?? null).toBeNull();
    const conv = (await http().patch(`/api/passports/${old.id}`).set(as(admin.access)).send({ passportCategory: 'TRN' }).expect(200)).body;
    expect(conv.textSnapshot?.category).toBe('TRN');
    const again = (await http().patch(`/api/passports/${old.id}`).set(as(admin.access)).send({ note: 'заметка' }).expect(200)).body;
    expect(again.textSnapshot.at).toBe(conv.textSnapshot.at);
    await http().post(`/api/passports/${created.id}/snapshot`).set(as(manager)).expect(403);
  });
  it('БЗ-9: массовое изменение выбранных — общие поля, элементы «добавить», отмена; номера не меняются', async () => {
    const a = (await http().post('/api/passports').set(as(admin.access)).send({ name: 'Массово 1', passportCategory: 'WRK', warrantyMonths: 12 }).expect(201)).body;
    const b = (await http().post('/api/passports').set(as(admin.access)).send({ name: 'Массово 2' }).expect(201)).body;
    const el = String(new Types.ObjectId());
    const r = (await http().post('/api/passports/bulk').set(as(admin.access)).send({ ids: [a.id, b.id], set: { passportCategory: 'TRN', warrantyMonths: '24', elements: [el], customerName: 'ГБУ', passportNumber: '999', name: 'нельзя' }, arrays: { elements: 'add' } }).expect(200)).body;
    expect(r).toMatchObject({ updated: 2, failed: [] });
    const a2 = (await http().get(`/api/passports/${a.id}`).set(as(admin.access)).expect(200)).body;
    expect(a2).toMatchObject({ passportCategory: 'TRN', warrantyMonths: 24, customerName: 'ГБУ', name: 'Массово 1', status: 'draft' });
    expect(String(a2.passportNumber)).toMatch(/^draft-/); // номер массово не появляется
    expect(a2.elements.map(String)).toEqual([el]);
    expect(a2.textSnapshot?.category).toBe('TRN'); // текст пересобран по новой категории
    // отмена — как было
    await http().post('/api/passports/bulk/restore').set(as(admin.access)).send({ items: r.before }).expect(200);
    const a3 = (await http().get(`/api/passports/${a.id}`).set(as(admin.access)).expect(200)).body;
    expect(a3).toMatchObject({ passportCategory: 'WRK', warrantyMonths: 12 });
    expect(a3.customerName ?? '').toBe('');
    expect(a3.textSnapshot?.category).toBe('WRK');
    await http().post('/api/passports/bulk').set(as(admin.access)).send({ ids: [a.id], set: { name: 'x' } }).expect(400); // только не-массовые — «отметьте, что изменить»
    await http().post('/api/passports/bulk').set(as(manager)).send({ ids: [a.id], set: { warrantyMonths: 1 } }).expect(403);
  });

  it('ПВ: воронка — дерево по категории, выбор собирает назначение и установку, обязательный раздел блокирует выпуск, правка справочника пересобирает черновик', async () => {
    const dv = db().collection('dict_values');
    await dv.deleteMany({ dict: 'passportPhrases' });
    const mk = async (b: Record<string, unknown>) => (await http().post('/api/dicts/passportPhrases').set(as(admin.access)).send(b).expect(201)).body.id as string;
    const purposeRoot = await mk({ name: 'Назначение', section: 'purpose', order: 1 });
    const purposeLeaf = await mk({ name: 'Занятия', parentId: purposeRoot, text: 'Для занятий спортом.', allCategories: 'true' });
    const mountRoot = await mk({ name: 'Как крепится', section: 'installation', required: 'true', order: 2 });
    const anchor = await mk({ name: 'Анкерное', parentId: mountRoot, text: 'Крепится анкерами.', categories: 'TRN' });
    const concrete = await mk({ name: 'Бетонирование', parentId: mountRoot, text: 'Бетонируется.', categories: 'TRN,WRK' });
    await mk({ name: 'Только дети', parentId: mountRoot, text: 'Для детских.', categories: 'DIO' });
    // справочник: дерево защищено
    await http().post('/api/dicts/passportPhrases').set(as(admin.access)).send({ name: 'Под листом', parentId: anchor, text: 'x' }).expect(400);
    await http().delete(`/api/dicts/passportPhrases/${mountRoot}`).set(as(admin.access)).expect(409);
    // воронка: категория видит своё и «Для всех»
    const f = (await http().get('/api/passports/funnel').query({ category: 'TRN' }).set(as(manager)).expect(200)).body;
    expect(f.sections.map((s: { section: string }) => s.section)).toEqual(['purpose', 'installation']);
    expect(f.sections[1].children.map((c: { name: string }) => c.name)).toEqual(['Анкерное', 'Бетонирование']);
    const dio = (await http().get('/api/passports/funnel').query({ category: 'DIO' }).set(as(manager)).expect(200)).body;
    expect(dio.sections[1].children.map((c: { name: string }) => c.name)).toEqual(['Только дети']);
    // паспорт: назначение — единственный вариант сам; установка не выбрана → «choice:» блокирует выпуск
    const p = (await http().post('/api/passports').set(as(admin.access)).send({ name: 'Воронка', passportCategory: 'TRN', supplierOrgId: orgId }).expect(201)).body;
    expect(p.purpose).toBe('Для занятий спортом.');
    const card = (await http().get(`/api/passports/${p.id}`).set(as(admin.access)).expect(200)).body;
    expect(card.missingChoices).toEqual([{ label: 'Выбор: Как крепится', key: `choice:${mountRoot}` }]);
    const chk = (await http().post('/api/passports/check').set(as(admin.access)).send({ passportCategory: 'TRN' }).expect(200)).body;
    expect(chk.missing.map((m: { key: string }) => m.key)).toContain(`choice:${mountRoot}`);
    // выбор → текст, производное поле installationMethod и снимок
    await http().patch(`/api/passports/${p.id}`).set(as(admin.access)).send({ textChoices: { [mountRoot]: anchor } }).expect(200);
    const sel = (await http().get(`/api/passports/${p.id}`).set(as(admin.access)).expect(200)).body;
    expect(sel.installationMethod).toBe('Крепится анкерами.');
    expect(sel.textSnapshot.install.text).toBe('Крепится анкерами.');
    expect(sel.textSnapshot.choices).toEqual({ [purposeRoot]: purposeLeaf, [mountRoot]: anchor });
    expect(sel.missingChoices).toBeUndefined();
    await http().patch(`/api/passports/${p.id}`).set(as(admin.access)).send({ textChoices: 'мусор' }).expect(400);
    // правка текста в справочнике → черновик пересобирается при открытии
    await http().patch(`/api/dicts/passportPhrases/${anchor}`).set(as(admin.access)).send({ name: 'Анкерное', text: 'Крепится анкерами М12.' }).expect(200);
    const fresh = (await http().get(`/api/passports/${p.id}`).set(as(admin.access)).expect(200)).body;
    expect(fresh.textSnapshot.install.text).toBe('Крепится анкерами М12.');
    expect(fresh.installationMethod).toBe('Крепится анкерами М12.');
    // «Используется» в справочнике считает выбор
    const row = (await http().get(`/api/dicts/passportPhrases/${anchor}`).set(as(admin.access)).expect(200)).body;
    expect(row.used).toBeGreaterThanOrEqual(1);
    expect(concrete).toBeTruthy();
  });
});
