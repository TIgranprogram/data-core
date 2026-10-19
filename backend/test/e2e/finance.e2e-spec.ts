import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * Деньги (TASKS Ф.1–Ф.5): дата счёта у заявки, доходы (/api/incomes), платёжный календарь и сводка (/api/finance).
 * Расход = заявка с датой счёта + суммой + нашей компанией; доход = строка заказа с суммой и датой в отчёт.
 */
describe('Finance: incomes + cashflow', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  const req = (body: object) => http().post('/api/supply/requests').set(auth()).send(body).expect(201);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['supplyrequests', 'incomes', 'organizations', 'categories']) await db().collection(c).deleteMany({});
    await db().collection('organizations').insertMany([
      { name: 'СИЮ', shortName: 'СИЮ', inn: 'T-SIU', isOurCompany: true, type: [], deletedAt: null },
      { name: 'ССЮ', shortName: 'ССЮ', inn: 'T-SSU', isOurCompany: true, type: [], deletedAt: null },
    ]);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('дата счёта у заявки: дд.мм.гггг принимается, мусор — 400, пустая строка очищает', async () => {
    const r = await req({ title: 'Болты', priceHint: 1000, companyName: 'СИЮ', categoryName: 'Метизы', invoiceNo: 'С-1', invoiceDate: '01.10.2026' });
    expect(r.body.invoiceDate.slice(0, 10)).toBe('2026-10-01');
    await http().patch(`/api/supply/requests/${r.body.id}`).set(auth()).send({ invoiceDate: 'вчера' }).expect(400);
    const cleared = await http().patch(`/api/supply/requests/${r.body.id}`).set(auth()).send({ invoiceDate: '' }).expect(200);
    expect(cleared.body.invoiceDate).toBeUndefined();
    await http().patch(`/api/supply/requests/${r.body.id}`).set(auth()).send({ invoiceDate: '2026-10-01' }).expect(200);
  });

  it('доходы: CRUD, «доход вручную» важнее кол-во × цена, статус, сумма, неизвестная компания — 400', async () => {
    const a = await http().post('/api/incomes').set(auth()).send({ orderNo: '34', customer: 'ООО Стройсервис', companyName: 'ССЮ', title: 'Флагшток', qty: 3, unitPrice: 1000, shipDate: '02.10.2026', clientUid: 'inc-1' }).expect(201);
    expect(a.body).toMatchObject({ amount: 3000, companyName: 'ССЮ', status: 'awaiting' });
    expect(a.body.reportDate.slice(0, 10)).toBe('2026-10-02');
    expect((await http().post('/api/incomes').set(auth()).send({ title: 'Флагшток', clientUid: 'inc-1' }).expect(201)).body.id).toBe(a.body.id);
    const paid = await http().patch(`/api/incomes/${a.body.id}`).set(auth()).send({ amountManual: 2500, paidDate: '2026-10-05' }).expect(200);
    expect(paid.body).toMatchObject({ amount: 2500, status: 'paid' });
    expect(paid.body.reportDate.slice(0, 10)).toBe('2026-10-05');
    const back = await http().patch(`/api/incomes/${a.body.id}`).set(auth()).send({ amountManual: null }).expect(200);
    expect(back.body.amount).toBe(3000);
    await http().post('/api/incomes').set(auth()).send({ title: 'x', companyName: 'Рога и копыта' }).expect(400);
    await http().post('/api/incomes').set(auth()).send({ qty: 1 }).expect(400);
    await http().post('/api/incomes').set(auth()).send({ title: 'Без цены', companyName: 'СИЮ', qty: 2 }).expect(201); // в «требуют заполнения»
    const list = await http().get('/api/incomes?sort=-amount').set(auth()).expect(200);
    expect(list.body).toMatchObject({ total: 2, sum: 3000, counts: { all: 2, paid: 1, awaiting: 0, draft: 1 } });
    expect((await http().get('/api/incomes?status=paid').set(auth()).expect(200)).body.total).toBe(1);
    const tmp = await http().post('/api/incomes').set(auth()).send({ title: 'Удалю', companyName: 'СИЮ' }).expect(201);
    await http().delete(`/api/incomes/${tmp.body.id}`).set(auth()).expect(200);
    expect((await http().get('/api/incomes?deleted=1').set(auth()).expect(200)).body.total).toBe(1);
    await http().post(`/api/incomes/${tmp.body.id}/restore`).set(auth()).expect(200);
    await http().delete(`/api/incomes/${tmp.body.id}`).set(auth()).expect(200);
    const lk = await http().get('/api/incomes/lookups').set(auth()).expect(200);
    expect(lk.body.companies.map((c: { name: string }) => c.name).sort()).toEqual(['СИЮ', 'ССЮ']);
  });

  it('платёжный календарь: остаток переносится, разбивка по компаниям, операции дня, «требуют заполнения»', async () => {
    await req({ title: 'Скотч', priceHint: 500.25, companyName: 'ССЮ', categoryName: 'Расходники', invoiceDate: '2026-10-02' });
    await req({ title: 'Без суммы', companyName: 'СИЮ', invoiceDate: '2026-10-03' });
    await req({ title: 'Без даты', companyName: 'СИЮ', priceHint: 99 });
    await req({ title: 'Без компании', priceHint: 84, invoiceDate: '2026-10-03' });
    await req({ title: 'Отменена', priceHint: 1e6, companyName: 'СИЮ', invoiceDate: '2026-10-03', statusLabel: 'Отменено' });
    const r = await http().get('/api/finance/cashflow?from=2026-10-01&to=2026-10-05&opening=10000').set(auth()).expect(200);
    expect(r.body.companies).toEqual(['СИЮ', 'ССЮ']);
    const d = (date: string) => r.body.days.find((x: { date: string }) => x.date === date);
    expect(d('2026-10-01')).toMatchObject({ opening: 10000, expense: 1000, expenseBy: { СИЮ: 1000, ССЮ: 0 }, closing: 9000 });
    expect(d('2026-10-02')).toMatchObject({ opening: 9000, expense: 500.25, expenseBy: { ССЮ: 500.25 }, closing: 8499.75 });
    expect(d('2026-10-03')).toMatchObject({ expense: 0, closing: 8499.75 });
    expect(d('2026-10-05')).toMatchObject({ income: 3000, incomeBy: { ССЮ: 3000 }, closing: 11499.75 }); // «доход вручную» сняли выше — снова 3 × 1000
    expect(d('2026-10-05').ops[0]).toMatchObject({ type: 'income', title: 'Флагшток', doc: 'заказ 34', counterparty: 'ООО Стройсервис' });
    expect(d('2026-10-01').ops[0]).toMatchObject({ type: 'expense', doc: 'С-1', category: 'Метизы' });
    expect(r.body.totals).toMatchObject({ opening: 10000, income: 3000, expense: 1500.25, closing: 11499.75, expenseBy: { СИЮ: 1000, ССЮ: 500.25 } });
    const nf = r.body.needsFill.items.map((x: { title: string; missing: string[] }) => [x.title.replace(/^№\d+ · /, ''), x.missing.join(', ')]);
    expect(nf).toEqual(expect.arrayContaining([
      ['Без суммы', 'сумма'], ['Без даты', 'дата счёта'], ['Без компании', 'наша компания'], ['Без цены', 'сумма (кол-во × цена или вручную), дата отгрузки или оплаты'],
    ]));
    expect(nf.find((x: string[]) => x[0] === 'Отменена')).toBeUndefined();
    // одна компания
    const ssu = await http().get('/api/finance/cashflow?from=2026-10-01&to=2026-10-05&org=ССЮ').set(auth()).expect(200);
    expect(ssu.body.totals).toMatchObject({ expense: 500.25, income: 3000, closing: 2499.75 });
    await http().get('/api/finance/cashflow?org=Рога').set(auth()).expect(400);
    await http().get('/api/finance/cashflow?from=2026-10-05&to=2026-10-01').set(auth()).expect(400);
  });

  it('сводка: месяцы, прибыль по компаниям, расходы по категориям', async () => {
    const s = await http().get('/api/finance/summary?from=2026-09-01&to=2026-10-31').set(auth()).expect(200);
    expect(s.body.months.map((m: { month: string }) => m.month)).toEqual(['2026-09', '2026-10']);
    expect(s.body.total).toEqual({ СИЮ: { income: 0, expense: 1000, profit: -1000 }, ССЮ: { income: 3000, expense: 500.25, profit: 2499.75 } });
    expect(s.body.expensesByCategory).toEqual([
      { category: 'Метизы', byCompany: { СИЮ: 1000, ССЮ: 0 }, total: 1000 },
      { category: 'Расходники', byCompany: { СИЮ: 0, ССЮ: 500.25 }, total: 500.25 },
    ]);
  });
});
