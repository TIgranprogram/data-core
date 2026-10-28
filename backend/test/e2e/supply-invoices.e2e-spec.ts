import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** /api/supply/invoices — счета поставщиков: группой, правка с воротами, оплата, удаление. */
describe('Supply invoices', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  const mk = async (body: object) => (await http().post('/api/supply/requests').set(auth()).send({ unit: 'шт', ...body }).expect(201)).body.id as string;
  const row = (id: string) => db().collection('supplyrequests').findOne({ _id: new Types.ObjectId(id) });

  beforeAll(async () => {
    ctx = await createTestApp(); app = ctx.app; token = await loginAsAdmin(app);
    for (const c of ['supplyrequests', 'supplyinvoices', 'organizations']) await db().collection(c).deleteMany({});
  });
  afterAll(async () => { await ctx?.cleanup(); });

  let a = '', b = '', c = '', invId = '';

  it('группой: делится по поставщику, заявки → заказано; без поставщика — 400', async () => {
    a = await mk({ title: 'Болт', qty: 1, supplierName: 'Крепёж', priceHint: 100 });
    b = await mk({ title: 'Гайка', qty: 1, supplierName: 'Крепёж', priceHint: 300 });
    c = await mk({ title: 'Лист', qty: 1, supplierName: 'Металл', priceHint: 50 });
    const noSup = await mk({ title: 'Без поставщика', qty: 1 });
    await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [a, noSup] }).expect(400);
    const r = await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [a, b, c] }).expect(201);
    expect(r.body.items).toHaveLength(2);
    const inv = r.body.items.find((i: { requests: unknown[] }) => i.requests.length === 2);
    invId = inv.id;
    expect(inv).toMatchObject({ status: 'draft', supplierName: 'Крепёж' });
    expect(await row(a)).toMatchObject({ status: 'ordered' });
    await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [a] }).expect(400); // уже в счёте
  });

  it('ворота «выставлен»; сумма делится 25/75, № и дата копируются', async () => {
    await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ no: '17', issue: true }).expect(400);
    const r = await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ no: '17', date: '2026-10-20', amount: 400, issue: true }).expect(200);
    expect(r.body.status).toBe('issued');
    expect(await row(a)).toMatchObject({ invoiceNo: '17', priceHint: 100 });
    expect(await row(b)).toMatchObject({ invoiceNo: '17', priceHint: 300 });
    await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ amount: 500 }).expect(200);
    expect(await row(a)).toMatchObject({ priceHint: 125 });
    expect(await row(b)).toMatchObject({ priceHint: 375 });
  });

  it('оплата: без плательщика 400; с плательщиком — счёт и заявки оплачены; удалить нельзя', async () => {
    await http().post(`/api/supply/invoices/${invId}/pay`).set(auth()).expect(400);
    const org = await db().collection('organizations').findOne({ name: 'Крепёж' });
    await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ payerCompanyId: String(org!._id) }).expect(200);
    const r = await http().post(`/api/supply/invoices/${invId}/pay`).set(auth()).expect(200);
    expect(r.body.status).toBe('paid');
    expect(await row(a)).toMatchObject({ paid: true });
    await http().delete(`/api/supply/invoices/${invId}`).set(auth()).expect(400);
    await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ no: '18' }).expect(400);
  });

  it('удаление неоплаченного: заявки отвязаны и вернулись в «В заказ»', async () => {
    const other = (await http().get('/api/supply/requests').set(auth()).expect(200)).body.items.find((x: { id: string }) => x.id === c);
    const id = other.invoiceId;
    await http().patch(`/api/supply/invoices/${id}`).set(auth()).send({ no: '5', date: '2026-10-21', amount: 50 }).expect(200);
    await http().delete(`/api/supply/invoices/${id}`).set(auth()).expect(200);
    const after = await row(c);
    expect(after).toMatchObject({ status: 'requested' });
    expect(after!.invoiceId).toBeUndefined();
    await http().get(`/api/supply/invoices/${id}`).set(auth()).expect(404);
  });
});
