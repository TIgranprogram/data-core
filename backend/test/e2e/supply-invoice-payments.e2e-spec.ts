import { FOREIGN_INVOICE_CURRENCIES } from '../../src/modules/supply/invoice-financials';
import { SupplyInvoicePaymentsService } from '../../src/modules/supply/supply-invoice-payments.service';
import { JwtService } from '@nestjs/jwt';
import { SupplyInvoiceService } from '../../src/modules/supply/supply-invoice.service';
import request from 'supertest';
import { Types } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { SupplyInvoicePayment } from '../../src/modules/supply/supply-invoice-payment.schema';
import { FinanceService } from '../../src/modules/finance/finance.service';

describe('C158: факты оплат и календарь без дублей', () => {
  let ctx: TestContext, token: AuthTokens, payer: Types.ObjectId, supplier: Types.ObjectId;
  const db = () => ctx.connection.db!, http = () => request(ctx.app.getHttpServer()), auth = () => authHeader(token.access);
  const get = async (id: string) => (await http().get(`/api/supply/invoices/${id}`).set(auth()).expect(200)).body;
  const pay = (id: string, body: object) => http().post(`/api/supply/invoices/${id}/payments`).set(auth()).send(body);
  const fixture = async (amount = 255000, extra: Record<string, unknown> = {}, count = 1) => {
    const invoice = new Types.ObjectId(), ids = Array.from({ length: count }, () => new Types.ObjectId());
    await db().collection('supplyinvoices').insertOne({ _id: invoice, no: `C158-${invoice}`, date: new Date('2026-09-01'), status: 'issued', amount, payerCompanyId: payer, supplierId: supplier, supplierName: 'C158 поставщик', version: 0, deletedAt: null, ...extra });
    await db().collection('supplyrequests').insertMany(ids.map((_id, i) => ({ _id, invoiceId: invoice, title: `C158 строка${i}`, qty: 1, unit: 'шт', priceHint: amount / count, companyId: payer, supplierId: supplier, status: 'ordered', deletedAt: null, paid: false, invoiceDate: new Date('2026-09-01') })));
    return { id: String(invoice), ids };
  };
  const ops = async (from: string, to: string) => (ctx.module.get(FinanceService) as any).ops(from, to, [payer]);
  beforeAll(async () => {
    ctx = await createTestApp({ strictValidation: true }); token = await loginAsAdmin(ctx.app);
    payer = new Types.ObjectId(); supplier = new Types.ObjectId();
    await db().collection('organizations').insertMany([{ _id: payer, inn: '9900000158', name: 'C158 наша', shortName: 'C158', isOurCompany: true, deletedAt: null }, { _id: supplier, inn: '9900000258', name: 'C158 поставщик', deletedAt: null }]);
    await ctx.module.get(getModelToken(SupplyInvoicePayment.name)).createIndexes();
  });
  afterAll(async () => { await ctx?.cleanup(); });
  it('аванс и остаток — два факта, повтор потерянного ответа не удваивает сумму', async () => {
    const x = await fixture();
    const first = { clientUid: 'advance', date: '2026-11-16', amount: 55000, version: 0 };
    let response = await pay(x.id, first).expect(200);
    expect(response.body).toMatchObject({ status: 'issued', paymentState: 'partial', paidAmount: 55000, balanceDue: 200000 });
    await pay(x.id, first).expect(200);
    await pay(x.id, { ...first, amount: 55001 }).expect(409);
    response = await pay(x.id, { clientUid: 'final', date: '2026-11-17', amount: 200000, version: response.body.version }).expect(200);
    expect(response.body).toMatchObject({ status: 'paid', paidAmount: 255000, balanceDue: 0, paymentsTotal: 2 });
    const facts = (await ops('2026-11-01', '2026-11-30')).ops.filter((o: any) => o.doc === `C158-${x.id}`);
    expect(facts.map((o: any) => [o.date, o.amount]).sort()).toEqual([['2026-11-16', 55000], ['2026-11-17', 200000]]);
    await http().patch(`/api/supply/invoices/${x.id}/lines/${x.ids[0]}`).set(auth()).send({ lineAmount: 1 }).expect(409);
  });
  it('поздний ввод относится к17сентября, не к createdAt', async () => {
    const x = await fixture(31960.14);
    await pay(x.id, { clientUid: 'historical', date: '2026-09-17', amount: 31960.14 }).expect(200);
    expect((await ops('2026-09-01', '2026-09-30')).ops.filter((o: any) => o.doc === `C158-${x.id}`)).toHaveLength(1);
    expect((await ops('2026-11-01', '2026-11-30')).ops.filter((o: any) => o.doc === `C158-${x.id}`)).toHaveLength(0);
  });
  it('одновременный одинаковый ключ создаёт один факт; разные ключи не допускают переплату', async () => {
    const x = await fixture(100);
    const body = { clientUid: 'same', date: '2026-11-18', amount: 60 };
    const a = await Promise.all([pay(x.id, body), pay(x.id, body)]);
    expect(a.map((r) => r.status)).toEqual([200, 200]);
    expect(await db().collection('supplyinvoicepayments').countDocuments({ invoiceId: new Types.ObjectId(x.id) })).toBe(1);
    const b = await Promise.all([pay(x.id, { ...body, clientUid: 'a', amount: 40 }), pay(x.id, { ...body, clientUid: 'b', amount: 40 })]);
    expect(b.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await get(x.id)).paidAmount).toBe(100);
  });
  it('legacy snapshot из другого месяца не возвращается после маркера/сторно всех платежей', async () => {
    const x = await fixture(100);
    await db().collection('supplyinvoices').updateOne({ _id: new Types.ObjectId(x.id) }, { $set: { paymentAccountingVersion: 1, paymentSnapshot: { amount: 100, paidAt: new Date('2026-09-09'), lines: [{ requestId: x.ids[0], lineAmount: 100, companyId: payer }] } } });
    await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $set: { paid: true, paidAt: new Date('2026-09-09') } });
    const added = (await pay(x.id, { clientUid: 'new', date: '2026-11-18', amount: 100 }).expect(200)).body;
    expect((await ops('2026-09-01', '2026-09-30')).ops.filter((o: any) => o.doc === `C158-${x.id}` || o.id === String(x.ids[0]))).toHaveLength(0);
    const p = added.payments[0];
    await http().post(`/api/supply/invoices/${x.id}/payments/${p.id}/void`).set(auth()).send({ confirm: true, reason: 'ошибочный факт', clientUid: 'void-new', version: added.version }).expect(200);
    const after = await get(x.id); expect(after).toMatchObject({ paymentAccountingVersion: 1, paidAmount: 0, paymentState: 'unpaid' });
    expect((await ops('2026-09-01', '2026-09-30')).ops.filter((o: any) => o.id === String(x.ids[0]))).toHaveLength(0);
  });
  it('USD без курса не840руб, подтверждённые оплаты по разным курсам закрывают валютный остаток', async () => {
    const x = await fixture(0), meta = { currency: 'USD', financialLines: { [String(x.ids[0])]: { sourceLineAmount: 840 } } };
    await db().collection('supplyinvoices').updateOne({ _id: new Types.ObjectId(x.id) }, { $set: meta });
    expect(await get(x.id)).toMatchObject({ currency: 'USD', sourceAmount: 840, accountingAmountRub: null, accountingState: 'unresolved' });
    await http().post(`/api/supply/invoices/${x.id}/pay`).set(auth()).send({}).expect(409);
    await pay(x.id, { clientUid: 'usd-one', date: '2026-11-17', sourceAmount: 400, amount: 32000 }).expect(200);
    const last = (await pay(x.id, { clientUid: 'usd-two', date: '2026-11-18', sourceAmount: 440, amount: 37400 }).expect(200)).body;
    expect(last).toMatchObject({ paymentState: 'paid', sourceBalance: 0, paidAmount: 69400, balanceDue: 0 });
  });
  it('UE360 и подтверждённые30326руб сохраняют первичку/НДС и рублёвый инвариант', async () => {
    const x = await fixture(0);
    await http().patch(`/api/supply/invoices/${x.id}`).set(auth()).send({ currency: 'UE', currencyName: 'по договору', confirmedAmountRub: 30326, conversionNote: 'подтверждено бухгалтером', vatMode: 'included', vatRate: 22 }).expect(200);
    const r = (await http().patch(`/api/supply/invoices/${x.id}/lines/${x.ids[0]}`).set(auth()).send({ sourceLineAmount: 360 }).expect(200)).body.invoice;
    expect(r).toMatchObject({ currency: 'UE', sourceAmount: 360, amount: 30326, accountingAmountRub: 30326, calculatedVatAmount: 64.92 });
    expect(r.requests[0].priceHint).toBe(30326);
  });
  it('дата/точность/переплата/неизвестные поля и чужой файл отклоняются без записи', async () => {
    const x = await fixture(100);
    for (const body of [{ date: '2099-01-01', amount: 10 }, { date: '2026-02-30', amount: 10 }, { date: '2026-11-18', amount: 10.001 }, { date: '2026-11-18', amount: 10, random: true }, { date: '2026-11-18', amount: 10, fileIds: [String(new Types.ObjectId())] }]) await pay(x.id, { clientUid: String(Math.random()), ...body }).expect(400);
    await pay(x.id, { clientUid: 'over', date: '2026-11-18', amount: 101 }).expect(409);
    expect(await db().collection('supplyinvoicepayments').countDocuments({ invoiceId: new Types.ObjectId(x.id) })).toBe(0);
  });
  it('после приёмки оплата разрешена, сторно запрещено и received не откатывается', async () => {
    const x = await fixture(50, { receiptBoundaryAt: new Date() });
    await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $set: { status: 'received' } });
    const r = (await pay(x.id, { clientUid: 'after-receipt', date: '2026-11-18', amount: 50 }).expect(200)).body;
    expect((await db().collection('supplyrequests').findOne({ _id: x.ids[0] }))!.status).toBe('received');
    await http().post(`/api/supply/invoices/${x.id}/payments/${r.payments[0].id}/void`).set(auth()).send({ confirm: true, reason: 'проверка', clientUid: 'blocked' }).expect(409);
  });
  it('legacy pay без тела работает через один ledger и безопасно повторяется', async () => {
    const x = await fixture(150);
    await http().post(`/api/supply/invoices/${x.id}/pay`).set(auth()).send({}).expect(200);
    await http().post(`/api/supply/invoices/${x.id}/pay`).set(auth()).send({}).expect(200);
    expect(await db().collection('supplyinvoicepayments').countDocuments({ invoiceId: new Types.ObjectId(x.id) })).toBe(1);
    await http().post(`/api/supply/invoices/${x.id}/pay`).set(auth()).send({ amount: 999 }).expect(400);
  });

  it('статьи: потомки/none/смешанный счёт, общий итог до пагинации и сочетание фильтров', async () => {
    const root = new Types.ObjectId(), child = new Types.ObjectId(), other = new Types.ObjectId();
    await db().collection('expensearticles').insertMany([{ _id: root, name: 'C158 parent', deletedAt: null }, { _id: child, name: 'C158 child', parentId: root, deletedAt: null }, { _id: other, name: 'C158 other', deletedAt: null }]);
    const a = await fixture(100, { no: 'C158-filter-a' }, 2), b = await fixture(200, { no: 'C158-filter-b' });
    await db().collection('supplyrequests').updateOne({ _id: a.ids[0] }, { $set: { articleId: child } });
    await db().collection('supplyrequests').updateOne({ _id: b.ids[0] }, { $set: { articleId: child } });
    const query = { articleId: String(root), q: 'C158-filter', supplierId: String(supplier), status: 'issued', limit: '1' };
    const r = (await http().get('/api/supply/invoices').set(auth()).query(query).expect(200)).body;
    expect(r).toMatchObject({ total: 2, sum: 300, limit: 1 }); expect(r.items).toHaveLength(1);
    const page2 = (await http().get('/api/supply/invoices').set(auth()).query({ ...query, page: '2' }).expect(200)).body;
    expect(page2.items).toHaveLength(1); expect(page2.items[0].id).not.toBe(r.items[0].id);
    const none = (await http().get('/api/supply/invoices').set(auth()).query({ ...query, articleId: 'none' }).expect(200)).body;
    expect(none).toMatchObject({ total: 1, sum: 100 }); expect(none.items[0].requestsCount).toBe(2);
    const empty = (await http().get('/api/supply/invoices').set(auth()).query({ ...query, articleId: String(other) }).expect(200)).body;
    expect(empty).toMatchObject({ total: 0, sum: 0, items: [] });
    const reqs = (await http().get('/api/supply/requests').set(auth()).query({ articleId: String(root) }).expect(200)).body;
    expect(reqs.items.filter((x: any) => [...a.ids, ...b.ids].some((id) => String(id) === x.id))).toHaveLength(2);
  });
  it('статья скрытой строки не раскрывает счёт; scoped агрегаты только по видимым allocations', async () => {
    const visible = new Types.ObjectId(), hidden = new Types.ObjectId(), article = new Types.ObjectId();
    await db().collection('expensearticles').insertOne({ _id: article, name: 'C158 скрытая', deletedAt: null });
    const x = await fixture(100, {}, 2);
    await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $set: { categoryId: visible } });
    await db().collection('supplyrequests').updateOne({ _id: x.ids[1] }, { $set: { categoryId: hidden, articleId: article } });
    await pay(x.id, { clientUid: 'scoped', amount: 60, date: '2026-11-18' }).expect(200);
    const scope = { categoryIds: [String(visible)], noCategory: false, zones: [{ id: 'test', categoryIds: new Set([String(visible)]), includeIds: new Set<string>(), excludeIds: new Set<string>(), noCategory: false }] };
    const service = ctx.module.get(SupplyInvoiceService);
    const excluded = await service.list({ articleId: String(article), q: 'C158-' + x.id }, scope);
    expect(excluded.total).toBe(0);
    const shown: any = await service.get(x.id, scope);
    expect(shown).toMatchObject({ partial: true, amount: 50, paidAmount: 30, sourcePaidAmount: 30, balanceDue: 20 });
    expect(shown.payments[0].allocations).toHaveLength(1);
    await expect(service.assertWhole(x.id, scope)).rejects.toMatchObject({ status: 403 });
  });
  it('платёжные файлы доступны деньгам, наблюдатель/manager без денег их не получает', async () => {
    const x = await fixture(100), photo = new Types.ObjectId();
    await db().collection('photos').insertOne({ _id: photo, storageUrl: '/uploads/c158-proof.pdf', originalFilename: 'подтверждение.pdf', mimeType: 'application/pdf', deletedAt: null });
    const r = (await pay(x.id, { clientUid: 'proof', amount: 10, date: '2026-11-18', fileIds: [String(photo)] }).expect(200)).body;
    expect(r.payments[0].files).toEqual([{ id: String(photo), name: 'подтверждение.pdf', url: '/uploads/c158-proof.pdf', mime: 'application/pdf' }]);
    for (const role of ['user', 'manager']) {
      const id = new Types.ObjectId(); await db().collection('users').insertOne({ _id: id, username: 'c158-' + id, role, isActive: true, permissions: [] });
      const signed = ctx.module.get(JwtService).sign({ sub: String(id), username: 'c158-' + id, role, version: 0 });
      if (role === 'manager') await db().collection('roles').updateOne({ name: role }, { $set: { money: false } });
      try {
        const card = (await http().get('/api/supply/invoices/' + x.id).set(authHeader(signed)).expect(200)).body;
        expect({ role, leaked: card.payments !== undefined }).toEqual({ role, leaked: false });
        for (const key of ['payments', 'paidAmount', 'sourceAmount', 'balanceDue', 'financialLines', 'paymentAccountingVersion', 'effectiveRate', 'sourceBalance', 'accountingAmountRub']) expect(card[key]).toBeUndefined();
        for (const line of card.requests || []) for (const key of ['sourceLineAmount', 'sourceUnitPrice', 'accountingLineAmountRub', 'sourceVatAmount']) expect(line[key]).toBeUndefined();
        await http().get('/api/supply/invoices/' + x.id + '/payments').set(authHeader(signed)).expect(403);
        await http().post('/api/supply/invoices/' + x.id + '/payments').set(authHeader(signed)).send({ clientUid: role, date: '2026-11-18', amount: 1 }).expect((r) => expect([400, 403]).toContain(r.status));
      } finally { if (role === 'manager') await db().collection('roles').updateOne({ name: role }, { $unset: { money: '' } }); }
    }
  });
  it('ленивое legacy unpay создаёт исторический факт и сторно, не переносит деньги в текущий месяц', async () => {
    const x = await fixture(100, { status: 'paid', paidAt: new Date('2026-09-17') });
    await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $set: { paid: true, paidAt: new Date('2026-09-17') } });
    const r = (await http().post('/api/supply/invoices/' + x.id + '/unpay').set(auth()).send({ confirm: true, reason: 'ошибочная старая оплата' }).expect(200)).body;
    expect(r).toMatchObject({ paymentAccountingVersion: 1, paymentState: 'unpaid', paidAmount: 0 });
    expect(r.payments).toHaveLength(1); expect(r.payments[0]).toMatchObject({ date: '2026-09-17', amount: 100, state: 'voided' });
    expect((await ops('2026-09-01', '2026-09-30')).ops.filter((o: any) => o.doc === 'C158-' + x.id)).toHaveLength(0);
  });
  it('явная RUB корректировка администратором сохраняет allocations и открывает остаток', async () => {
    const x = await fixture(100);
    await pay(x.id, { clientUid: 'before-adjust', date: '2026-11-18', amount: 100 }).expect(200);
    await http().patch('/api/supply/requests/' + x.ids[0]).set(auth()).send({ priceHint: 120, reason: 'уточнение первички' }).expect(200);
    const r = await get(x.id); expect(r).toMatchObject({ amount: 120, paidAmount: 100, balanceDue: 20, paymentState: 'partial', status: 'issued' });
    expect(r.payments[0].allocations[0].amountRub).toBe(100);
    expect(r.paymentAdjustments[0]).toMatchObject({ beforeAmount: 100, afterAmount: 120, delta: 20, reason: 'уточнение первички' });
  });
  it('валюта без исходных строк сохраняется unresolved; затем ввод360 восстанавливает30326RUB', async () => {
    const x = await fixture(30326);
    await http().patch('/api/supply/invoices/' + x.id).set(auth()).send({ vatMode: 'included', vatRate: 22 }).expect(200);
    const first = (await http().patch('/api/supply/invoices/' + x.id).set(auth()).send({ currency: 'UE', currencyName: 'по договору', confirmedAmountRub: 30326, conversionNote: 'бухгалтер' }).expect(200)).body;
    expect(first).toMatchObject({ sourceAmount: null, accountingAmountRub: null, accountingState: 'unresolved', amount: 0 });
    await pay(x.id, { clientUid: 'too-early', date: '2026-11-18', amount: 1, sourceAmount: 1 }).expect(409);
    const last = (await http().patch('/api/supply/invoices/' + x.id + '/lines/' + x.ids[0]).set(auth()).send({ sourceLineAmount: 360 }).expect(200)).body.invoice;
    expect(last).toMatchObject({ sourceAmount: 360, amount: 30326, accountingAmountRub: 30326 });
  });


  it('повтор создания полного набора заявок восстанавливает тот же счёт без дубликатов', async () => {
    const x = await fixture(100);
    const create = () => http().post('/api/supply/invoices').set(auth()).send({ requestIds: x.ids.map(String) });
    const r = (await create().expect(201)).body; expect(r.items.map((i: any) => i.id)).toEqual([x.id]);
    await create().expect(201);
    expect(await db().collection('supplyinvoices').countDocuments({ _id: new Types.ObjectId(x.id) })).toBe(1);
  });
  it('статья факта фиксируется на дату оплаты и не меняется вслед за категорией', async () => {
    const root = new Types.ObjectId(), child = new Types.ObjectId(), category = new Types.ObjectId(), x = await fixture(100);
    await db().collection('expensearticles').insertMany([{ _id: root, name: 'snapshot parent', deletedAt: null }, { _id: child, name: 'snapshot child', parentId: root, categoryIds: [category], deletedAt: null }]);
    await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $set: { categoryId: category } });
    const r = (await pay(x.id, { clientUid: 'article-snapshot', amount: 100, date: '2026-11-18' }).expect(200)).body;
    expect(String(r.payments[0].allocations[0].articleId)).toBe(String(child));
    await db().collection('expensearticles').updateOne({ _id: child }, { $set: { categoryIds: [] } });
    const fact = (await ops('2026-11-01', '2026-11-30')).ops.find((o: any) => o.doc === 'C158-' + x.id);
    expect(fact.articleId).toBe(String(child));
    await http().delete('/api/admin/collections/supplyinvoicepayments').set(auth()).expect(409);
  });


  it.each(FOREIGN_INVOICE_CURRENCIES)('unresolved %s840 до ledger и остаток440 после аванса видны без ложного RUB в pending/forecast', async (currency) => {
    const x = await fixture(0, { date: new Date('2026-11-18'), currency, currencyName: currency === 'UE' ? 'по договору' : undefined, status: 'draft' });
    await db().collection('supplyinvoices').updateOne({ _id: new Types.ObjectId(x.id) }, { $set: { financialLines: { [String(x.ids[0])]: { sourceLineAmount: 840 } } } });
    const issued = (await http().patch('/api/supply/invoices/' + x.id).set(auth()).send({ issue: true }).expect(200)).body;
    expect(issued).toMatchObject({ status: 'issued', sourceAmount: 840, accountingAmountRub: null });
    const finance = ctx.module.get(FinanceService);
    const read = () => finance.cashflow({ from: '2026-11-01', to: '2026-11-30', org: String(payer) });
    let cf = await read(); let item = cf.pending.needsConversion.items.find((i: any) => i.invoiceId === x.id);
    expect(item).toMatchObject({ sourceBalance: 840, currency, balanceDue: null, accountingState: 'unresolved' });
    expect(cf.pending.invoices.items.filter((i: any) => i.invoiceId === x.id)).toHaveLength(0);
    await pay(x.id, { clientUid: 'unresolved-advance', amount: 32000, sourceAmount: 400, date: '2026-11-18' }).expect(200);
    cf = await read(); item = cf.pending.needsConversion.items.find((i: any) => i.invoiceId === x.id);
    expect(item).toMatchObject({ sourceBalance: 440, sourcePaidAmount: 400, currency });
    const ff = await finance.forecast({ days: 30, today: '2026-11-19', org: String(payer) });
    expect(ff.needsConversion.items.find((i: any) => i.invoiceId === x.id)).toMatchObject({ sourceBalance: 440, balanceDue: null });
    expect(ff.days.flatMap((d: any) => d.ops).filter((i: any) => i.invoiceId === x.id)).toHaveLength(0);
    await pay(x.id, { clientUid: 'unresolved-final', amount: 36080, sourceAmount: 440, date: '2026-11-19' }).expect(200);
    expect((await read()).pending.needsConversion.items.some((i: any) => i.invoiceId === x.id)).toBe(false);
  });
  it.each(FOREIGN_INVOICE_CURRENCIES)('известный %s остаток помечен оценкой в календаре и прогнозе до/после ledger', async (currency) => {
    const x = await fixture(67200, { date: new Date('2026-11-18'), currency, currencyName: currency === 'UE' ? 'по договору' : undefined, exchangeRate: 80 });
    await db().collection('supplyinvoices').updateOne({ _id: new Types.ObjectId(x.id) }, { $set: { financialLines: { [String(x.ids[0])]: { sourceLineAmount: 840 } } } });
    const finance = ctx.module.get(FinanceService);
    const a = await finance.cashflow({ from: '2026-11-01', to: '2026-11-30', org: String(payer) });
    expect(a.pending.invoices.items.find((i: any) => i.invoiceId === x.id)).toMatchObject({ amount: 67200, balanceEstimated: true, currency, sourceBalance: 840 });
    await pay(x.id, { clientUid: 'estimated-advance', amount: 32000, sourceAmount: 400, date: '2026-11-18' }).expect(200);
    const b = await finance.forecast({ days: 30, today: '2026-11-19', org: String(payer) });
    expect(b.days.flatMap((d: any) => d.ops).find((i: any) => i.invoiceId === x.id)).toMatchObject({ amount: 35200, balanceEstimated: true, currency, sourceBalance: 440 });
  });
  it('partial legacy snapshot и история корректировок не раскрывают скрытую строку/сумму', async () => {
    const visible = new Types.ObjectId(), hidden = new Types.ObjectId(), x = await fixture(150, { status: 'paid' }, 2);
    await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $set: { categoryId: visible, priceHint: 50 } });
    await db().collection('supplyrequests').updateOne({ _id: x.ids[1] }, { $set: { categoryId: hidden, priceHint: 100 } });
    await db().collection('supplyinvoices').updateOne({ _id: new Types.ObjectId(x.id) }, { $set: { paymentSnapshot: { amount: 150, paidAt: new Date('2026-09-17'), lines: [{ requestId: x.ids[0], lineAmount: 50 }, { requestId: x.ids[1], lineAmount: 100 }] }, paymentAdjustments: [{ operation: 'line_edit', requestIds: x.ids, beforeAmount: 200, afterAmount: 150, delta: -50, reason: 'сверка' }] } });
    const scope = { categoryIds: [String(visible)], noCategory: false, zones: [{ id: 'legacy-test', categoryIds: new Set([String(visible)]), includeIds: new Set<string>(), excludeIds: new Set<string>(), noCategory: false }] };
    const service = ctx.module.get(SupplyInvoiceService), card: any = await service.get(x.id, scope);
    expect(card).toMatchObject({ amount: 50, paidAmount: 50, sourcePaidAmount: 50 });
    expect(card.paymentSnapshot.amount).toBe(50); expect(card.paymentSnapshot.lines).toHaveLength(1);
    expect(card.paymentAdjustments[0].beforeAmount).toBeUndefined(); expect(card.paymentAdjustments[0].requestIds.map(String)).toEqual([String(x.ids[0])]);
    const list = await service.list({ q: 'C158-' + x.id }, scope);
    expect(list.items[0]).toMatchObject({ amount: 50, paidAmount: 50 });
    expect((list.items[0] as any).paymentSnapshot).toBeUndefined();
  });
  it('replay исходного тела после void и смены валюты не зависит от текущих defaults', async () => {
    const x = await fixture(100), body = { clientUid: 'immutable-body', amount: 100, date: '2026-11-18' };
    const first = (await pay(x.id, body).expect(200)).body;
    await http().post('/api/supply/invoices/' + x.id + '/payments/' + first.payments[0].id + '/void').set(auth()).send({ confirm: true, reason: 'исправление', clientUid: 'immutable-void' }).expect(200);
    await http().patch('/api/supply/invoices/' + x.id).set(auth()).send({ currency: 'UE', currencyName: 'условная' }).expect(200);
    await pay(x.id, body).expect(200);
    expect(await db().collection('supplyinvoicepayments').countDocuments({ invoiceId: new Types.ObjectId(x.id) })).toBe(1);
  });
  it('список использует полный агрегат, без передачи250 исторических фактов; карточка100 и GETpayments200', async () => {
    const x = await fixture(1000);
    const facts = Array.from({ length: 250 }, (_, i) => ({ invoiceId: new Types.ObjectId(x.id), clientUid: 'history-' + i, requestHash: 'test', amount: 1, sourceAmount: 1, payerCompanyId: payer, currency: 'RUB', date: '2026-09-17', state: i < 200 ? 'active' : 'voided', note: 'x'.repeat(1000), allocations: [{ requestId: x.ids[0], amountRub: 1, sourceAmount: 1, invoiceNo: 'C158-' + x.id }] }));
    await db().collection('supplyinvoicepayments').insertMany(facts);
    await db().collection('supplyinvoices').updateOne({ _id: new Types.ObjectId(x.id) }, { $set: { paymentAccountingVersion: 1, paidAmount: 200, sourcePaidAmount: 200 } });
    const list = (await http().get('/api/supply/invoices').set(auth()).query({ q: 'C158-' + x.id }).expect(200)).body;
    expect(list.items[0]).toMatchObject({ paidAmount: 200, balanceDue: 800, paymentsTotal: 250 });
    expect(list.items[0].payments).toBeUndefined(); expect(list.items[0].files).toBeUndefined(); expect(JSON.stringify(list).length).toBeLessThan(5000);
    const card = await get(x.id); expect(card.payments).toHaveLength(100); expect(card.paidAmount).toBe(200); expect(card.paymentsTotal).toBe(250);
    const page = (await http().get('/api/supply/invoices/' + x.id + '/payments').set(auth()).query({ limit: 200 }).expect(200)).body;
    expect(page.items).toHaveLength(200); expect(page).toMatchObject({ total: 250, limit: 200 });
    const nov = await ops('2026-11-01', '2026-11-30'); expect(nov.ops.some((o: any) => o.doc === 'C158-' + x.id)).toBe(false);
  });


  it('legacy snapshot другой компании и месяца глобально подавляет paid-заявку текущего периода', async () => {
    const other = new Types.ObjectId();
    await db().collection('organizations').insertOne({ _id: other, inn: '9900000358', name: 'C158 другая наша', shortName: 'C158other', isOurCompany: true, deletedAt: null });
    const x = await fixture(100, { status: 'paid' });
    await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $set: { paid: true, paidAt: new Date('2026-11-18') } });
    await db().collection('supplyinvoices').updateOne({ _id: new Types.ObjectId(x.id) }, { $set: { paymentSnapshot: { amount: 100, paidAt: new Date('2026-09-17'), lines: [{ requestId: x.ids[0], lineAmount: 100, companyId: other, invoiceNo: 'C158-' + x.id }] } } });
    const current = await ops('2026-11-01', '2026-11-30');
    expect(current.ops.filter((o: any) => o.doc === 'C158-' + x.id)).toHaveLength(0);
    const historical = await (ctx.module.get(FinanceService) as any).ops('2026-09-01', '2026-09-30', [other]);
    expect(historical.ops.filter((o: any) => o.doc === 'C158-' + x.id)).toHaveLength(1);
  });


  it.each(['currency', 'payerCompanyId'])('omittedversion: смена %s между чтениями даёт409 без факта и marker', async (field) => {
    const x = await fixture(100), ledger = ctx.module.get(SupplyInvoicePaymentsService) as any;
    const original = ledger.load.bind(ledger);
    let firstRead = true;
    const barrier = jest.spyOn(ledger, 'load').mockImplementation(async (...args: unknown[]) => {
      const inv = await original(...args);
      if (firstRead) {
        firstRead = false;
        await db().collection('supplyinvoices').updateOne({ _id: inv._id }, { $set: { [field]: field === 'currency' ? 'USD' : new Types.ObjectId(), version: 1 } });
      }
      return inv;
    });
    try { const response = await pay(x.id, { clientUid: 'first-defaults-' + field, amount: 10, date: '2026-11-18' }).expect(409); expect(response.body.code).toBe('INVOICE_VERSION_CONFLICT'); } finally { barrier.mockRestore(); }
    expect(await db().collection('supplyinvoicepayments').countDocuments({ invoiceId: new Types.ObjectId(x.id) })).toBe(0);
    expect((await db().collection('supplyinvoices').findOne({ _id: new Types.ObjectId(x.id) }))!.paymentAccountingVersion).toBeUndefined();
  });
  it('несогласованный legacy безsnapshot виден как сверка в list/card и не пишет новых фактов', async () => {
    const x = await fixture(153980, { status: 'paid', amount: 36824.24 });
    const card = await get(x.id), list = (await http().get('/api/supply/invoices').set(auth()).query({ q: 'C158-' + x.id }).expect(200)).body;
    for (const row of [card, list.items[0]]) {
      expect(row).toMatchObject({ paymentState: 'reconciliation', reconciliationRequired: true, paidAmount: null, sourcePaidAmount: null, balanceDue: null, sourceBalance: null, sourceAmount: 153980, accountingAmountRub: 153980 });
      expect(row.warnings.length).toBeGreaterThan(0); expect(row.warnings.join(' ')).not.toMatch(/36824|153980/);
    }
    await pay(x.id, { clientUid: 'ambiguous', amount: 10, date: '2026-11-18' }).expect(409);
    await http().post('/api/supply/invoices/' + x.id + '/pay').set(auth()).send({}).expect(409);
    expect(await db().collection('supplyinvoicepayments').countDocuments({ invoiceId: new Types.ObjectId(x.id) })).toBe(0);
  });
  it('несогласованный snapshot сохраняет известную сумму оплаты, но не вычисляет долг', async () => {
    const x = await fixture(120, { status: 'paid' });
    await db().collection('supplyinvoices').updateOne({ _id: new Types.ObjectId(x.id) }, { $set: { paymentSnapshot: { amount: 100, paidAt: new Date('2026-09-17'), lines: [{ requestId: x.ids[0], lineAmount: 100, companyId: payer }] } } });
    const card = await get(x.id); expect(card).toMatchObject({ paymentState: 'reconciliation', reconciliationRequired: true, paidAmount: 100, sourcePaidAmount: 100, sourceBalance: null, balanceDue: null });
    const historical = await ops('2026-09-01', '2026-09-30');
    expect(historical.ops.find((o: any) => o.id === String(x.ids[0])).amount).toBe(100);
  });
  it('invoice_paid цена записывается лишь при полной оплате, транзакционно и без replay-дубля', async () => {
    const x = await fixture(100), material = new Types.ObjectId();
    await db().collection('materials').insertOne({ _id: material, name: 'C158 история оплаты', unit: 'шт', deletedAt: null });
    await db().collection('supplyrequests').updateOne({ _id: x.ids[0] }, { $set: { materialId: material } });
    const partial = { clientUid: 'price-partial', amount: 40, date: '2026-11-18' }, final = { clientUid: 'price-final', amount: 60, date: '2026-11-19' };
    await pay(x.id, partial).expect(200); await pay(x.id, partial).expect(200);
    expect(await db().collection('materialprices').countDocuments({ materialId: material, source: 'invoice_paid' })).toBe(0);
    const full = (await pay(x.id, final).expect(200)).body; await pay(x.id, final).expect(200);
    expect(await db().collection('materialprices').countDocuments({ materialId: material, source: 'invoice_paid' })).toBe(1);
    const recorded = await db().collection('materialprices').findOne({ materialId: material, source: 'invoice_paid' });
    await http().post('/api/supply/invoices/' + x.id + '/payments/' + full.payments.find((p: any) => p.clientUid === final.clientUid).id + '/void').set(auth()).send({ confirm: true, clientUid: 'price-void', reason: 'ошибка ввода' }).expect(200);
    expect((await db().collection('materialprices').findOne({ _id: recorded!._id }))!.updatedAt).toEqual(recorded!.updatedAt);
  });

});
