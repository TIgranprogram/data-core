import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { SupplyInvoiceService } from '../../src/modules/supply/supply-invoice.service';
import { SupplyService } from '../../src/modules/supply/supply.service';
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

  it('ворота «выставлен»; сумма считается по строкам, № и дата копируются; общая сумма цены не делит', async () => {
    await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ no: '17', issue: true }).expect(400);
    // amount — производная: не совпал с суммой строк (100 + 300) → 400
    await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ no: '17', date: '2026-10-20', amount: 500, issue: true }).expect(400);
    const r = await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ no: '17', date: '2026-10-20', amount: 400, issue: true }).expect(200);
    expect(r.body).toMatchObject({ status: 'issued', amount: 400 });
    expect(await row(a)).toMatchObject({ invoiceNo: '17', priceHint: 100 });
    expect(await row(b)).toMatchObject({ invoiceNo: '17', priceHint: 300 });
    // общая сумма не перераспределяет цены строк — только 400
    await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ amount: 500 }).expect(400);
    expect(await row(a)).toMatchObject({ priceHint: 100 });
    expect(await row(b)).toMatchObject({ priceHint: 300 });
  });

  it('цена позиции: обратный пересчёт из суммы строки, номер строки — заявка счёта', async () => {
    const inv = (await http().get(`/api/supply/invoices/${invId}`).set(auth()).expect(200)).body;
    const line = inv.requests.find((x: { id: string }) => x.id === a);
    const r = await http().patch(`/api/supply/invoices/${invId}/lines/${line.id}`).set(auth()).send({ lineAmount: 150 }).expect(200);
    expect(r.body).toMatchObject({ amount: 450, line: { qty: 1, lineAmount: 150, unitPrice: 150 } });
    // вернуть как было, чтобы следующие проверки считали 400
    await http().patch(`/api/supply/invoices/${invId}/lines/${line.id}`).set(auth()).send({ unitPrice: 100 }).expect(200);
    expect(await row(a)).toMatchObject({ priceHint: 100 });
  });

  it('оплата: до приёмки финансовые правки разрешены, после первой приёмки блокируются; № можно', async () => {
    await http().post(`/api/supply/invoices/${invId}/pay`).set(auth()).expect(400);
    const org = await db().collection('organizations').findOne({ name: 'Крепёж' });
    await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ payerCompanyId: String(org!._id) }).expect(200);
    const r = await http().post(`/api/supply/invoices/${invId}/pay`).set(auth()).expect(200);
    expect(r.body.status).toBe('paid');
    expect(await row(a)).toMatchObject({ paid: true });
    await http().delete(`/api/supply/invoices/${invId}`).set(auth()).expect(400);
    // Оплата сама по себе не закрывает финансовые правки до первой приёмки.
    await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ amount: 400 }).expect(200);
    await http().patch(`/api/supply/invoices/${invId}/lines/${a}`).set(auth()).send({ unitPrice: 101, reason: 'Проверка оплаченной суммы' }).expect(200);
    expect(await row(a)).toMatchObject({ priceHint: 101 });
    await http().patch(`/api/supply/invoices/${invId}/lines/${a}`).set(auth()).send({ unitPrice: 100, reason: 'Возврат тестовой суммы' }).expect(200);
    // Приёмка одной строки фиксирует финансовые поля всего счёта, включая другую строку.
    await http().post(`/api/supply/invoices/${invId}/receive`).set(auth()).send({ requestIds: [a] }).expect(200);
    await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ amount: 400 }).expect(400);
    await http().patch(`/api/supply/invoices/${invId}/lines/${b}`).set(auth()).send({ unitPrice: 1 }).expect(400);
    // метаданные — можно, с аудитом; № доезжает до строк
    await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ no: '18' }).expect(200);
    expect(await row(a)).toMatchObject({ invoiceNo: '18', priceHint: 100 });
  });

  it('выставленный, но ещё не оплаченный счёт можно оплатить после первой приёмки', async () => {
    const line = await row(c);
    const receivedFirstInvoiceId = String(line!.invoiceId);
    const org = await db().collection('organizations').findOne({ name: 'Крепёж' });
    await http().patch(`/api/supply/invoices/${receivedFirstInvoiceId}`).set(auth())
      .send({ no: '55', date: '2026-10-21', amount: 50, payerCompanyId: String(org!._id), issue: true }).expect(200);
    await http().post(`/api/supply/invoices/${receivedFirstInvoiceId}/receive`).set(auth())
      .send({ requestIds: [c] }).expect(200);
    const paid = await http().post(`/api/supply/invoices/${receivedFirstInvoiceId}/pay`).set(auth()).expect(200);
    expect(paid.body.status).toBe('paid');
    expect(await row(c)).toMatchObject({ status: 'received', paid: true });
  });

  it.each(['line edit', 'addRequests'])('T24: %s после preflight блокируется первой приёмкой', async (operation) => {
    const lineId = await mk({ title: 'T24 controlled race', qty: 2, supplierName: 'Крепёж', priceHint: 75 });
    const addedId = operation === 'addRequests' ? await mk({ title: 'T24 добавляемая строка', qty: 1, supplierName: 'Крепёж', priceHint: 15 }) : null;
    const made = await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [lineId] }).expect(201);
    const id = made.body.items[0].id as string;
    const supplier = await db().collection('organizations').findOne({ name: 'Крепёж' });
    await http().patch(`/api/supply/invoices/${id}`).set(auth()).send({ no: operation === 'addRequests' ? 'T24-ADD' : 'T24-LINE', date: '2026-10-22', amount: 75, payerCompanyId: String(supplier!._id), issue: true }).expect(200);
    await http().post(`/api/supply/invoices/${id}/pay`).set(auth()).expect(200);

    const invoices = app.get(SupplyInvoiceService) as unknown as { lockReason(inv: Record<string, unknown>): Promise<string | null> };
    const original = invoices.lockReason.bind(invoices);
    let release!: () => void;
    let passedPreflight!: () => void;
    const transactionGate = new Promise<void>((resolve) => { release = resolve; });
    const preflightPassed = new Promise<void>((resolve) => { passedPreflight = resolve; });
    let held = false;
    const spy = jest.spyOn(invoices, 'lockReason').mockImplementation(async (invoice) => {
      const result = await original(invoice);
      if (result === null && !held) { held = true; passedPreflight(); await transactionGate; }
      return result;
    });
    try {
      const patch = operation === 'line edit'
        ? http().patch(`/api/supply/invoices/${id}/lines/${lineId}`).set(auth()).send({ lineAmount: 90, reason: 'Контролируемая race-проверка' }).then((response) => response)
        : http().post(`/api/supply/invoices/${id}/requests`).set(auth()).send({ requestIds: [addedId], reason: 'Контролируемая race-проверка' }).then((response) => response);
      await preflightPassed;
      await http().post(`/api/supply/requests/${lineId}/receive`).set(auth()).send({ qty: 1, partial: true }).expect(200);
      const boundary = await db().collection('supplyinvoices').findOne({ _id: new Types.ObjectId(id) });
      expect(boundary?.receiptBoundaryAt).toBeInstanceOf(Date);
      release();
      const response = await patch;
      expect(response.status).toBe(400);
      expect(await row(lineId)).toMatchObject({ priceHint: 75, qty: 1, receivedQty: 1 });
      if (addedId) expect((await row(addedId))?.invoiceId).toBeUndefined();
      expect((await db().collection('supplyinvoices').findOne({ _id: new Types.ObjectId(id) }))?.amount).toBe(75);
    } finally { release(); spy.mockRestore(); }
  });

  it('T24: legacy PATCH после stale count блокируется barrier частичной приёмки', async () => {
    const lineId = await mk({ title: 'T24 legacy PATCH race', qty: 2, supplierName: 'Крепёж', priceHint: 75 });
    const made = await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [lineId] }).expect(201);
    const id = made.body.items[0].id as string;
    const originalSupplier = await db().collection('organizations').findOne({ name: 'Крепёж' });
    const supply = app.get(SupplyService) as unknown as { model: { countDocuments: (...args: unknown[]) => { exec: () => Promise<number> } } };
    const original = supply.model.countDocuments.bind(supply.model);
    let release!: () => void;
    let passedPreflight!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { passedPreflight = resolve; });
    let held = false;
    const spy = jest.spyOn(supply.model, 'countDocuments').mockImplementation((...args: unknown[]) => {
      const query = original(...args);
      const filter = args[0] as { invoiceId?: unknown; status?: unknown } | undefined;
      if (!held && filter?.invoiceId && filter.status === 'received') {
        const exec = query.exec.bind(query);
        query.exec = async () => { const count = await exec(); held = true; passedPreflight(); await gate; return count; };
      }
      return query;
    });
    try {
      const patch = http().patch(`/api/supply/requests/${lineId}`).set(auth()).send({ supplierName: 'Другой поставщик' }).then((response) => response);
      await reached;
      await http().post(`/api/supply/requests/${lineId}/receive`).set(auth()).send({ qty: 1, partial: true }).expect(200);
      release();
      const response = await patch;
      expect(response.status).toBe(400);
      expect(await row(lineId)).toMatchObject({ qty: 1, receivedQty: 1, supplierId: originalSupplier!._id });
      expect((await db().collection('supplyinvoices').findOne({ _id: new Types.ObjectId(id) }))?.receiptBoundaryAt).toBeInstanceOf(Date);
    } finally { release(); spy.mockRestore(); }
  });

  it('удаление неоплаченного: заявки отвязаны и вернулись в «В заказ»', async () => {
    const unpaidLine = await mk({ title: 'Неоплаченная позиция для удаления', qty: 1, supplierName: 'Крепёж', priceHint: 50 });
    const made = await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [unpaidLine] }).expect(201);
    const id = made.body.items[0].id as string;
    await http().patch(`/api/supply/invoices/${id}`).set(auth()).send({ no: '5', date: '2026-10-21', amount: 50 }).expect(200);
    await http().delete(`/api/supply/invoices/${id}`).set(auth()).expect(200);
    const after = await row(unpaidLine);
    expect(after).toMatchObject({ status: 'requested' });
    expect(after!.invoiceId).toBeUndefined();
    await http().get(`/api/supply/invoices/${id}`).set(auth()).expect(404);
  });
});

