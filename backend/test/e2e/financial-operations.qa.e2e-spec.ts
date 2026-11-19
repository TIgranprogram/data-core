import request from 'supertest';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

describe('C159 QA: идемпотентность идентичности и согласованность отчётов', () => {
  let ctx: TestContext, token: AuthTokens;
  const db = () => ctx.connection.db!, http = () => request(ctx.app.getHttpServer()), auth = () => authHeader(token.access);
  async function setup() {
    const payer = new Types.ObjectId(), root = new Types.ObjectId(), other = new Types.ObjectId(), a = new Types.ObjectId(), b = new Types.ObjectId(), incomeRoot = new Types.ObjectId(), ia = new Types.ObjectId(), ib = new Types.ObjectId();
    const name = 'QA C159 ' + payer;
    await db().collection('organizations').insertOne({ _id: payer, name, shortName: name, inn: String(payer), isOurCompany: true, deletedAt: null });
    await db().collection('expensearticles').insertMany([
      { _id: root, name: 'QA Материалы ' + root, type: 'expense', nodeKind: 'group', selectable: false, parentId: null },
      { _id: other, name: 'QA Новая группа ' + other, type: 'expense', nodeKind: 'group', selectable: false, parentId: null },
      { _id: a, name: 'QA Исходная', type: 'expense', nodeKind: 'article', selectable: true, parentId: root },
      { _id: b, name: 'QA Уточнённая', type: 'expense', nodeKind: 'article', selectable: true, parentId: root },
      { _id: incomeRoot, name: 'QA Поступления ' + incomeRoot, type: 'income', nodeKind: 'group', selectable: false, parentId: null },
      { _id: ia, name: 'QA Работы', type: 'income', nodeKind: 'article', selectable: true, parentId: incomeRoot },
      { _id: ib, name: 'QA Другая доходная', type: 'income', nodeKind: 'article', selectable: true, parentId: incomeRoot },
    ].map(x => ({ ...x, deletedAt: null, archivedAt: null, version: 0, categoryIds: [] })));
    return { payer, name, root, other, a, b, incomeRoot, ia, ib };
  }
  const list = async (payer: Types.ObjectId, extra: object = {}) => (await http().get('/api/finance/operations').set(auth()).query({ from: '2026-11-16', to: '2026-11-16', companyId: String(payer), ...extra }).expect(200)).body;
  const classify = (id: string, articleId: Types.ObjectId, uid: string) => http().patch('/api/finance/operations/' + encodeURIComponent(id) + '/classification').set(auth()).send({ articleId: String(articleId), version: 0, reason: 'Уточнение QA по первичке', clientUid: uid });
  async function articlePatch(id: Types.ObjectId, fields: object) {
    const row = (await http().get('/api/dicts/financialArticles/' + id).set(auth()).expect(200)).body;
    const tree = (await http().get('/api/financial-articles').set(auth()).query({ includeArchived: 1 }).expect(200)).body;
    await http().patch('/api/dicts/financialArticles/' + id).set(auth()).send({ version: row.version, expectedTreeRevision: tree.revision, ...fields }).expect(200);
  }
  beforeAll(async () => { ctx = await createTestApp({ strictValidation: true }); token = await loginAsAdmin(ctx.app); });
  afterAll(async () => { await ctx?.cleanup(); });

  it('materialize replay после correction и source notes сохраняет старый mapping без новых ID/audit', async () => {
    const s = await setup(), id = new Types.ObjectId();
    await db().collection('incomes').insertOne({ _id: id, title: 'QA Две одинаковые старые части', amount: 100, amountManual: 100, paidAmount: 100, companyId: s.payer, paidDate: new Date('2026-11-16'), payments: [{ date: new Date('2026-11-16'), amount: 50 }, { date: new Date('2026-11-16'), amount: 50 }], deletedAt: null });
    const plan = (await http().get('/api/incomes/' + id + '/payments/identity-plan').set(auth()).expect(200)).body;
    const body = { confirm: true, version: plan.version, planHash: plan.planHash, clientUid: 'qa-identities-stable' };
    const first = (await http().post('/api/incomes/' + id + '/payments/materialize').set(auth()).send(body).expect(200)).body;
    const stable = first.payments.map((p: { paymentId: string }) => p.paymentId);
    const op = (await list(s.payer)).items[0]; await classify(op.operationId, s.ia, 'qa-after-prepare').expect(200);
    await http().patch('/api/incomes/' + id).set(auth()).send({ notes: 'Позднее уточнение примечания' }).expect(200);
    const retry = (await http().post('/api/incomes/' + id + '/payments/materialize').set(auth()).send(body).expect(200)).body;
    expect(retry.identityMapping).toEqual(first.identityMapping);
    const current = (await http().get('/api/incomes/' + id).set(auth()).expect(200)).body;
    expect(current.payments.map((p: { paymentId: string }) => p.paymentId)).toEqual(stable);
    expect((await list(s.payer)).items.find((r: { operationId: string }) => r.operationId === op.operationId).articleId).toBe(String(s.ia));
    expect((await list(s.payer))).toMatchObject({ total: 2, totals: { income: 100 } });
    expect(await db().collection('auditlogs').countDocuments({ action: 'income.payment-identities.materialized', entityId: id })).toBe(1);
    await http().post('/api/incomes/' + id + '/payments/materialize').set(auth()).send({ ...body, planHash: '0'.repeat(64) }).expect(409);
    await http().post('/api/incomes/' + id + '/payments/materialize').set(auth()).send({ ...body, amount: 1 }).expect(400);
  });

  it('ledger/income/expense после correction и rename/reparent/archive сходятся во всех денежных разрезах', async () => {
    const s = await setup(), invoice = new Types.ObjectId(), rid = new Types.ObjectId();
    await db().collection('supplyinvoices').insertOne({ _id: invoice, no: 'QA-C159-' + invoice, date: new Date('2026-11-16'), amount: 20, status: 'issued', payerCompanyId: s.payer, version: 0, deletedAt: null });
    await db().collection('supplyrequests').insertOne({ _id: rid, invoiceId: invoice, title: 'QA Поставка', qty: 1, unit: 'шт', priceHint: 20, articleId: s.a, companyId: s.payer, status: 'ordered', paid: false, deletedAt: null });
    await http().post('/api/supply/invoices/' + invoice + '/payments').set(auth()).send({ clientUid: 'qa-supply', amount: 20, date: '2026-11-16' }).expect(200);
    const inc = (await http().post('/api/incomes').set(auth()).send({ title: 'QA Доход', amountManual: 50, companyId: String(s.payer), articleId: String(s.ia) }).expect(201)).body;
    await http().post('/api/incomes/' + inc.id + '/payments').set(auth()).send({ amount: 50, date: '2026-11-16', clientUid: 'qa-income' }).expect(200);
    await http().post('/api/expenses').set(auth()).send({ title: 'QA Прочий расход', amount: 10, date: '2026-11-16', companyId: String(s.payer), articleId: String(s.a) }).expect(201);
    const before = await list(s.payer);
    for (const row of before.items) await classify(row.operationId, row.type === 'income' ? s.ib : s.b, 'qa-class-' + row.operationId).expect(200);
    await articlePatch(s.b, { name: 'QA Уточнённая после переименования' });
    await articlePatch(s.b, { parentId: String(s.other) });
    await articlePatch(s.b, { archivedAt: new Date().toISOString() });
    const after = await list(s.payer, { limit: 1 }); expect(after.totals).toEqual(before.totals); expect(after).toMatchObject({ total: 3, totals: { income: 50, expense: 30, net: 20 } });
    const ids: string[] = [];
    for (let page = 1; page <= 3; page++) { const data = await list(s.payer, { limit: 1, page }); expect(data.totals).toEqual(after.totals); ids.push(data.items[0].operationId); }
    expect(new Set(ids).size).toBe(3); expect(ids.sort()).toEqual(before.items.map((r: { operationId: string }) => r.operationId).sort());
    const filtered = await list(s.payer, { type: 'expense', articleId: String(s.other) }); expect(filtered).toMatchObject({ total: 2, totals: { expense: 30 } });
    const by = (await http().get('/api/finance/by-articles').set(auth()).query({ from: '2026-11-16', to: '2026-11-16', companyId: String(s.payer) }).expect(200)).body;
    expect(by.head.totals).toMatchObject({ income: 50, expense: 30 }); expect(by.articleRows.find((r: { id: string }) => r.id === String(s.other)).total).toBe(30);
    const cf = (await http().get('/api/finance/cashflow').set(auth()).query({ from: '2026-11-16', to: '2026-11-16', org: String(s.payer) }).expect(200)).body;
    expect(cf.totals).toMatchObject({ income: 50, expense: 30 });
    expect(cf.days.flatMap((d: { ops: { type: string; articleId: string }[] }) => d.ops).filter((r: { type: string }) => r.type === 'expense').every((r: { articleId: string }) => r.articleId === String(s.b))).toBe(true);
    const summary = (await http().get('/api/finance/summary').set(auth()).query({ from: '2026-11-16', to: '2026-11-16', org: String(s.payer) }).expect(200)).body;
    expect(summary.total[s.name]).toMatchObject({ income: 50, expense: 30, profit: 20 });
    const fact = await db().collection('supplyinvoicepayments').findOne({ invoiceId: invoice }); expect(fact).toMatchObject({ amount: 20, date: '2026-11-16', state: 'active' }); expect(String(fact!.allocations[0].articleId)).toBe(String(s.a));
  });
});
