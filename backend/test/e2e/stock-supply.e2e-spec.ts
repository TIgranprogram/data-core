import request from 'supertest';
import { Types } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * /api/stock и /api/supply — склад и снабжение на ОБЩИХ коллекциях CRM kppdf
 * (materials, storageitems, stockmovements, reservations, supplyrequests, organizations).
 * Проверяем, что данные ложатся именно туда и в той форме, которую читает CRM.
 */
describe('Stock & supply on shared CRM collections', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  let boltId = '';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['materials', 'storageitems', 'stockmovements', 'reservations', 'supplyrequests', 'organizations', 'warehouses']) await db().collection(c).deleteMany({});
    await db().collection('warehouses').insertOne({ name: 'Главный склад', type: 'main', isActive: true, isDefault: false, deletedAt: null, createdAt: new Date() });
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('без входа — 401', async () => {
    await http().get('/api/stock/items').expect(401);
  });

  it('новая позиция: материал с автоартикулом + строка остатка на складе по умолчанию', async () => {
    const r = await http().post('/api/stock/items').set(auth()).send({ name: 'Болт М8×30', unit: 'шт', categoryName: 'Метизы', minQuantity: 10 }).expect(201);
    boltId = r.body.id;
    expect(r.body).toMatchObject({ name: 'Болт М8×30', unit: 'шт', categoryName: 'Метизы', quantity: 0, minQuantity: 10 });
    expect(r.body.article).toMatch(/^СКЛ-\d{4}-\d{3}$/);
    const wh = await db().collection('warehouses').findOne({ name: 'Главный склад' });
    expect(wh!.isDefault).toBe(true);
    const cat = await db().collection('categories').findOne({ name: 'Метизы' });
    expect(cat).toMatchObject({ type: 'material' });
    expect(r.body.sku).toMatch(new RegExp(`^${cat!.skuPrefix}-`));
    // То же наименование другим регистром — та же позиция
    const again = await http().post('/api/stock/items').set(auth()).send({ name: '  болт м8×30 ' }).expect(201);
    expect(again.body.id).toBe(boltId);
  });

  it('приход / бронь / списание / снятие брони / корректировка — как в CRM', async () => {
    const mv = (body: object) => http().post(`/api/stock/items/${boltId}/move`).set(auth()).send(body);
    expect((await mv({ type: 'in', qty: 50, note: 'Поставка', clientUid: 'u-in-1' }).expect(201)).body).toMatchObject({ quantity: 50, reservedQty: 0, free: 50 });
    // повтор той же операции (офлайн-очередь) — без изменений
    expect((await mv({ type: 'in', qty: 50, clientUid: 'u-in-1' }).expect(201)).body.quantity).toBe(50);
    expect((await mv({ type: 'reserve', qty: 20, note: 'Заказ 15' }).expect(201)).body).toMatchObject({ quantity: 50, reservedQty: 20, free: 30 });
    expect((await mv({ type: 'out', qty: 5 }).expect(201)).body).toMatchObject({ quantity: 45, reservedQty: 15 });
    expect((await mv({ type: 'unreserve', qty: 5 }).expect(201)).body.reservedQty).toBe(10);
    expect((await mv({ type: 'adjust', qty: -3, note: 'пересчёт' }).expect(201)).body.quantity).toBe(42);
    await mv({ type: 'out', qty: 1000 }).expect(400);
    await mv({ type: 'reserve', qty: 1000 }).expect(400);

    const si = await db().collection('storageitems').findOne({});
    expect(si).toMatchObject({ quantity: 42, reservedQty: 10 });
    const types = (await db().collection('stockmovements').find({}).toArray()).map((m) => m.type).sort();
    expect(types).toEqual(['adjust', 'in', 'out']);
    const hist = await http().get(`/api/stock/items/${boltId}/history`).set(auth()).expect(200);
    expect(hist.body.items.length).toBe(5);
  });

  it('заявка: поставщик и наша компания становятся организациями (без дублей), статус — подписью', async () => {
    const a = await http().post('/api/supply/requests').set(auth()).send({ title: 'Гайка М8', qty: 100, unit: 'шт', supplierName: 'ООО «Крепёж»', companyName: 'СИЮ', statusLabel: '💰 Оплачено', priorityLabel: 'Срочно', clientUid: 'req-1' }).expect(201);
    expect(a.body).toMatchObject({ title: 'Гайка М8', status: 'ordered', paid: true, priority: 'urgent', statusLabel: '💰 Оплачено', supplierName: 'ООО «Крепёж»', companyName: 'СИЮ', num: 1 });
    // повтор с тем же clientUid — та же заявка
    const dup = await http().post('/api/supply/requests').set(auth()).send({ title: 'Гайка М8', clientUid: 'req-1' }).expect(201);
    expect(dup.body.id).toBe(a.body.id);
    await http().post('/api/supply/requests').set(auth()).send({ title: 'Шайба', supplierName: 'ооо «крепёж»' }).expect(201);
    const orgs = await db().collection('organizations').find({}).toArray();
    expect(orgs).toHaveLength(2);
    expect(orgs.find((o) => o.name === 'ООО «Крепёж»')).toMatchObject({ type: ['supplier'], isOurCompany: false });
    expect(orgs.find((o) => o.name === 'СИЮ')).toMatchObject({ isOurCompany: true });
    expect(await db().collection('supplyrequests').countDocuments({})).toBe(2);
  });

  it('оприходование: позиция заводится по наименованию, приход на склад, статус «Получено»', async () => {
    const list = await http().get('/api/supply/requests').set(auth()).expect(200);
    const req = list.body.items.find((r: { title: string }) => r.title === 'Гайка М8');
    const r = await http().post(`/api/supply/requests/${req.id}/receive`).set(auth()).send({ qty: 100 }).expect(200);
    expect(r.body).toMatchObject({ status: 'received', receivedQty: 100, statusLabel: '☑️ Получено', materialName: 'Гайка М8' });
    const items = await http().get('/api/stock/items?search=гайка').set(auth()).expect(200);
    expect(items.body.items[0]).toMatchObject({ name: 'Гайка М8', quantity: 100 });
    await http().post(`/api/supply/requests/${req.id}/receive`).set(auth()).send({ qty: 100 }).expect(409);
    const mv = await db().collection('stockmovements').findOne({ documentRef: `SupplyRequest:${req.id}` });
    expect(mv).toMatchObject({ type: 'in', qty: 100 });
  });

  it('подсказки формы: поставщики, наши компании, категории', async () => {
    const r = await http().get('/api/supply/lookups').set(auth()).expect(200);
    expect(r.body.suppliers).toContain('ООО «Крепёж»');
    expect(r.body.companies).toContain('СИЮ');
    expect(r.body.categories.map((c: { name: string }) => c.name)).toContain('Метизы');
    expect(r.body.supplierRefs.find((s: { name: string }) => s.name === 'ООО «Крепёж»').id).toMatch(/^[0-9a-f]{24}$/);
  });

  // ---------- «Рабочее место» (CANON §4): страницы, сортировка, фильтры, корзина, отмена движений ----------

  it('список заявок: страницы, сортировка, фильтр по статусу и поставщику, сумма и счётчики', async () => {
    for (let i = 1; i <= 3; i++) await http().post('/api/supply/requests').set(auth()).send({ title: `Саморез ${i}`, qty: i, priceHint: i * 100, statusLabel: i === 3 ? 'Отменено' : 'Заказать' }).expect(201);
    const all = await http().get('/api/supply/requests?limit=2&sort=num').set(auth()).expect(200);
    expect(all.body).toMatchObject({ total: 5, page: 1, limit: 2 });
    expect(all.body.items.map((r: { num: number }) => r.num)).toEqual([1, 2]);
    expect(all.body.counts).toMatchObject({ all: 5, cancelled: 1, received: 1 });
    const p2 = await http().get('/api/supply/requests?limit=2&page=2&sort=-num').set(auth()).expect(200);
    expect(p2.body.items.map((r: { num: number }) => r.num)).toEqual([3, 2]);
    const req = await http().get('/api/supply/requests?status=requested&search=саморез').set(auth()).expect(200);
    expect(req.body).toMatchObject({ total: 2, sum: 300 });
    expect(req.body.counts.cancelled).toBe(1); // счётчики — без учёта самого фильтра статуса
    const lk = await http().get('/api/supply/lookups').set(auth()).expect(200);
    const sup = lk.body.supplierRefs.find((s: { name: string }) => s.name === 'ООО «Крепёж»').id;
    expect((await http().get(`/api/supply/requests?supplierId=${sup}`).set(auth()).expect(200)).body.total).toBe(2);
    expect((await http().get('/api/supply/requests?search=№1').set(auth()).expect(200)).body.items[0].num).toBe(1);
    await http().get('/api/supply/requests?sort=password').set(auth()).expect(400);
    await http().get('/api/supply/requests?from=вчера').set(auth()).expect(400);
  });

  it('заявка: удалить → нет в списке, есть в корзине → восстановить; история изменений видна', async () => {
    const r = await http().post('/api/supply/requests').set(auth()).send({ title: 'Удаляемая', qty: 1 }).expect(201);
    await http().delete(`/api/supply/requests/${r.body.id}`).set(auth()).expect(200);
    await http().get(`/api/supply/requests/${r.body.id}`).set(auth()).expect(404);
    expect((await http().get('/api/supply/requests?search=Удаляемая').set(auth()).expect(200)).body.total).toBe(0);
    const trash = await http().get('/api/supply/requests?deleted=1').set(auth()).expect(200);
    expect(trash.body.items.map((x: { id: string }) => x.id)).toContain(r.body.id);
    await http().delete(`/api/supply/requests/${r.body.id}`).set(auth()).expect(404);
    expect((await http().post(`/api/supply/requests/${r.body.id}/restore`).set(auth()).expect(200)).body.title).toBe('Удаляемая');
    await http().post(`/api/supply/requests/${r.body.id}/restore`).set(auth()).expect(404);
    const hist = await http().get(`/api/audit-logs/record?entityType=SupplyRequest&entityId=${r.body.id}`).set(auth()).expect(200);
    expect(hist.body.items.map((x: { action: string }) => x.action).sort()).toEqual(['supply.request.created', 'supply.request.deleted', 'supply.request.restored']);
    await http().get(`/api/audit-logs/record?entityType=User&entityId=${r.body.id}`).set(auth()).expect(400);
  });

  it('фото заявки: при создании, замена списком при правке, добавить / убрать; своё фото — главное', async () => {
    const [p1, p2, p3] = await Promise.all(['a', 'b', 'c'].map(async (n) => (await db().collection('photos').insertOne({ storageUrl: `/uploads/${n}.jpg`, createdAt: new Date() })).insertedId));
    await db().collection('photos').insertOne({ storageUrl: '/uploads/a-thumb.webp', parentPhotoId: p1, variant: 'thumb' });
    const ids = (b: { photos: Array<{ id: string }> }) => b.photos.map((p) => p.id);
    const r = await http().post('/api/supply/requests').set(auth()).send({ title: 'С фото', qty: 1, photoIds: [String(p1), String(p2)] }).expect(201);
    expect(ids(r.body)).toEqual([String(p1), String(p2)]);
    expect(r.body.photo).toEqual({ url: '/uploads/a.jpg', thumb: '/uploads/a-thumb.webp' });
    // поле вне схемы CRM — лежит в коллекции
    expect((await db().collection('supplyrequests').findOne({ _id: new Types.ObjectId(r.body.id) }))!.photoIds.map(String)).toEqual([String(p1), String(p2)]);
    // правка: весь список (порядок и состав); без photoIds — фото не трогаются
    expect(ids((await http().patch(`/api/supply/requests/${r.body.id}`).set(auth()).send({ photoIds: [String(p2)] }).expect(200)).body)).toEqual([String(p2)]);
    expect(ids((await http().patch(`/api/supply/requests/${r.body.id}`).set(auth()).send({ notes: 'x' }).expect(200)).body)).toEqual([String(p2)]);
    // карточка: добавить / убрать
    expect(ids((await http().post(`/api/supply/requests/${r.body.id}/photos`).set(auth()).send({ photoId: String(p3) }).expect(200)).body)).toEqual([String(p2), String(p3)]);
    const del = await http().delete(`/api/supply/requests/${r.body.id}/photos/${p2}`).set(auth()).expect(200);
    expect(ids(del.body)).toEqual([String(p3)]);
    expect(del.body.photo.url).toBe('/uploads/c.jpg');
    // своё фото важнее фото позиции склада; убрали все — снова фото позиции
    const matPhoto = (await db().collection('photos').insertOne({ storageUrl: '/uploads/mat.jpg' })).insertedId;
    await db().collection('materials').updateOne({ _id: new Types.ObjectId(boltId) }, { $set: { mainPhotoId: matPhoto } });
    const linked = await http().patch(`/api/supply/requests/${r.body.id}`).set(auth()).send({ materialId: boltId }).expect(200);
    expect(linked.body.photo.url).toBe('/uploads/c.jpg');
    expect(linked.body.materialPhoto.url).toBe('/uploads/mat.jpg');
    const cleared = await http().patch(`/api/supply/requests/${r.body.id}`).set(auth()).send({ photoIds: [] }).expect(200);
    expect(cleared.body.photos).toEqual([]);
    expect(cleared.body.photo.url).toBe('/uploads/mat.jpg');
    // незагруженное фото — 404 и заявка не создаётся; мусорный id — 400
    await http().post('/api/supply/requests').set(auth()).send({ title: 'Без файла', photoIds: [String(new Types.ObjectId())] }).expect(404);
    expect(await db().collection('supplyrequests').countDocuments({ title: 'Без файла' })).toBe(0);
    await http().post(`/api/supply/requests/${r.body.id}/photos`).set(auth()).send({ photoId: 'xx' }).expect(400);
    const hist = await http().get(`/api/audit-logs/record?entityType=SupplyRequest&entityId=${r.body.id}`).set(auth()).expect(200);
    expect(hist.body.items.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(['supply.request.photo.added', 'supply.request.photo.removed']));
  });

  it('позиция склада: с остатком не удаляется (409 с причиной), пустая — в корзину и обратно; фильтр/сортировка/счётчики', async () => {
    const del = await http().delete(`/api/stock/items/${boltId}`).set(auth()).expect(409);
    expect(del.body.message).toContain('остаток 42');
    const empty = await http().post('/api/stock/items').set(auth()).send({ name: 'Пустая позиция', minQuantity: 5 }).expect(201);
    const list = await http().get('/api/stock/items?status=none&sort=-name').set(auth()).expect(200);
    expect(list.body.items.map((i: { name: string }) => i.name)).toContain('Пустая позиция');
    expect(list.body.counts.all).toBeGreaterThanOrEqual(3);
    const byQty = await http().get('/api/stock/items?sort=-quantity&limit=1').set(auth()).expect(200);
    expect(byQty.body.items[0]).toMatchObject({ name: 'Гайка М8', quantity: 100 });
    await http().delete(`/api/stock/items/${empty.body.id}`).set(auth()).expect(200);
    expect((await http().get('/api/stock/items?search=Пустая').set(auth()).expect(200)).body.total).toBe(0);
    expect((await http().get('/api/stock/items?deleted=1').set(auth()).expect(200)).body.items.map((i: { id: string }) => i.id)).toContain(empty.body.id);
    expect((await http().post(`/api/stock/items/${empty.body.id}/restore`).set(auth()).expect(200)).body).toMatchObject({ name: 'Пустая позиция', minQuantity: 5 });
    // сводка по категориям (плитки склада)
    const cats = await http().get('/api/stock/categories').set(auth()).expect(200);
    expect(cats.body.items.find((c: { name: string }) => c.name === 'Метизы')).toMatchObject({ total: 1, low: 0, none: 0 });
    expect(cats.body.items.find((c: { id: string }) => c.id === 'none')).toMatchObject({ name: 'Без категории', none: 1 });
  });

  it('журнал движений: все позиции, фильтры; отмена = обратное движение, повторно нельзя', async () => {
    const all = await http().get('/api/stock/movements?limit=50').set(auth()).expect(200);
    expect(all.body.total).toBe(4); // in, out, adjust по болту + приход по заявке
    const adj = all.body.items.find((m: { type: string }) => m.type === 'adjust');
    expect(adj).toMatchObject({ delta: -3, materialName: 'Болт М8×30', canCancel: true });
    const ins = await http().get(`/api/stock/movements?type=in&materialId=${boltId}`).set(auth()).expect(200);
    expect(ins.body.total).toBe(1);
    // отменить корректировку −3 → остаток 42 + 3 = 45
    const after = await http().post(`/api/stock/movements/${adj.id}/cancel`).set(auth()).expect(200);
    expect(after.body.quantity).toBe(45);
    await http().post(`/api/stock/movements/${adj.id}/cancel`).set(auth()).expect(409);
    const fresh = await http().get('/api/stock/movements?search=отмена').set(auth()).expect(200);
    expect(fresh.body.items[0]).toMatchObject({ cancelOf: adj.id, canCancel: false, delta: 3 });
    // запись истории из Google-таблицы не отменяется
    const sheet = await db().collection('stockmovements').insertOne({ type: 'in', qty: 1, materialId: new Types.ObjectId(boltId), warehouseId: (await db().collection('warehouses').findOne({}))!._id, date: new Date(), source: 'google-sheets', deletedAt: null });
    expect((await http().post(`/api/stock/movements/${sheet.insertedId}/cancel`).set(auth()).expect(409)).body.message).toContain('Google-таблицы');
  });
  it('«Операции»: умный поиск (м10 → M10), пакет прихода/списания/пересчёта, отмена пакета целиком', async () => {
    const nut = (await http().post('/api/stock/items').set(auth()).send({ name: 'Гайка шестигр., M10, DIN 934', unit: 'шт', categoryName: 'Метизы' }).expect(201)).body;
    const bolt = (await http().post('/api/stock/items').set(auth()).send({ name: 'Болт с шестигр. головкой, M10х100, DIN 933', unit: 'шт', categoryName: 'Метизы' }).expect(201)).body;
    // кириллица «м10» находит латинскую M10; слова в любом порядке
    const found = (await http().get('/api/stock/items').query({ search: 'м10 гайк' }).set(auth()).expect(200)).body;
    expect(found.items.map((i: { id: string }) => i.id)).toEqual([nut.id]);
    expect((await http().get('/api/stock/items').query({ search: 'М10' }).set(auth()).expect(200)).body.total).toBe(2);

    // приход двух позиций одной операцией
    const inc = (await http().post('/api/stock/batch').set(auth()).send({ type: 'in', note: 'принесли без заявки', lines: [{ materialId: nut.id, qty: 100 }, { materialId: bolt.id, qty: 50 }], clientUid: 'batch-in-1' }).expect(201)).body;
    expect(inc).toMatchObject({ lines: 2, moved: 2 });
    // повтор с тем же ключом ничего не меняет
    await http().post('/api/stock/batch').set(auth()).send({ type: 'in', lines: [{ materialId: nut.id, qty: 100 }], clientUid: 'batch-in-1' }).expect(201);
    expect((await http().get(`/api/stock/items/${nut.id}`).set(auth())).body.quantity).toBe(100);

    // списание: не хватает одной — ничего не списано, обе названы
    const bad = await http().post('/api/stock/batch').set(auth()).send({ type: 'out', lines: [{ materialId: nut.id, qty: 10 }, { materialId: bolt.id, qty: 999 }] }).expect(400);
    expect(bad.body.message).toContain('Болт с шестигр. головкой');
    expect((await http().get(`/api/stock/items/${nut.id}`).set(auth())).body.quantity).toBe(100);
    const out = (await http().post('/api/stock/batch').set(auth()).send({ type: 'out', note: 'на заказ 15', lines: [{ materialId: nut.id, qty: 10 }, { materialId: bolt.id, qty: 5 }] }).expect(201)).body;
    expect(out.items.find((i: { id: string }) => i.id === bolt.id).quantity).toBe(45);

    // пересчёт: факт 88 гаек (−2), болты совпали (без движения) — дата пересчёта у обеих
    const cnt = (await http().post('/api/stock/batch').set(auth()).send({ type: 'count', lines: [{ materialId: nut.id, qty: 88 }, { materialId: bolt.id, qty: 45 }] }).expect(201)).body;
    expect(cnt).toMatchObject({ lines: 2, moved: 1 });
    for (const i of cnt.items) expect(i.lastCountedAt).toBeTruthy();
    expect(cnt.items.find((i: { id: string }) => i.id === nut.id).quantity).toBe(88);

    // отмена списания целиком → остатки вернулись; повторно — 404
    const back = (await http().post(`/api/stock/batch/${out.batchId}/cancel`).set(auth()).expect(201)).body;
    expect(back.items.find((i: { id: string }) => i.id === bolt.id).quantity).toBe(50);
    expect(back.items.find((i: { id: string }) => i.id === nut.id).quantity).toBe(98);
    await http().post(`/api/stock/batch/${out.batchId}/cancel`).set(auth()).expect(404);
  });
  it('«Получено» только через «Принять»; приём без склада (офис/СМР) — с отметкой, склад не меняется', async () => {
    await http().post('/api/supply/requests').set(auth()).send({ title: 'Бумага А4', qty: 5, statusLabel: 'Получено', clientUid: 'cc-0' }).expect(400);
    const r = (await http().post('/api/supply/requests').set(auth()).send({ title: 'Бумага А4', qty: 5, costCenter: 'office', clientUid: 'cc-1' }).expect(201)).body;
    await http().patch(`/api/supply/requests/${r.id}`).set(auth()).send({ statusLabel: 'Получено' }).expect(400);
    const got = (await http().post(`/api/supply/requests/${r.id}/receive`).set(auth()).send({ qty: 5, toStock: false }).expect(200)).body;
    expect(got).toMatchObject({ status: 'received', receivedTo: 'direct', costCenter: 'office' });
    expect((await http().get('/api/stock/items').query({ search: 'Бумага А4' }).set(auth()).expect(200)).body.total).toBe(0);
    // на склад — по умолчанию «Цех»
    const r2 = (await http().post('/api/supply/requests').set(auth()).send({ title: 'Саморез 4х16', qty: 10, clientUid: 'cc-2' }).expect(201)).body;
    const got2 = (await http().post(`/api/supply/requests/${r2.id}/receive`).set(auth()).send({ qty: 10 }).expect(200)).body;
    expect(got2).toMatchObject({ receivedTo: 'stock', costCenter: 'workshop' });
  });
  it('бронь по списку: бронирует сколько свободно, нехватку возвращает; снять строку и всю бронь', async () => {
    const a = (await http().post('/api/stock/items').set(auth()).send({ name: 'Рым-гайка М12 нерж', unit: 'шт', categoryName: 'Метизы' }).expect(201)).body;
    const b = (await http().post('/api/stock/items').set(auth()).send({ name: 'Скоба такелажная М6', unit: 'шт', categoryName: 'Метизы' }).expect(201)).body;
    await http().post('/api/stock/batch').set(auth()).send({ type: 'in', lines: [{ materialId: a.id, qty: 10 }, { materialId: b.id, qty: 3 }] }).expect(201);
    const r = (await http().post('/api/stock/reserve-list').set(auth()).send({ groupName: 'Качели К-12', lines: [{ materialId: a.id, qty: 4 }, { materialId: b.id, qty: 5 }], clientUid: 'rl-1' }).expect(201)).body;
    expect(r.name).toBe('Качели К-12');
    expect(r.lines).toHaveLength(2);
    expect(r.short).toEqual([{ materialId: b.id, need: 5, reserved: 3 }]);
    expect((await http().get(`/api/stock/items/${a.id}`).set(auth())).body).toMatchObject({ reservedQty: 4, free: 6 });
    // повтор с тем же ключом — без второй брони
    await http().post('/api/stock/reserve-list').set(auth()).send({ groupName: 'Качели К-12', lines: [{ materialId: a.id, qty: 4 }], clientUid: 'rl-1' }).expect(201);
    expect((await http().get(`/api/stock/items/${a.id}`).set(auth())).body.reservedQty).toBe(4);
    const lineA = r.lines.find((l: { materialId: string }) => l.materialId === a.id);
    await http().post(`/api/stock/reservations/${lineA.id}/release`).set(auth()).expect(200);
    expect((await http().get(`/api/stock/items/${a.id}`).set(auth())).body.reservedQty).toBe(0);
    await http().post(`/api/stock/reservations/group/${r.batchId}/release`).set(auth()).expect(200);
    expect((await http().get(`/api/stock/items/${b.id}`).set(auth())).body.reservedQty).toBe(0);
    expect((await http().get('/api/stock/reservations').set(auth()).expect(200)).body.items.some((g: { batchId: string }) => g.batchId === r.batchId)).toBe(false);
  });

  it('В.7: пустое поле стирает значение — сумма заявки, мин. остаток и вес позиции', async () => {
    const r = (await http().post('/api/supply/requests').set(auth()).send({ title: 'Стереть сумму', qty: 1, priceHint: 500, clientUid: 'v7-1' }).expect(201)).body;
    const r2 = (await http().patch(`/api/supply/requests/${r.id}`).set(auth()).send({ priceHint: null }).expect(200)).body;
    expect(r2.priceHint ?? null).toBeNull();
    const it = (await http().post('/api/stock/items').set(auth()).send({ name: 'Стереть мин', unit: 'шт', minQuantity: 5, weightKg: 2 }).expect(201)).body;
    const it2 = (await http().patch(`/api/stock/items/${it.id}`).set(auth()).send({ minQuantity: null, weightKg: null }).expect(200)).body;
    expect(it2.minQuantity).toBe(0);
    expect(it2.weightKg ?? null).toBeNull();
  });
});
