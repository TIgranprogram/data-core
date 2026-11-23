import request from 'supertest';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { DataVersionService } from '../../src/common/data-version/data-version.service';

describe('C242 — реальные HTTP сортировки/нулевой каталог/область/кэш', () => {
  let ctx: TestContext, admin: string, scoped: string, pipeZone: string, sheetZone: string, woodZone: string;
  const wh = new Types.ObjectId(), pipeCat = new Types.ObjectId(), sheetCat = new Types.ObjectId(), woodCat = new Types.ObjectId();
  const zero = new Types.ObjectId(), round = new Types.ObjectId(), unknown = new Types.ObjectId(), conflict = new Types.ObjectId();
  const normal: Array<{ id: Types.ObjectId; width: number }> = [];
  const sheetIds: string[] = [], woodIds: string[] = [];
  const db = () => ctx.connection.db!;
  const http = () => request(ctx.app.getHttpServer());
  const auth = (token = admin) => authHeader(token);
  const list = async (query: Record<string, unknown>, token = admin) => (await http().get('/api/stock/items').query(query).set(auth(token)).expect(200)).body;
  const ids = (rows: Array<{ id: string }>) => rows.map(row => row.id);
  const dimensions = (values: Record<string, number>) => Object.entries(values).map(([type, value]) => ({ type, value, unit: 'мм' }));

  beforeAll(async () => {
    const target = new URL(process.env.MONGO_URI!);
    if (process.env.MONGO_DB_TEST !== 'datacore-test-c240-c242' || !['localhost', '127.0.0.1'].includes(target.hostname)) throw Error('C242: только выделенная локальная test-БД');
    ctx = await createTestApp({ strictValidation: true });
    admin = (await loginAsAdmin(ctx.app)).access;
    await db().collection('warehouses').insertOne({ _id: wh, name: 'C242 физический склад', type: 'main', isDefault: true, isActive: true, deletedAt: null });
    await db().collection('categories').insertMany([
      { _id: pipeCat, name: 'C242 Трубы', type: 'material', slug: 'c242-pipes', skuPrefix: 'C242P', deletedAt: null },
      { _id: sheetCat, name: 'C242 Листы', type: 'material', slug: 'c242-sheets', skuPrefix: 'C242S', deletedAt: null },
      { _id: woodCat, name: 'C242 Дерево', type: 'material', slug: 'c242-wood', skuPrefix: 'C242W', deletedAt: null },
    ]);
    const materials = Array.from({ length: 120 }, (_, index) => {
      const id = new Types.ObjectId(), width = index + 10; normal.push({ id, width });
      return { _id: id, name: `C242 труба ${String(999 - index).padStart(3, '0')}`, article: `C242-PIPE-${index}`, materialKind: 'purchased', unit: 'м', categoryId: pipeCat,
        assortment: `${width}×40×2`, dimensions: dimensions({ width, height: 40, thickness: 2, length: 6000 }), deletedAt: null };
    });
    await db().collection('materials').insertMany([...materials,
      { _id: zero, name: 'C242 Нулевая труба 80×60×3', article: 'C242-ZERO', materialKind: 'purchased', assortment: '80×60×3', categoryId: pipeCat, unit: 'м', deletedAt: null,
        dimensions: dimensions({ width: 80, height: 60, thickness: 3, length: 6000 }) },
      { _id: round, name: 'C242 Круглая труба', article: 'C242-ROUND', materialKind: 'purchased', categoryId: pipeCat, unit: 'м', deletedAt: null, dimensions: dimensions({ diameter: 30, thickness: 2 }) },
      { _id: unknown, name: 'C242 Неизвестное сечение', article: 'C242-UNKNOWN', materialKind: 'purchased', categoryId: pipeCat, unit: 'м', deletedAt: null },
      { _id: conflict, name: 'C242 Противоречивое сечение', article: 'C242-CONFLICT', materialKind: 'purchased', assortment: '80×60×3', categoryId: pipeCat, unit: 'м', deletedAt: null,
        dimensions: dimensions({ width: 81, height: 60, thickness: 3 }) },
    ]);
    await db().collection('storageitems').insertMany(normal.map((row, index) => ({ _id: new Types.ObjectId(), warehouseId: wh, materialId: row.id,
      quantity: 12, reservedQty: index === 20 ? 12 : 0, minQuantity: 0, isActive: true, deletedAt: null })));
    for (const [categoryId, prefix, result] of [[sheetCat, 'Лист', sheetIds], [woodCat, 'Доска', woodIds]] as const) {
      for (const value of [100, 2, 10]) {
        const id = new Types.ObjectId(); result.push(String(id));
        await db().collection('materials').insertOne({ _id: id, name: `C242 ${prefix} ${value}`, article: `C242-${prefix}-${value}`, materialKind: 'purchased', unit: prefix === 'Лист' ? 'лист' : 'шт', categoryId, deletedAt: null,
          dimensions: dimensions({ width: value, height: value, length: value * 100, thickness: value }) });
      }
    }
    pipeZone = (await http().post('/api/stockzones').set(auth()).send({ name: 'C242 труборез', categoryIds: [String(pipeCat)] }).expect(201)).body.id;
    sheetZone = (await http().post('/api/stockzones').set(auth()).send({ name: 'C242 лист', categoryIds: [String(sheetCat)] }).expect(201)).body.id;
    woodZone = (await http().post('/api/stockzones').set(auth()).send({ name: 'C242 дерево', categoryIds: [String(woodCat)] }).expect(201)).body.id;
    const role = (await http().post('/api/roles').set(auth()).send({ label: 'C242 только трубы', baseRole: 'manager', appSections: ['stock'], warehouseIds: [pipeZone] }).expect(201)).body;
    await http().post('/api/admin/users').set(auth()).send({ username: 'c242-pipe', password: 'c242-test-password', role: role.name }).expect(201);
    scoped = (await http().post('/api/auth/login').send({ username: 'c242-pipe', password: 'c242-test-password' }).expect(200)).body.access;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it.each(['direct', 'batch'])('count %s: stale single→multiple даёт409 и сохраняет обе ячейки/журнал', async mode => {
    const id = new Types.ObjectId();
    await db().collection('materials').insertOne({ _id: id, name: `C242 count ${mode}`, article: `C242-COUNT-${mode}`, categoryId: pipeCat, materialKind: 'purchased', unit: 'м', deletedAt: null });
    await db().collection('storageitems').insertOne({ warehouseId: wh, materialId: id, quantity: 3, reservedQty: 0, zoneName: 'A', deletedAt: null });
    expect((await list({ search: `C242-COUNT-${mode}` })).items.find((row: { id: string }) => row.id === String(id))).toMatchObject({ quantity: 3, countMode: 'single' });
    await db().collection('storageitems').insertOne({ warehouseId: wh, materialId: id, quantity: 2, reservedQty: 0, zoneName: 'B', deletedAt: null });
    expect((await list({ search: `C242-COUNT-${mode}` })).items.find((row: { id: string }) => row.id === String(id))).toMatchObject({ quantity: 5, countMode: 'multiple' });
    const before = await db().collection('storageitems').find({ materialId: id }).sort({ _id: 1 }).toArray();
    const ledger = await db().collection('stockmovements').find({ materialId: id }).toArray();
    const material = await db().collection('materials').findOne({ _id: id });
    const response = mode === 'direct'
      ? await http().post(`/api/stock/items/${id}/move`).set(auth()).send({ type: 'count', qty: 6, expected: 3 }).expect(409)
      : await http().post('/api/stock/batch').set(auth()).send({ type: 'count', lines: [{ materialId: String(id), qty: 6, expected: 3 }] }).expect(409);
    expect(response.body.message).toContain('нескольких ячейках');
    expect(await db().collection('storageitems').find({ materialId: id }).sort({ _id: 1 }).toArray()).toEqual(before);
    expect(await db().collection('stockmovements').find({ materialId: id }).toArray()).toEqual(ledger);
    expect(await db().collection('materials').findOne({ _id: id })).toEqual(material);
    await db().collection('storageitems').deleteMany({ materialId: id });
    await db().collection('materials').deleteOne({ _id: id });
  });

  it('sectionSize сортирует весь HTTP-набор до страниц, priority не перегруппирует размеры; unknown/conflict в конце asc/desc', async () => {
    const expected = [...normal.map(row => ({ id: String(row.id), width: row.width, height: 40 })), { id: String(zero), width: 80, height: 60 }]
      .sort((a, b) => a.width - b.width || a.height - b.height).map(row => row.id);
    for (const descending of [false, true]) {
      const actual: string[] = [];
      for (let page = 1; page <= 8; page++) {
        const response = await list({ zoneId: pipeZone, sort: descending ? '-sectionSize' : 'sectionSize', priority: '1', limit: 17, page });
        expect(response.total).toBe(124); expect(response.page).toBe(page); actual.push(...ids(response.items));
      }
      expect(new Set(actual).size).toBe(124);
      expect(actual.slice(0, 121)).toEqual(descending ? [...expected].reverse() : expected);
      expect(actual[121]).toBe(String(round));
      expect(new Set(actual.slice(-2))).toEqual(new Set([String(unknown), String(conflict)]));
    }
  });

  it('sheetSize/woodSize и отдельные оси сортируют числа 2,10,100 через HTTP-страницы', async () => {
    for (const [zoneId, sort, expected] of [[sheetZone, 'sheetSize', sheetIds], [woodZone, 'woodSize', woodIds]] as const) {
      const one = await list({ zoneId, sort, limit: 1, page: 1 });
      const two = await list({ zoneId, sort, limit: 1, page: 2 });
      const three = await list({ zoneId, sort, limit: 1, page: 3 });
      expect([one, two, three].map(response => response.total)).toEqual([3, 3, 3]);
      expect([one.items[0].id, two.items[0].id, three.items[0].id]).toEqual([expected[1], expected[2], expected[0]]);
    }
    expect((await list({ zoneId: pipeZone, sort: 'width', limit: 1 })).items[0].dims.width).toBe(10);
  });

  it('нулевая 80×60×3 без storageitem доступна поиску/lookup/categories, не создаёт остатки и движения', async () => {
    const storageBefore = await db().collection('storageitems').find({}).sort({ _id: 1 }).toArray();
    const movesBefore = await db().collection('stockmovements').find({}).sort({ _id: 1 }).toArray();
    for (const search of ['80×60×3', '80x60x3', '80х60х3', '80*60*3', '80 60 3']) {
      const result = await list({ zoneId: pipeZone, search, availability: 'none' });
      expect(ids(result.items)).toContain(String(zero));
      expect(result.items.find((row: { id: string }) => row.id === String(zero))).toMatchObject({ quantity: 0, free: 0, storageItemId: null,
        unit: 'м', sectionProfile: { shape: 'rect', widthMm: 80, heightMm: 60, wallMm: 3, state: 'complete' } });
    }
    const lookup = (await http().get('/api/stock/lookup').query({ zoneId: pipeZone }).set(auth()).expect(200)).body;
    expect(ids(lookup.items)).toContain(String(zero));
    const categories = (await http().get('/api/stock/categories').query({ zoneId: pipeZone }).set(auth()).expect(200)).body.items;
    expect(categories.find((row: { id: string }) => row.id === String(pipeCat))).toMatchObject({ total: 124, none: 4 });
    expect(await db().collection('storageitems').find({}).sort({ _id: 1 }).toArray()).toEqual(storageBefore);
    expect(await db().collection('stockmovements').find({}).sort({ _id: 1 }).toArray()).toEqual(movesBefore);
  });

  it('availability — физическое наличие, counts прежние; held/status/search/zone сочетаются по AND', async () => {
    const all = await list({ zoneId: pipeZone });
    const none = await list({ zoneId: pipeZone, availability: 'none' });
    const positive = await list({ zoneId: pipeZone, availability: 'in' });
    expect([all.total, none.total, positive.total]).toEqual([124, 4, 120]);
    expect(none.counts).toEqual(all.counts); expect(positive.counts).toEqual(all.counts);
    expect(positive.items.find((row: { id: string }) => row.id === String(normal[20].id))).toMatchObject({ quantity: 12, reservedQty: 12, free: 0 });
    for (const query of [{ held: '1', availability: 'none' }, { status: 'reserved', availability: 'none' }, { status: 'none', availability: 'in' }]) {
      expect((await list({ zoneId: pipeZone, ...query })).total).toBe(0);
    }
    expect((await list({ zoneId: pipeZone, status: 'reserved', availability: 'in' })).total).toBe(1);
    expect(ids((await list({ zoneId: pipeZone, held: '1' })).items)).toHaveLength(120);
  });

  it('invalid/empty availability даёт 400, новые нули не расширяют warehouse/category scope', async () => {
    for (const availability of ['', 'all', '0', 'NONE']) await http().get('/api/stock/items').query({ availability }).set(auth()).expect(400);
    await http().get('/api/stock/items?availability=in&availability=none').set(auth()).expect(400);
    const own = await list({ sort: 'sectionSize', availability: 'none' }, scoped);
    expect(ids(own.items)).toContain(String(zero)); expect(own.total).toBe(4);
    expect((await list({ categoryId: String(sheetCat) }, scoped)).total).toBe(0);
    await http().get('/api/stock/items').query({ zoneId: sheetZone }).set(auth(scoped)).expect(403);
    const lookup = (await http().get('/api/stock/lookup').set(auth(scoped)).expect(200)).body.items;
    expect(ids(lookup).some(id => sheetIds.includes(id))).toBe(false);
  });

  it('реальный change-stream cache переиспользуется, но sort/availability/scope не мутируют общий набор', async () => {
    const versions = ctx.app.get(DataVersionService);
    const env = { node: process.env.NODE_ENV, cache: process.env.DATA_VERSION_CACHE };
    try { process.env.NODE_ENV = 'development'; delete process.env.DATA_VERSION_CACHE; versions.onApplicationBootstrap(); }
    finally { process.env.NODE_ENV = env.node; if (env.cache === undefined) delete process.env.DATA_VERSION_CACHE; else process.env.DATA_VERSION_CACHE = env.cache; }
    const until = Date.now() + 6000;
    while (!versions.snapshot({ stock: ['materials', 'storageitems'] }).live && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
    expect(versions.snapshot({ stock: ['materials', 'storageitems'] }).live).toBe(true);
    const cached = jest.spyOn(versions, 'cached');
    try {
      const before = await list({ sort: 'name', limit: 1000 });
      const promise = cached.mock.results[0].value;
      const rows = await promise, snapshot = JSON.stringify(rows);
      await list({ sort: '-sectionSize', availability: 'none', limit: 17 });
      await list({ sort: 'sectionSize', availability: 'in', limit: 17 }, scoped);
      expect(cached.mock.results.at(-1)!.value).toBe(promise);
      expect(JSON.stringify(await promise)).toBe(snapshot);
      const repeated = await list({ sort: 'name', limit: 1000 });
      expect(repeated.items).toEqual(before.items); expect(repeated.counts).toEqual(before.counts);
    } finally { cached.mockRestore(); }
  });
});
