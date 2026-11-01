import request from 'supertest';
import { DiscoveryService } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { STOCK_SCOPED_KEY } from '../../src/common/decorators/stock-scoped.decorator';

const FOREIGN_ITEM = 'ЧУЖАЯ-ПОЗИЦИЯ-Б';
const FOREIGN_CAT = 'ЧУЖАЯ-КАТЕГОРИЯ-Б';

/** GET-маршруты, которые не отдают позиции склада: видны всем, фильтр не нужен (причина — рядом). */
const EXEMPT = new Set([
  'GET stock/warehouses',            // физические склады CRM, не позиции
  'GET stock/zones',                 // собственный список складов пользователя
  'GET supply/catalog/template',     // пустой шаблон Excel
]);
/** Контроллеры, чьи GET обязаны применять склады (путь контроллера). */
const WATCHED = ['stock', 'supply', 'materials', 'categories'];

/** Склады-зоны (WZ): справочник, доступ ролей, запись по чужой позиции, обход всех GET-маршрутов ролью «Основной». */
describe('Склады-зоны (WZ)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  const names = (b: { items: Array<{ name?: string }> }) => b.items.map((x) => x.name);
  let tokMain = '', tokBoth = '';
  let zMain = '', zPipe = '';
  let itemA = '', itemB = '', itemC = '', catA = '', catB = '', reqB = '';

  const mkUser = async (key: string, role: string) => {
    const username = `wz-${key}-${Date.now()}`;
    await http().post('/api/admin/users').set(as(admin.access)).send({ username, password: 'role-pass-123', role }).expect(201);
    return (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access as string;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    const t = as(admin.access);
    itemA = (await http().post('/api/stock/items').set(t).send({ name: 'Позиция А основной', unit: 'шт', categoryName: 'Зона Основная' }).expect(201)).body.id;
    itemB = (await http().post('/api/stock/items').set(t).send({ name: FOREIGN_ITEM, unit: 'шт', categoryName: FOREIGN_CAT }).expect(201)).body.id;
    itemC = (await http().post('/api/stock/items').set(t).send({ name: 'Позиция без категории', unit: 'шт' }).expect(201)).body.id;
    await http().post('/api/stock/batch').set(t).send({ type: 'in', lines: [{ materialId: itemA, qty: 10 }, { materialId: itemB, qty: 10 }, { materialId: itemC, qty: 10 }] }).expect(201);
    const cats = (await http().get('/api/stock/categories').set(t).expect(200)).body.items as Array<{ id: string; name: string }>;
    catA = cats.find((c) => c.name === 'Зона Основная')!.id;
    catB = cats.find((c) => c.name === FOREIGN_CAT)!.id;
    zMain = (await http().post('/api/stockzones').set(t).send({ name: 'Основной', categoryIds: [catA], isDefault: true }).expect(201)).body.id;
    zPipe = (await http().post('/api/stockzones').set(t).send({ name: 'Труба', categoryIds: [catB] }).expect(201)).body.id;
    reqB = (await http().post('/api/supply/requests').set(t).send({ title: 'Заявка на ' + FOREIGN_ITEM, qty: 1, unit: 'шт', materialId: itemB }).expect(201)).body.id;
    await http().post('/api/supply/requests').set(t).send({ title: 'Заявка на позицию А', qty: 1, unit: 'шт', materialId: itemA }).expect(201);
    await http().post('/api/stock/reserve-list').set(t).send({ groupName: 'Бронь Б', lines: [{ materialId: itemB, qty: 2 }] }).expect(201);
    await http().post('/api/stock/reserve-list').set(t).send({ groupName: 'Бронь А', lines: [{ materialId: itemA, qty: 1 }] }).expect(201);
    const main = (await http().post('/api/roles').set(t).send({ label: 'Кладовщик Основной', baseRole: 'manager', warehouseIds: [zMain] }).expect(201)).body;
    const both = (await http().post('/api/roles').set(t).send({ label: 'Кладовщик Оба', baseRole: 'manager', warehouseIds: [zMain, zPipe] }).expect(201)).body;
    tokMain = await mkUser('main', main.name);
    tokBoth = await mkUser('both', both.name);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('справочник: только admin; имя уникально; «Основной» не удалить; склад из роли не удалить', async () => {
    await http().get('/api/stockzones').set(as(tokMain)).expect(403);
    await http().post('/api/stockzones').set(as(tokMain)).send({ name: 'Левый' }).expect(403);
    const list = (await http().get('/api/stockzones').set(as(admin.access)).expect(200)).body;
    expect(names(list)).toEqual(['Основной', 'Труба']);
    await http().post('/api/stockzones').set(as(admin.access)).send({ name: 'труба' }).expect(409);
    await http().patch(`/api/stockzones/${zMain}`).set(as(admin.access)).send({ isDefault: false }).expect(400);
    await http().delete(`/api/stockzones/${zMain}`).set(as(admin.access)).expect(409);
    await http().delete(`/api/stockzones/${zPipe}`).set(as(admin.access)).expect(409); // выбран в роли
    await http().post('/api/stockzones').set(as(admin.access)).send({ name: 'Битый', categoryIds: [itemA] }).expect(400); // не категория
    await http().post('/api/stockzones').set(as(admin.access)).send({ name: 'Битый', categoryIds: ['не-id'] }).expect(400);
    const tmp = (await http().post('/api/stockzones').set(as(admin.access)).send({ name: 'Временный', includeMaterialIds: [itemA], excludeMaterialIds: [itemA] }).expect(400)).body;
    expect(JSON.stringify(tmp)).toContain('и в добавках, и в исключениях');
  });

  it('GET /stock/zones: роль — свои склады, admin — все', async () => {
    expect(names((await http().get('/api/stock/zones').set(as(tokMain)).expect(200)).body)).toEqual(['Основной']);
    expect(names((await http().get('/api/stock/zones').set(as(tokBoth)).expect(200)).body)).toEqual(['Основной', 'Труба']);
    expect(names((await http().get('/api/stock/zones').set(as(admin.access)).expect(200)).body)).toEqual(['Основной', 'Труба']);
  });

  it('«Основной»: свои + без категории; чужое не видно ни в списках, ни по id', async () => {
    const m = as(tokMain);
    expect(names((await http().get('/api/stock/items').set(m).expect(200)).body).sort()).toEqual(['Позиция А основной', 'Позиция без категории']);
    const lk = (await http().get('/api/stock/lookup').set(m).expect(200)).body;
    expect(JSON.stringify(lk)).not.toContain(FOREIGN_ITEM);
    expect(JSON.stringify((await http().get('/api/stock/categories').set(m).expect(200)).body)).not.toContain(FOREIGN_CAT);
    expect(JSON.stringify((await http().get('/api/stock/movements').query({ limit: 200 }).set(m).expect(200)).body)).not.toContain(FOREIGN_ITEM);
    const rs = JSON.stringify((await http().get('/api/stock/reservations').set(m).expect(200)).body);
    expect(rs).toContain('Позиция А основной');
    expect(rs).not.toContain(FOREIGN_ITEM);
    await http().get(`/api/stock/items/${itemB}`).set(m).expect(404);
    await http().get(`/api/stock/items/${itemB}/history`).set(m).expect(403);
    await http().get(`/api/stock/items/${itemB}/ordered`).set(m).expect(403);
    await http().get(`/api/materials/${itemB}`).set(m).expect(403);
    expect(JSON.stringify((await http().get('/api/materials').query({ limit: 100 }).set(m).expect(200)).body)).not.toContain(FOREIGN_ITEM);
    const tree = JSON.stringify((await http().get('/api/categories').query({ type: 'material' }).set(m).expect(200)).body);
    expect(tree).toContain('Зона Основная');
    expect(tree).not.toContain(FOREIGN_CAT);
    await http().get(`/api/categories/${catB}`).set(m).expect(404);
    // заявки снабжения
    const sr = JSON.stringify((await http().get('/api/supply/requests').set(m).expect(200)).body);
    expect(sr).toContain('Заявка на позицию А');
    expect(sr).not.toContain(FOREIGN_ITEM);
    await http().get(`/api/supply/requests/${reqB}`).set(m).expect(403);
    expect(JSON.stringify((await http().get('/api/supply/requests/lookup').set(m).expect(200)).body)).not.toContain(FOREIGN_ITEM);
    expect(JSON.stringify((await http().get('/api/supply/lookups').set(m).expect(200)).body)).not.toContain(FOREIGN_CAT);
  });

  it('запись по чужой позиции — 403 (приход, правка, обрезок, фото, заявка, бронь), по своей — можно', async () => {
    const m = as(tokMain);
    await http().post('/api/stock/batch').set(m).send({ type: 'in', lines: [{ materialId: itemB, qty: 1 }] }).expect(403);
    await http().post(`/api/stock/items/${itemB}/move`).set(m).send({ type: 'in', qty: 1 }).expect(403);
    await http().patch(`/api/stock/items/${itemB}`).set(m).send({ note: 'x' }).expect(403);
    await http().post(`/api/stock/items/${itemB}/photos`).set(m).send({ photoId: itemA }).expect(403);
    await http().post('/api/stock/reserve-list').set(m).send({ groupName: 'чужая', lines: [{ materialId: itemB, qty: 1 }] }).expect(403);
    await http().post('/api/stock/items').set(m).send({ name: FOREIGN_ITEM, unit: 'шт' }).expect(403); // то же имя — не обход
    await http().post('/api/stock/items').set(m).send({ name: 'Новая в чужой', unit: 'шт', categoryId: catB }).expect(403);
    await http().patch(`/api/materials/${itemB}`).set(m).send({ notes: 'x' }).expect(403);
    await http().patch(`/api/supply/requests/${reqB}`).set(m).send({ notes: 'x' }).expect(403);
    await http().delete(`/api/supply/requests/${reqB}`).set(m).expect(403);
    await http().post('/api/supply/requests').set(m).send({ title: 'Подмена', qty: 1, materialId: itemB }).expect(403);
    await http().post('/api/stock/batch').set(m).send({ type: 'in', lines: [{ materialId: itemA, qty: 1 }, { materialId: itemC, qty: 1 }] }).expect(201);
    // позиция без категории — только «Основному»: «Труба»-только роль её не меняет
    const pipeOnly = (await http().post('/api/roles').set(as(admin.access)).send({ label: 'Только труба', baseRole: 'manager', warehouseIds: [zPipe] }).expect(201)).body;
    const tp = await mkUser('pipe', pipeOnly.name);
    await http().post('/api/stock/batch').set(as(tp)).send({ type: 'in', lines: [{ materialId: itemC, qty: 1 }] }).expect(403);
    await http().post('/api/stock/batch').set(as(tp)).send({ type: 'in', lines: [{ materialId: itemB, qty: 1 }] }).expect(201);
  });

  it('переключатель zoneId: свой склад сужает, чужой — 403, admin — любой', async () => {
    const b = as(tokBoth);
    expect(names((await http().get('/api/stock/items').set(b).expect(200)).body)).toContain(FOREIGN_ITEM);
    expect(names((await http().get('/api/stock/items').query({ zoneId: zPipe }).set(b).expect(200)).body)).toEqual([FOREIGN_ITEM]);
    await http().get('/api/stock/items').query({ zoneId: zPipe }).set(as(tokMain)).expect(403);
    expect(names((await http().get('/api/stock/items').query({ zoneId: zPipe }).set(as(admin.access)).expect(200)).body)).toEqual([FOREIGN_ITEM]);
    await http().get('/api/stock/items').query({ zoneId: '000000000000000000000000' }).set(as(admin.access)).expect(400);
  });

  it('добавка и исключение поштучно; подкатегория входит сама', async () => {
    const t = as(admin.access);
    const m = as(tokMain);
    await http().patch(`/api/stockzones/${zMain}`).set(t).send({ includeMaterialIds: [itemB], excludeMaterialIds: [itemA] }).expect(200);
    expect(names((await http().get('/api/stock/items').set(m).expect(200)).body).sort()).toEqual([FOREIGN_ITEM, 'Позиция без категории'].sort());
    await http().post(`/api/stock/items/${itemA}/move`).set(m).send({ type: 'in', qty: 1 }).expect(403);
    await http().post(`/api/stock/items/${itemB}/move`).set(m).send({ type: 'in', qty: 1 }).expect(201);
    await http().patch(`/api/stockzones/${zMain}`).set(t).send({ includeMaterialIds: [], excludeMaterialIds: [] }).expect(200);
    const kid = (await http().post('/api/categories').set(t).send({ name: 'Подкатегория Основной', slug: 'wz-kid', type: 'material', parentId: catA, skuPrefix: 'WZK' }).expect(201)).body.id;
    const itemK = (await http().post('/api/stock/items').set(t).send({ name: 'Позиция подкатегории', unit: 'шт', categoryId: kid }).expect(201)).body.id;
    expect(itemK).toBeTruthy();
    // дерево обновляется по таймеру; правка склада перечитывает его сразу
    await http().patch(`/api/stockzones/${zMain}`).set(t).send({ order: 5 }).expect(200);
    expect(names((await http().get('/api/stock/items').set(m).expect(200)).body)).toContain('Позиция подкатегории');
  });

  it('перечень: каждый GET-маршрут stock/supply/materials/categories применяет склады или назван исключением', () => {
    const missing = getRoutes().filter((r) => !r.scoped && !EXEMPT.has(`GET ${r.path}`)).map((r) => `GET ${r.path}`);
    expect(missing).toEqual([]); // новый маршрут без @StockScoped() роняет тест
  });

  it('обход ВСЕХ GET-маршрутов ролью «Основной»: ни имени, ни id чужой позиции и категории', async () => {
    // вернуть исходные зоны: «Основной» = только catA
    await http().patch(`/api/stockzones/${zMain}`).set(as(admin.access)).send({ includeMaterialIds: [], excludeMaterialIds: [] }).expect(200);
    const m = as(tokMain);
    const sub: Record<string, string> = { stock: itemB, materials: itemB, categories: catB, supply: reqB };
    const routes = getRoutes();
    expect(routes.length).toBeGreaterThan(30);
    const leaks: string[] = [];
    for (const r of routes) {
      const root = r.path.split('/')[0];
      const url = '/api/' + r.path.replace(/:\w+/g, sub[root] ?? itemB);
      const res = await http().get(url).set(m);
      expect(res.status).toBeLessThan(500);
      const body = res.body && Object.keys(res.body).length ? JSON.stringify(res.body) : String(res.text ?? '');
      const ok2xx = res.status < 300;
      if (body.includes(FOREIGN_ITEM) || body.includes(FOREIGN_CAT) || (ok2xx && (body.includes(itemB) || body.includes(catB) || body.includes(reqB)))) leaks.push(`${res.status} ${url}`);
    }
    expect(leaks).toEqual([]);
  });

  /** Все GET-обработчики наблюдаемых контроллеров из реестра Nest: путь + метка @StockScoped(). */
  function getRoutes(): Array<{ path: string; scoped: boolean }> {
    const out: Array<{ path: string; scoped: boolean }> = [];
    for (const w of app.get(DiscoveryService).getControllers()) {
      const type = w.metatype as (new (...a: never[]) => object) | null;
      if (!type) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, type) ?? '').replace(/^\/|\/$/g, '');
      if (!WATCHED.includes(base)) continue;
      for (const key of Object.getOwnPropertyNames(type.prototype)) {
        const handler = (type.prototype as Record<string, unknown>)[key];
        if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) !== RequestMethod.GET) continue;
        const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '').replace(/^\/|\/$/g, '');
        out.push({ path: [base, sub].filter(Boolean).join('/'), scoped: Reflect.getMetadata(STOCK_SCOPED_KEY, handler) === true });
      }
    }
    return out;
  }
});