/** История цен материала: запись при «выставлен»/«оплачен», без дублей (e2e нужен Mongo rs0 — дома не запускался). */
describe('Material prices', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);

  beforeAll(async () => {
    ctx = await createTestApp(); app = ctx.app; token = await loginAsAdmin(app);
    for (const c of ['supplyrequests', 'supplyinvoices', 'organizations', 'materials', 'materialprices']) await db().collection(c).deleteMany({});
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('выставлен → строка цены (1200 с НДС / 10 шт = 100 без НДС), оплата — вторая; повтор без дублей; price-default', async () => {
    const mat = await db().collection('materials').insertOne({ name: 'Лист', article: 'L-1', unit: 'шт', createdAt: new Date() });
    const mid = String(mat.insertedId);
    const rid = (await http().post('/api/supply/requests').set(auth()).send({ title: 'Лист', qty: 10, unit: 'шт', supplierName: 'Металл', materialId: mid, priceHint: 1 }).expect(201)).body.id as string;
    const inv = (await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [rid] }).expect(201)).body.items[0].id as string;
    // цена — за единицу: 10 шт × 120 = 1200 в сумме строки; счёт считает сумму сам
    await http().patch(`/api/supply/invoices/${inv}/lines/${rid}`).set(auth()).send({ unitPrice: 120 }).expect(200);
    await http().patch(`/api/supply/invoices/${inv}`).set(auth()).send({ no: '1', date: '2026-10-20', issue: true }).expect(200);
    await http().patch(`/api/supply/invoices/${inv}`).set(auth()).send({ amount: 1200 }).expect(200); // повторная правка — не дубль
    let h = (await http().get(`/api/materials/${mid}/prices`).set(auth()).expect(200)).body;
    expect(h.total).toBe(2); // ручная цена черновика + цена выставленного счёта
    expect(h.items.map((p: { source: string }) => p.source).sort()).toEqual(['invoice_issued', 'manual']);
    expect(h.items[0]).toMatchObject({ price: 100, priceWithVat: 120, vatRate: 20, supplierName: 'Металл' });
    const org = await db().collection('organizations').findOne({ name: 'Металл' });
    await http().patch(`/api/supply/invoices/${inv}`).set(auth()).send({ payerCompanyId: String(org!._id) }).expect(200);
    await http().post(`/api/supply/invoices/${inv}/pay`).set(auth()).expect(200);
    h = (await http().get(`/api/materials/${mid}/prices`).set(auth()).expect(200)).body;
    expect(h.total).toBe(3);
    expect(h.items.map((p: { source: string }) => p.source).sort()).toEqual(['invoice_issued', 'invoice_paid', 'manual']);
    const d = (await http().get(`/api/materials/${mid}/price-default`).set(auth()).expect(200)).body;
    expect(d).toMatchObject({ price: 100, supplierName: 'Металл' });
  });
});
