import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * Заказы заказчиков (TASKS З.1–З.2): шапка /api/salesorders, позиции — /api/incomes с orderId.
 * Проверяем: CRUD + корзина вместе с позициями, этапы и счётчики «в работе / выполненные», номер уникален
 * внутри нашей компании, правка шапки обновляет кэш в позициях, карточка с заявками и движениями склада,
 * лист «Заказы» сам находит/создаёт шапку без дублей и не дублирует позицию, заведённую до него.
 */
describe('Sales orders (заказы заказчиков)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  let siu = '', ssu = '';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['salesorders', 'incomes', 'organizations', 'supplyrequests', 'stockmovements']) await db().collection(c).deleteMany({});
    const r = await db().collection('organizations').insertMany([
      { name: 'СИЮ', shortName: 'СИЮ', inn: 'T-SIU', isOurCompany: true, type: [], deletedAt: null },
      { name: 'ССЮ', shortName: 'ССЮ', inn: 'T-SSU', isOurCompany: true, type: [], deletedAt: null },
    ]);
    siu = String(r.insertedIds[0]); ssu = String(r.insertedIds[1]);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  let orderId = '';

  it('создание: номер обязателен, тот же номер у той же компании — 409, у другой — можно; мусорная дата — 400', async () => {
    await http().post('/api/salesorders').set(auth()).send({ customer: 'Без номера' }).expect(400);
    const a = await http().post('/api/salesorders').set(auth()).send({
      orderNo: '№ 2', companyName: 'СИЮ', customer: 'ООО Академия', paymentForm: 'б/р 50%', shipDate: '15.06.2026',
      productionDeadline: '2026-06-10', contractNo: 'К-1', contractDate: '01.05.2026', clientUid: 'so-1',
    }).expect(201);
    expect(a.body).toMatchObject({ orderNo: '№ 2', companyName: 'СИЮ', stage: 'new', stageLabel: 'Новый', importKey: 'СИЮ|2', lineCount: 0, lines: [], supplyRequests: [], stockMovements: [] });
    expect(a.body.shipDate.slice(0, 10)).toBe('2026-06-15');
    orderId = a.body.id;
    expect((await http().post('/api/salesorders').set(auth()).send({ orderNo: 'x', clientUid: 'so-1' }).expect(201)).body.id).toBe(orderId);
    await http().post('/api/salesorders').set(auth()).send({ orderNo: '2', companyName: 'сию' }).expect(409);
    await http().post('/api/salesorders').set(auth()).send({ orderNo: '2', companyId: ssu, stage: 'shipped' }).expect(201);
    await http().post('/api/salesorders').set(auth()).send({ orderNo: '3', companyName: 'Рога и копыта' }).expect(400);
    await http().post('/api/salesorders').set(auth()).send({ orderNo: '3', shipDate: 'завтра' }).expect(400);
    await http().post('/api/salesorders').set(auth()).send({ orderNo: '3', stage: 'потерян' }).expect(400);
  });

  it('№ на производство: пишется, ищется, следующий = max+1 за год; "" снимает', async () => {
    const mk = (orderNo: string, productionNo: string) => http().post('/api/salesorders').set(auth()).send({ orderNo, customer: 'ПН', productionNo }).expect(201);
    const o = (await mk('PN-1', '20-26')).body;
    const o2 = (await mk('PN-2', '99-25')).body;
    const o3 = (await mk('PN-3', '3-26')).body;
    // сортировка «№ заказа»: год, затем номер числом (3-26 раньше 20-26), без № — в конце
    const srt = (await http().get('/api/salesorders?sort=productionNo&search=ПН').set(auth()).expect(200)).body.items.map((x: { productionNo: string }) => x.productionNo);
    expect(srt).toEqual(['99-25', '3-26', '20-26']);
    expect(o.productionNo).toBe('20-26');
    const nx = await http().get('/api/salesorders/next-production-no?year=2026').set(auth()).expect(200);
    expect(nx.body.value).toBe('21-26');
    const found = await http().get('/api/salesorders?search=20-26').set(auth()).expect(200);
    expect(found.body.items.map((x: { id: string }) => x.id)).toContain(o.id);
    const cleared = await http().patch(`/api/salesorders/${o.id}`).set(auth()).send({ productionNo: '' }).expect(200);
    expect(cleared.body.productionNo).toBeUndefined();
    // убрать за собой: следующий тест считает заказы
    for (const x of [o, o2, o3]) await http().delete(`/api/salesorders/${x.id}`).set(auth()).expect(200);
  });

  it('позиции через /incomes с orderId: поля шапки — из заказа, № позиции по порядку; карточка с суммой', async () => {
    const l1 = await http().post('/api/incomes').set(auth()).send({ orderId, title: 'Скамья', qty: 2, unitPrice: 1000, customer: 'не тот', unit: 'шт' }).expect(201);
    expect(l1.body).toMatchObject({ orderId, lineNo: 1, orderNo: '№ 2', customer: 'ООО Академия', companyName: 'СИЮ', paymentForm: 'б/р 50%', amount: 2000 });
    expect(l1.body.reportDate.slice(0, 10)).toBe('2026-06-15');
    const l2 = await http().post('/api/incomes').set(auth()).send({ orderId, title: 'Урна', qty: 3, unitPrice: 500, paidDate: '20.06.2026' }).expect(201);
    expect(l2.body.lineNo).toBe(2);
    await http().post('/api/incomes').set(auth()).send({ orderId: '0123456789abcdef01234567', title: 'x' }).expect(400);
    expect((await http().get(`/api/incomes?orderId=${orderId}`).set(auth()).expect(200)).body.total).toBe(2);

    // привязки, которые появятся в З.6: заявка снабжения и отпуск со склада под заказ
    await db().collection('supplyrequests').insertOne({ title: 'Доска', qty: 5, status: 'requested', salesOrderId: new Types.ObjectId(orderId), deletedAt: null });
    await db().collection('stockmovements').insertOne({ type: 'out', qty: 1, date: new Date(), orderId, salesOrderId: new Types.ObjectId(orderId), deletedAt: null });
    const card = await http().get(`/api/salesorders/${orderId}`).set(auth()).expect(200);
    expect(card.body).toMatchObject({ lineCount: 2, amount: 3500, paidAmount: 1500 });
    expect(card.body.lines.map((l: { title: string }) => l.title)).toEqual(['Скамья', 'Урна']);
    expect(card.body.supplyRequests).toHaveLength(1);
    expect(card.body.stockMovements).toHaveLength(1);
    await http().get('/api/salesorders/0123456789abcdef01234567').set(auth()).expect(404);
    await http().get('/api/salesorders/мусор').set(auth()).expect(400);
  });

  it('правка шапки обновляет кэш в позициях (дата в отчёт = оплата ?? отгрузка); ключ не меняется', async () => {
    const r = await http().patch(`/api/salesorders/${orderId}`).set(auth()).send({ customer: 'ООО Академия Благоустройства', shipDate: '01.07.2026', stage: 'production', companyName: 'ССЮ', orderNo: '2а' }).expect(200);
    expect(r.body).toMatchObject({ stage: 'production', companyName: 'ССЮ', importKey: 'СИЮ|2', editedInApp: true });
    const lines = (await http().get(`/api/incomes?orderId=${orderId}&sort=lineNo`).set(auth()).expect(200)).body.items;
    expect(lines.map((l: { customer: string }) => l.customer)).toEqual(['ООО Академия Благоустройства', 'ООО Академия Благоустройства']);
    expect(lines.map((l: { companyName: string }) => l.companyName)).toEqual(['ССЮ', 'ССЮ']);
    expect(lines.map((l: { orderNo: string }) => l.orderNo)).toEqual(['2а', '2а']);
    expect(lines[0].reportDate.slice(0, 10)).toBe('2026-07-01'); // без оплаты — по отгрузке
    expect(lines[1].reportDate.slice(0, 10)).toBe('2026-06-20'); // оплачено — по оплате
    // занять номер другого заказа нельзя (у ССЮ уже есть №2)
    await http().patch(`/api/salesorders/${orderId}`).set(auth()).send({ orderNo: '2' }).expect(409);
    // правка поля шапки в позиции не расходится с шапкой
    const one = await http().patch(`/api/incomes/${lines[0].id}`).set(auth()).send({ customer: 'Чужой', qty: 4 }).expect(200);
    expect(one.body).toMatchObject({ customer: 'ООО Академия Благоустройства', amount: 4000 });
  });

  it('список: этапы, «в работе» / «выполненные», счётчики, поиск, сортировка', async () => {
    await http().post('/api/salesorders').set(auth()).send({ orderNo: '5', companyName: 'СИЮ', stage: 'closed', customer: 'ИП Сахаджи' }).expect(201);
    await http().post('/api/salesorders').set(auth()).send({ orderNo: '6', companyName: 'СИЮ', stage: 'cancelled' }).expect(201);
    const all = await http().get('/api/salesorders').set(auth()).expect(200);
    expect(all.body).toMatchObject({ total: 4, page: 1, limit: 25, counts: { all: 4, active: 1, done: 2, new: 0, production: 1, shipped: 1, closed: 1, cancelled: 1 } });
    expect((await http().get('/api/salesorders?filter=active').set(auth()).expect(200)).body.total).toBe(1);
    expect((await http().get('/api/salesorders?filter=done').set(auth()).expect(200)).body.total).toBe(2);
    expect((await http().get('/api/salesorders?filter=shipped').set(auth()).expect(200)).body.total).toBe(1);
    expect((await http().get('/api/salesorders?filter=closed').set(auth()).expect(200)).body.total).toBe(1);
    expect((await http().get('/api/salesorders?stage=closed,cancelled').set(auth()).expect(200)).body.total).toBe(2);
    expect((await http().get('/api/salesorders?search=сахаджи').set(auth()).expect(200)).body.items[0].orderNo).toBe('5');
    expect((await http().get(`/api/salesorders?companyId=${siu}`).set(auth()).expect(200)).body.total).toBe(2);
    await http().get('/api/salesorders?filter=потом').set(auth()).expect(400);
    await http().get('/api/salesorders?sort=-пароль').set(auth()).expect(400);
    const sorted = (await http().get('/api/salesorders?sort=orderNo').set(auth()).expect(200)).body.items.map((o: { orderNo: string }) => o.orderNo);
    expect(sorted).toEqual(['2', '2а', '5', '6']);
  });

  it('корзина: заказ уходит вместе с позициями и возвращается вместе с ними', async () => {
    const solo = await http().post('/api/incomes').set(auth()).send({ title: 'Отдельно удалённая', orderId }).expect(201);
    await http().delete(`/api/incomes/${solo.body.id}`).set(auth()).expect(200);
    // HARDEN-1 п.14: заказ с оплатой в корзину не уходит — сначала убираем платежи позиций
    const lines = (await http().get(`/api/incomes?orderId=${orderId}`).set(auth()).expect(200)).body.items as Array<{ id: string; paidAmount: number }>;
    if (lines.some((l) => l.paidAmount > 0)) await http().delete(`/api/salesorders/${orderId}`).set(auth()).expect(409);
    for (const l of lines.filter((x) => x.paidAmount > 0)) await http().delete(`/api/incomes/${l.id}/payments/0`).set(auth()).expect(200);
    await http().delete(`/api/salesorders/${orderId}`).set(auth()).expect(200);
    await http().get(`/api/salesorders/${orderId}`).set(auth()).expect(404);
    expect((await http().get(`/api/incomes?orderId=${orderId}`).set(auth()).expect(200)).body.total).toBe(0);
    expect((await http().get('/api/salesorders?deleted=1').set(auth()).expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(orderId);
    await http().post('/api/salesorders').set(auth()).send({ orderNo: '2', companyName: 'СИЮ' }).expect(409); // номер занят заказом в корзине
    const back = await http().post(`/api/salesorders/${orderId}/restore`).set(auth()).expect(200);
    expect(back.body.lineCount).toBe(2); // удалённая отдельно позиция остаётся в корзине
    await http().post(`/api/salesorders/${orderId}/restore`).set(auth()).expect(404);
  });

  it('C090: обе сводки учитывают частичные и старые оплаты, исключают удалённые и отменённые позиции', async () => {
    const paidDate = new Date('2026-11-01');
    const cases = [
      { name: 'частичная', fields: { paidAmount: 300 }, paid: 300, count: 1 },
      { name: 'полная', fields: { paidDate, paidAmount: 1000 }, paid: 1000, count: 1 },
      { name: 'старая полная', fields: { paidDate }, paid: 1000, count: 1 },
      { name: 'дата важнее суммы', fields: { paidDate, paidAmount: 1200 }, paid: 1000, count: 1 },
      { name: 'неоплаченная', fields: {}, paid: 0, count: 1 },
      { name: 'нулевая оплата', fields: { paidAmount: null }, paid: 0, count: 1 },
      { name: 'удалённая', fields: { paidAmount: 300, deletedAt: paidDate }, paid: 0, count: 0 },
      { name: 'отменённая', fields: { paidDate, cancelledAt: paidDate }, paid: 0, count: 0 },
    ];
    // Сырые фикстуры сохраняют старый формат без paidAmount, который API уже пересчитывает.
    for (const [index, test] of cases.entries()) {
      const id = new Types.ObjectId();
      const orderNo = `C090-payment-${index}`;
      await db().collection('salesorders').insertOne({ _id: id, orderNo, stage: 'new', createdAt: paidDate, deletedAt: null });
      await db().collection('incomes').insertOne({ orderId: id, title: test.name, amount: 1000, deletedAt: null, cancelledAt: null, ...test.fields });
      const expected = { amount: 1000 * test.count, paidAmount: test.paid, lineCount: test.count };
      for (const route of ['salesorders', 'production-orders']) {
        const response = await http().get(`/api/${route}`).query({ search: orderNo }).set(auth()).expect(200);
        expect(response.body.items).toHaveLength(1);
        expect(response.body.items[0]).toMatchObject(expected);
      }
    }
  });

  it('без входа — 401', async () => {
    await http().get('/api/salesorders').expect(401);
  });
});
