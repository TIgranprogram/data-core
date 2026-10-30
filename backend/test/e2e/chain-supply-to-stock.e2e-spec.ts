import request from 'supertest';
import { Types } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** Цепочка «заявка → счёт → оплата → Принять на склад»: остаток, цена, движение; повторный приём не удваивает приход. */
describe('Цепочка: снабжение до склада', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  const qtyOf = async (id: string) => (await http().get(`/api/stock/items/${id}`).set(auth()).expect(200)).body.quantity as number;
  const moves = (id: string) => db().collection('stockmovements').find({ materialId: new Types.ObjectId(id), type: 'in' }).toArray();
  const mkReq = async (b: object) => (await http().post('/api/supply/requests').set(auth()).send({ unit: 'шт', supplierName: 'Металл-Снаб', ...b }).expect(201)).body.id as string;
  const invoiceOf = async (reqId: string, amount: number, no: string) => {
    const inv = (await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [reqId] }).expect(201)).body.items[0].id as string;
    await http().patch(`/api/supply/invoices/${inv}`).set(auth()).send({ no, date: '2026-10-20', amount, issue: true }).expect(200);
    const org = await db().collection('organizations').findOne({ name: 'Металл-Снаб' });
    await http().patch(`/api/supply/invoices/${inv}`).set(auth()).send({ payerCompanyId: String(org!._id) }).expect(200);
    return inv;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['supplyrequests', 'supplyinvoices', 'organizations', 'materials', 'materialprices', 'storageitems', 'stockmovements', 'reservations', 'warehouses']) await db().collection(c).deleteMany({});
  });
  afterAll(async () => { await ctx?.cleanup(); });

  let matId = '', reqId = '', invId = '';

  it('заявка на позицию склада → счёт → оплата: до приёма остаток 0, заявка оплачена', async () => {
    matId = (await http().post('/api/stock/items').set(auth()).send({ name: 'Лист ЦС-1', unit: 'шт', categoryName: 'Металл' }).expect(201)).body.id;
    reqId = await mkReq({ title: 'Лист ЦС-1', qty: 10, materialId: matId, priceHint: 1 });
    invId = await invoiceOf(reqId, 1200, 'ЦС-7');
    const paid = (await http().post(`/api/supply/invoices/${invId}/pay`).set(auth()).expect(200)).body;
    expect(paid.status).toBe('paid');
    expect(await db().collection('supplyrequests').findOne({ _id: new Types.ObjectId(reqId) })).toMatchObject({ paid: true, invoiceNo: 'ЦС-7' });
    expect(await qtyOf(matId)).toBe(0);
    expect(await moves(matId)).toHaveLength(0);
  });

  it('«Принять» счёт: остаток 10, заявка «Получено» на склад, движение прихода со ссылкой на заявку', async () => {
    const r = (await http().post(`/api/supply/invoices/${invId}/receive`).set(auth()).send({}).expect(200)).body;
    expect(r.receivedCount).toBe(1);
    expect(await qtyOf(matId)).toBe(10);
    expect(await db().collection('supplyrequests').findOne({ _id: new Types.ObjectId(reqId) })).toMatchObject({ status: 'received', receivedQty: 10, receivedTo: 'stock' });
    const mv = await moves(matId);
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ qty: 10, delta: 10, qtyBefore: 0, qtyAfter: 10, documentRef: `SupplyRequest:${reqId}` });
    const hist = (await http().get(`/api/stock/items/${matId}/history`).set(auth()).expect(200)).body;
    expect(hist.items).toHaveLength(1);
  });

  it('цена записана: история цен материала — выставлен и оплачен (1200 с НДС / 10 = 100 без НДС)', async () => {
    const h = (await http().get(`/api/materials/${matId}/prices`).set(auth()).expect(200)).body;
    expect(h.total).toBe(2);
    expect(h.items.map((p: { source: string }) => p.source).sort()).toEqual(['invoice_issued', 'invoice_paid']);
    for (const p of h.items) expect(p).toMatchObject({ price: 100, priceWithVat: 120, supplierName: 'Металл-Снаб' });
    expect((await http().get(`/api/materials/${matId}/price-default`).set(auth()).expect(200)).body).toMatchObject({ price: 100, supplierName: 'Металл-Снаб' });
  });

  it('повторный «Принять» — 409, приход не удвоен: остаток 10, одно движение', async () => {
    const r = await http().post(`/api/supply/invoices/${invId}/receive`).set(auth()).send({}).expect(409);
    expect(r.body.message).toContain('уже приняты');
    await http().post(`/api/supply/requests/${reqId}/receive`).set(auth()).send({ qty: 10 }).expect(409);
    await http().post(`/api/supply/invoices/${invId}/receive`).set(auth()).send({ requestIds: [reqId] }).expect(409);
    expect(await qtyOf(matId)).toBe(10);
    expect(await moves(matId)).toHaveLength(1);
  });

  it('ОШИБКА СЕРВЕРА: два «Принять» одновременно удваивают приход (ждём остаток 10 и одно движение, сейчас 20)', async () => {
    const m = (await http().post('/api/stock/items').set(auth()).send({ name: 'Лист ЦС-2', unit: 'шт', categoryName: 'Металл' }).expect(201)).body.id as string;
    const r = await mkReq({ title: 'Лист ЦС-2', qty: 10, materialId: m, priceHint: 1 });
    const inv = await invoiceOf(r, 600, 'ЦС-8');
    const res = await Promise.all([1, 2].map(() => http().post(`/api/supply/invoices/${inv}/receive`).set(auth()).send({})));
    expect(res.filter((x) => x.status >= 500)).toEqual([]);
    // ключ приёма одинаков (inv-…-заявка): второй вызов — тот же результат (200) или 409, но не второй приход
    expect(res.every((x) => x.status === 200 || x.status === 409)).toBe(true);
    expect(await qtyOf(m)).toBe(10);
    expect(await moves(m)).toHaveLength(1);
  });

  it('HARDEN-1: приём → отмена движения → смена статуса → новый приём увеличивает остаток', async () => {
    const m = (await http().post('/api/stock/items').set(auth()).send({ name: 'Лист ЦС-H4', unit: 'шт', categoryName: 'Металл' }).expect(201)).body.id as string;
    const r = await mkReq({ title: 'Лист ЦС-H4', qty: 10, materialId: m, priceHint: 1 });
    await invoiceOf(r, 600, 'ЦС-40');
    await http().post(`/api/supply/requests/${r}/receive`).set(auth()).send({}).expect(200);
    expect(await qtyOf(m)).toBe(10);
    // активный приход — статус менять нельзя
    await http().patch(`/api/supply/requests/${r}`).set(auth()).send({ statusLabel: '⚙️ В работе' }).expect(400);
    const mv = (await moves(m))[0];
    await http().post(`/api/stock/movements/${String(mv._id)}/cancel`).set(auth()).expect(200);
    expect(await qtyOf(m)).toBe(0);
    await http().patch(`/api/supply/requests/${r}`).set(auth()).send({ statusLabel: '⚙️ В работе' }).expect(200);
    await http().post(`/api/supply/requests/${r}/receive`).set(auth()).send({}).expect(200);
    expect(await qtyOf(m)).toBe(10);
  });

  it('HARDEN-1: две параллельные отмены одной операции — остаток возвращается один раз', async () => {
    const m = (await http().post('/api/stock/items').set(auth()).send({ name: 'Лист ЦС-H5', unit: 'шт', categoryName: 'Металл' }).expect(201)).body.id as string;
    const b = (await http().post('/api/stock/batch').set(auth()).send({ type: 'in', lines: [{ materialId: m, qty: 10 }] }).expect(201)).body.batchId as string;
    await http().post('/api/stock/batch').set(auth()).send({ type: 'in', lines: [{ materialId: m, qty: 5 }] }).expect(201);
    expect(await qtyOf(m)).toBe(15);
    const res = await Promise.all([1, 2].map(() => http().post(`/api/stock/batch/${b}/cancel`).set(auth())));
    expect(res.filter((x) => x.status >= 500)).toEqual([]);
    expect(res.filter((x) => x.status === 201 || x.status === 200)).toHaveLength(1);
    expect(await qtyOf(m)).toBe(5);
  });

  it('частичный приход по заявке: остаток +4, заявка открыта на 6, итог после остатка 10 и заявка «Получено»', async () => {
    const m = (await http().post('/api/stock/items').set(auth()).send({ name: 'Лист ЦС-3', unit: 'шт', categoryName: 'Металл' }).expect(201)).body.id as string;
    const r = await mkReq({ title: 'Лист ЦС-3', qty: 10, materialId: m, priceHint: 1 });
    await invoiceOf(r, 600, 'ЦС-9');
    const part = (await http().post(`/api/supply/requests/${r}/receive`).set(auth()).send({ qty: 4, partial: true, clientUid: 'cs-p1' }).expect(200)).body;
    expect(part).toMatchObject({ qty: 6, receivedQty: 4 });
    expect(part.status).not.toBe('received');
    expect(await qtyOf(m)).toBe(4);
    // повтор той же части (офлайн-очередь) — без второго прихода
    await http().post(`/api/supply/requests/${r}/receive`).set(auth()).send({ qty: 4, partial: true, clientUid: 'cs-p1' }).expect(200);
    expect(await qtyOf(m)).toBe(4);
    expect(await moves(m)).toHaveLength(1);
    // остаток пришёл
    const rest = (await http().post(`/api/supply/requests/${r}/receive`).set(auth()).send({ qty: 6 }).expect(200)).body;
    expect(rest.status).toBe('received');
    expect(await qtyOf(m)).toBe(10);
    expect(await moves(m)).toHaveLength(2);
    await http().post(`/api/supply/requests/${r}/receive`).set(auth()).send({ qty: 6 }).expect(409);
    expect(await qtyOf(m)).toBe(10);
  });

  it('счёт из двух заявок: «Принять» с одной отмеченной принимает только её; затем остальные', async () => {
    const m1 = (await http().post('/api/stock/items').set(auth()).send({ name: 'Лист ЦС-4', unit: 'шт', categoryName: 'Металл' }).expect(201)).body.id as string;
    const m2 = (await http().post('/api/stock/items').set(auth()).send({ name: 'Лист ЦС-5', unit: 'шт', categoryName: 'Металл' }).expect(201)).body.id as string;
    const a = await mkReq({ title: 'Лист ЦС-4', qty: 3, materialId: m1, priceHint: 100 });
    const b = await mkReq({ title: 'Лист ЦС-5', qty: 5, materialId: m2, priceHint: 100 });
    const inv = (await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [a, b] }).expect(201)).body.items[0].id as string;
    await http().patch(`/api/supply/invoices/${inv}`).set(auth()).send({ no: 'ЦС-10', date: '2026-10-20', amount: 800, issue: true }).expect(200);
    const one = (await http().post(`/api/supply/invoices/${inv}/receive`).set(auth()).send({ requestIds: [a] }).expect(200)).body;
    expect(one.receivedCount).toBe(1);
    expect([await qtyOf(m1), await qtyOf(m2)]).toEqual([3, 0]);
    const rest = (await http().post(`/api/supply/invoices/${inv}/receive`).set(auth()).send({}).expect(200)).body;
    expect(rest.receivedCount).toBe(1);
    expect([await qtyOf(m1), await qtyOf(m2)]).toEqual([3, 5]);
    await http().post(`/api/supply/invoices/${inv}/receive`).set(auth()).send({}).expect(409);
  });

  it('заявка без привязки к позиции: «Принять» заводит позицию склада по названию, один приход', async () => {
    const r = await mkReq({ title: 'Новая позиция ЦС-6', qty: 7, priceHint: 10 });
    const inv = (await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [r] }).expect(201)).body.items[0].id as string;
    await http().patch(`/api/supply/invoices/${inv}`).set(auth()).send({ no: 'ЦС-11', date: '2026-10-20', amount: 70, issue: true }).expect(200);
    await http().post(`/api/supply/invoices/${inv}/receive`).set(auth()).send({}).expect(200);
    const items = (await http().get('/api/stock/items').query({ search: 'ЦС-6' }).set(auth()).expect(200)).body;
    expect(items.total).toBe(1);
    expect(items.items[0]).toMatchObject({ name: 'Новая позиция ЦС-6', quantity: 7 });
  });
});
