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
    // расход считается по ОПЛАТЕ: все заявки выше — оплачены (paidAt нет → день счёта); одна неоплаченная — «счета к оплате»
    await db().collection('supplyrequests').updateMany({}, { $set: { paid: true } });
    await req({ title: 'Неоплаченный', priceHint: 700, companyName: 'СИЮ', invoiceDate: '2026-10-04' });
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
    expect(r.body.pending.invoices).toMatchObject({ total: 700, count: 1, byCompany: { СИЮ: 700, ССЮ: 0 } });
    expect(r.body.metrics).toMatchObject({ received: 3000, paid: 1500.25, saldo: 1499.75, invoicesToPay: 700 });
    const nf = r.body.needsFill.items.map((x: { title: string; missing: string[] }) => [x.title.replace(/^№\d+ · /, ''), x.missing.join(', ')]);
    expect(nf).toEqual(expect.arrayContaining([
      ['Без суммы', 'сумма'], ['Без даты', 'дата счёта'], ['Без компании', 'наша компания'], ['Без цены', 'сумма (кол-во × цена или вручную), дата отгрузки или оплаты'],
    ]));
    expect(nf.find((x: string[]) => x[0] === 'Отменена')).toBeUndefined();
    // одна компания
    const ssu = await http().get('/api/finance/cashflow?from=2026-10-01&to=2026-10-05&org=ССЮ').set(auth()).expect(200);
    expect(ssu.body.totals).toMatchObject({ expense: 500.25, income: 3000, closing: 2499.75 });
    // старт учёта: остаток от даты старта, операции раньше — серые и в остаток не входят
    await http().put('/api/finance/settings').set(auth()).send({ startDate: '2026-10-03', openingBalance: { СИЮ: 5000, ССЮ: 0 } }).expect(200);
    const st = await http().get('/api/finance/cashflow?from=2026-10-01&to=2026-10-05&opening=999').set(auth()).expect(200);
    expect(st.body.startDate).toBe('2026-10-03');
    expect(st.body.days.find((x: { date: string }) => x.date === '2026-10-01').ops[0].beforeStart).toBe(true);
    expect(st.body.days.find((x: { date: string }) => x.date === '2026-10-03').opening).toBe(5000);
    expect(st.body.totals.closing).toBe(8000);
    await http().put('/api/finance/settings').set(auth()).send({ startDate: null, openingBalance: {} }).expect(200);
    await http().get('/api/finance/cashflow?org=Рога').set(auth()).expect(400);
    await http().get('/api/finance/cashflow?from=2026-10-05&to=2026-10-01').set(auth()).expect(400);
  });

  it('частичные оплаты позиции и ФОТ', async () => {
    const a = await http().post('/api/incomes').set(auth()).send({ orderNo: '77', companyName: 'СИЮ', title: 'Горка', amountManual: 1000, shipDate: '2026-10-02' }).expect(201);
    const p1 = await http().post(`/api/incomes/${a.body.id}/payments`).set(auth()).send({ date: '2026-10-03', amount: 300, method: 'нал' }).expect(200);
    expect(p1.body).toMatchObject({ status: 'partial', paidAmount: 300, debt: 700 });
    await http().post(`/api/incomes/${a.body.id}/payments`).set(auth()).send({ date: '2026-10-04', amount: 800 }).expect(400);
    const p2 = await http().post(`/api/incomes/${a.body.id}/payments`).set(auth()).send({ date: '2026-10-04', amount: 700 }).expect(200);
    expect(p2.body).toMatchObject({ status: 'paid', paidAmount: 1000, debt: 0 });
    expect(p2.body.paidDate.slice(0, 10)).toBe('2026-10-04');
    const del = await http().delete(`/api/incomes/${a.body.id}/payments/1`).set(auth()).expect(200);
    expect(del.body).toMatchObject({ status: 'partial', paidAmount: 300 });
    const cf = await http().get('/api/finance/cashflow?from=2026-10-03&to=2026-10-03').set(auth()).expect(200);
    expect(cf.body.days[0].ops.find((o: { title: string }) => o.title.startsWith('Горка'))).toMatchObject({ amount: 300, method: 'нал' });
    expect(cf.body.pending.awaiting.total).toBeGreaterThanOrEqual(700);
    await http().delete(`/api/incomes/${a.body.id}`).set(auth()).expect(409); // HARDEN-1 п.14: с оплатой удалить нельзя
    await http().delete(`/api/incomes/${a.body.id}/payments/0`).set(auth()).expect(200);
    await http().delete(`/api/incomes/${a.body.id}`).set(auth()).expect(200); // не мешать сводке и прогнозу
    // ФОТ: ставка + табель → начислено, выплата → в календарь
    const siu = (await db().collection('organizations').findOne({ shortName: 'СИЮ' }))!;
    const pid = (await db().collection('persons').insertOne({ firstName: 'Иван', lastName: 'Тест-ФОТ', status: 'active', salaryKind: 'hour', salaryRate: 400, companyId: siu._id, deletedAt: null })).insertedId;
    await http().put('/api/payroll/timesheet').set(auth()).send({ personId: String(pid), month: '2026-10', hours: 100 }).expect(200);
    await http().post('/api/payroll/payments').set(auth()).send({ personId: String(pid), companyId: String(siu._id), date: '2026-10-05', amount: 10000, kind: 'advance' }).expect(200);
    const s = await http().get('/api/payroll/summary?month=2026-10').set(auth()).expect(200);
    expect(s.body.items.find((x: { name: string }) => x.name.includes('Тест-ФОТ'))).toMatchObject({ accrued: 40000, paid: 10000, balance: 30000, companyName: 'СИЮ' });
    const fot = await http().get('/api/finance/cashflow?from=2026-10-05&to=2026-10-05').set(auth()).expect(200);
    expect(fot.body.days[0].ops.find((o: { category?: string }) => o.category === 'ФОТ')).toMatchObject({ amount: 10000, type: 'expense' });
    await db().collection('persons').deleteOne({ _id: pid });
    await db().collection('payroll_payments').deleteMany({});
    await db().collection('payroll_timesheets').deleteMany({});
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
  it('оплата без суммы — 400 с объяснением; после «Вписать сумму» — можно; статус «Без суммы» → «Ждём оплату» → «Оплачено»', async () => {
    const row = (await http().post('/api/incomes').set(auth()).send({ title: 'Скамья без цены', qty: 2, unit: 'шт', companyName: 'СИЮ', shipDate: '2026-10-01', clientUid: 'noamount-1' }).expect(201)).body;
    expect(row.status).toBe('noamount');
    const bad = await http().patch(`/api/incomes/${row.id}`).set(auth()).send({ paidDate: '2026-10-05' }).expect(400);
    expect(bad.body.message).toContain('Сначала впишите сумму');
    const priced = (await http().patch(`/api/incomes/${row.id}`).set(auth()).send({ unitPrice: 1500 }).expect(200)).body;
    expect(priced).toMatchObject({ amount: 3000, status: 'awaiting' });
    const paid = (await http().patch(`/api/incomes/${row.id}`).set(auth()).send({ paidDate: '2026-10-05' }).expect(200)).body;
    expect(paid.status).toBe('paid');
    // «Отменить оплату»
    expect((await http().patch(`/api/incomes/${row.id}`).set(auth()).send({ paidDate: '' }).expect(200)).body.status).toBe('awaiting');
    await http().delete(`/api/incomes/${row.id}`).set(auth()).expect(200); // ожидаемое поступление не должно попасть в прогноз
  });

  it('БЗ-1: прогноз — будущие выплаты и поступления, разрыв, «без срока», роли', async () => {
    const day = (n: number) => new Date(Date.parse('2030-01-10T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    const today = day(0);
    const orgs = await db().collection('organizations').find({ isOurCompany: true, deletedAt: null }).toArray();
    const co = String(orgs[0].shortName || orgs[0].name);
    await http().post('/api/supply/requests').set(auth()).send({ title: 'Металл прогноз', qty: 1, priceHint: 150000, companyName: co, invoiceDate: day(3), statusLabel: 'В работе', clientUid: 'fc-e1' }).expect(201);
    await http().post('/api/supply/requests').set(auth()).send({ title: 'Краска без даты', qty: 1, priceHint: 40000, companyName: co, statusLabel: 'Заказать', clientUid: 'fc-e2' }).expect(201);
    const f = (await http().get('/api/finance/forecast').query({ days: 30, opening: 100000, today, org: co }).set(auth()).expect(200)).body;
    expect(f).toMatchObject({ from: today, to: day(29), opening: 100000 });
    expect(f.days).toHaveLength(30);
    expect(f.totals.expense).toBe(150000);
    expect(f.firstGap).toBe(day(3));
    expect(f.minBalance.amount).toBe(-50000);
    expect(f.noDate.items.some((x: { title: string }) => x.title.includes('Краска без даты'))).toBe(true);
    await http().get('/api/finance/forecast').query({ days: 5 }).set(auth()).expect(400);
  });

});
