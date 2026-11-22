import { IncomeCancelService } from '../../src/modules/incomes/income-cancel.service';
import { IncomesService } from '../../src/modules/incomes/incomes.service';
import { setRoleSections, deleteRoleSections } from '../../src/common/app-sections';
import { canSeePayroll } from '../../src/common/roles-hierarchy';
import { FinancialClassificationService } from '../../src/modules/finance/financial-classification.service';
import request from 'supertest';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { FinancialOperationsReader } from '../../src/modules/finance/financial-operations-reader.service';
import { FinanceService } from '../../src/modules/finance/finance.service';

describe('C161: канонические операции и типизированная классификация', () => {
  let ctx: TestContext, token: AuthTokens, sequence = 9900159000;
  const db = () => ctx.connection.db!, http = () => request(ctx.app.getHttpServer()), auth = () => authHeader(token.access);
  const company = async () => { const id = new Types.ObjectId(); await db().collection('organizations').insertOne({ _id: id, name: 'C159 ' + id, shortName: 'C159 ' + id, inn: String(sequence++), isOurCompany: true, deletedAt: null }); return id; };
  const articles = async () => {
    const exp = new Types.ObjectId(), mid = new Types.ObjectId(), a = new Types.ObjectId(), b = new Types.ObjectId(), inc = new Types.ObjectId(), ia = new Types.ObjectId(), ib = new Types.ObjectId();
    await db().collection('expensearticles').insertMany([
      { _id: exp, name: 'Расходы ' + exp, type: 'expense', nodeKind: 'group', selectable: false, parentId: null },
      { _id: mid, name: 'Основание', type: 'expense', nodeKind: 'group', selectable: false, parentId: exp },
      { _id: a, name: 'Бетон', type: 'expense', nodeKind: 'article', selectable: true, parentId: mid }, { _id: b, name: 'Сетка', type: 'expense', nodeKind: 'article', selectable: true, parentId: mid },
      { _id: inc, name: 'Доходы ' + inc, type: 'income', nodeKind: 'group', selectable: false, parentId: null }, { _id: ia, name: 'Работы', type: 'income', nodeKind: 'article', selectable: true, parentId: inc }, { _id: ib, name: 'Доставка', type: 'income', nodeKind: 'article', selectable: true, parentId: inc },
    ].map(r => ({ ...r, deletedAt: null, version: 0, categoryIds: [] })));
    return { exp, mid, a, b, inc, ia, ib };
  };
  const invoice = async (payer: Types.ObjectId, articleA: Types.ObjectId, articleB: Types.ObjectId) => {
    const id = new Types.ObjectId(), rows = [new Types.ObjectId(), new Types.ObjectId()];
    await db().collection('supplyinvoices').insertOne({ _id: id, no: 'C159-' + id, date: new Date('2026-11-15'), amount: 255000, status: 'issued', payerCompanyId: payer, version: 0, deletedAt: null });
    await db().collection('supplyrequests').insertMany(rows.map((_id, i) => ({ _id, invoiceId: id, title: i ? 'Сетка' : 'Бетон', qty: 1, unit: 'шт', priceHint: i ? 102000 : 153000, articleId: i ? articleB : articleA, companyId: payer, invoiceDate: new Date('2026-11-15'), costCenter: 'smr', costObject: 'Донбасская6', status: 'ordered', paid: false, deletedAt: null })));
    for (const [clientUid, amount, date] of [['advance', 55000, '2026-11-16'], ['final', 200000, '2026-11-17']]) await http().post('/api/supply/invoices/' + id + '/payments').set(auth()).send({ clientUid, amount, date }).expect(200);
    return { id, rows };
  };
  const income = async (payer: Types.ObjectId, article: Types.ObjectId, amount = 100000) => (await http().post('/api/incomes').set(auth()).send({ title: 'Работы C159', amountManual: amount, companyId: String(payer), articleId: String(article) }).expect(201)).body;
  const operations = async (payer: Types.ObjectId, extra: object = {}) => (await http().get('/api/finance/operations').set(auth()).query({ from: '2026-11-01', to: '2026-11-19', companyId: String(payer), ...extra }).expect(200)).body;
  const classify = (id: string, body: object) => http().patch('/api/finance/operations/' + encodeURIComponent(id) + '/classification').set(auth()).send(body);
  beforeAll(async () => { ctx = await createTestApp({ strictValidation: true }); token = await loginAsAdmin(ctx.app); });
  afterAll(async () => { await ctx?.cleanup(); });

  it('7фактов:2allocation×2платежа+2дохода+расход; totals до пагинации, BOTH и3уровня', async () => {
    const payer = await company(), a = await articles(); await invoice(payer, a.a, a.b);
    const inc = await income(payer, a.ia);
    await http().post('/api/incomes/' + inc.id + '/payments').set(auth()).send({ date: '2026-11-16', amount: 60000, clientUid: 'in60' }).expect(200);
    await http().post('/api/incomes/' + inc.id + '/payments').set(auth()).send({ date: '2026-11-17', amount: 40000, articleId: null, clientUid: 'in40' }).expect(200);
    await http().post('/api/expenses').set(auth()).send({ date: '2026-11-18', amount: 7455, companyId: String(payer), articleId: String(a.b), title: 'Интернет', costCenter: 'workshop', costObject: 'Цех' }).expect(201);
    const started=performance.now();
    const first = await operations(payer, { limit: 2 });
    console.log('C159 list pipeline ms='+Math.round((performance.now()-started)*100)/100);
    expect(first.items.every((r:any)=>!('classificationHistory' in r)&&!('classificationOriginal' in r)&&!('classificationEffective' in r))).toBe(true); expect(first).toMatchObject({ total: 7, totals: { income: 100000, expense: 262455, net: -162455 }, counts: { unassigned: 1 } });
    const ids: string[] = [];
    for (let page = 1; page <= 4; page++) { const data = await operations(payer, { limit: 2, page }); expect(data.totals).toEqual(first.totals); ids.push(...data.items.map((r: any) => r.operationId)); }
    expect(new Set(ids).size).toBe(7);
    const by = (await http().get('/api/finance/by-articles').set(auth()).query({ from: '2026-11-01', to: '2026-11-19', companyId: String(payer) }).expect(200)).body;
    expect(by.head.totals).toMatchObject({ income: 100000, expense: 262455 }); expect(by.incomeRows.length).toBeGreaterThan(0); expect(by.months).toEqual(['2026-11']);
    expect(by.articleRows.filter((r: any) => r.type === 'income').reduce((sum: number, r: any) => sum + r.total, 0)).toBe(100000);
    expect(by.articleRows.find((r: any) => r.id === String(a.exp)).children[0].children.find((r: any) => r.id === String(a.a)).total).toBe(153000);
    expect((await operations(payer, { articleId: String(a.mid), type: 'expense' })).totals.expense).toBe(262455);
    await http().get('/api/finance/operations').set(auth()).query({ from: '2025-01-01', to: '2026-11-19' }).expect(400);
    await http().get('/api/finance/operations').set(auth()).query({ limit: 101 }).expect(400);
  });

  it('доходные ID/статья snapshot: будущаяподсказка не меняет оплату, старыйarray не стираетID', async () => {
    const payer = await company(), a = await articles(), inc = await income(payer, a.ia, 100);
    await http().post('/api/incomes/' + inc.id + '/payments').set(auth()).send({ date: '2026-11-16', amount: 40, clientUid: 'p1' }).expect(200);
    await db().collection('expensearticles').updateOne({ _id: a.ia }, { $set: { archivedAt: new Date() } });
    await http().patch('/api/incomes/' + inc.id).set(auth()).send({ articleId: String(a.ib) }).expect(200);
    const second = (await http().post('/api/incomes/' + inc.id + '/payments').set(auth()).send({ date: '2026-11-17', amount: 60, clientUid: 'p2' }).expect(200)).body;
    expect(second.payments[0].paymentId).toBeTruthy(); expect(second.payments[1].paymentId).not.toBe(second.payments[0].paymentId);
    const rows = (await operations(payer)).items; expect(rows.find((r: any) => r.amount === 40).articleId).toBe(String(a.ia)); expect(rows.find((r: any) => r.amount === 60).articleId).toBe(String(a.ib));
    await http().patch('/api/incomes/' + inc.id).set(auth()).send({ payments: second.payments.map((p: any) => ({ date: p.date, amount: p.amount })) }).expect(409);
    await http().patch('/api/incomes/' + inc.id).set(auth()).send({ companyId: String(await company()) }).expect(409);
    await http().delete('/api/incomes/' + inc.id + '/payments/0').set(auth()).query({ amount: 40 }).expect(409);
    await http().post('/api/incomes/' + inc.id + '/payments').set(auth()).send({ date: '2026-11-18', amount: 1, articleId: String(a.a) }).expect(400);
  });

  it('ledgerclassify null/reset/retry сохраняетфакт, reset наархивныйoriginal разрешён', async () => {
    const payer = await company(), a = await articles(), inv = await invoice(payer, a.a, a.b);
    const initial = await operations(payer), row = initial.items.find((r: any) => r.amount === 33000), id = row.operationId;
    const body = { articleId: String(a.b), costCenter: 'office', costObject: 'Для отчёта', reason: 'Исправлена статья', clientUid: 'change', version: 0 };
    const changed = (await classify(id, body).expect(200)).body; expect(changed).toMatchObject({ amount: 33000, articleId: String(a.b), costCenter: 'office', classificationVersion: 1 });
    await classify(id, body).expect(200); await classify(id, { ...body, articleId: String(a.a) }).expect(409);
    await classify(id, { ...body, clientUid: 'stale' }).expect(409);
    await classify(id, { ...body, clientUid: 'illegal', version: 1, amount: 1 }).expect(400);
    expect(await db().collection('auditlogs').countDocuments({ action: 'finance.classification.updated', 'details.meta.operationId': id })).toBe(1);
    await db().collection('expensearticles').updateOne({ _id: a.a }, { $set: { archivedAt: new Date() } });
    const cleared = (await classify(id, { articleId: null, reason: 'Без статьи', clientUid: 'clear', version: 1 }).expect(200)).body; expect(cleared.articleId).toBeUndefined();
    const replayAfterChange = (await classify(id, body).expect(200)).body; expect(replayAfterChange).toMatchObject({ classificationVersion: 1, articleId: String(a.b) });
    expect((await http().get('/api/finance/operations/' + encodeURIComponent(id)).set(auth()).expect(200)).body.classificationVersion).toBe(2);
    const restored = (await classify(id, { resetToOriginal: true, reason: 'Вернуть исходное', clientUid: 'reset', version: 2 }).expect(200)).body;
    expect(restored).toMatchObject({ articleId: String(a.a), amount: 33000, date: row.date, companyId: String(payer), classificationVersion: 3 }); expect(restored.warnings.join(' ')).toMatch(/архив/);
    expect((await operations(payer)).totals).toEqual(initial.totals);
    const payment = await db().collection('supplyinvoicepayments').findOne({ _id: new Types.ObjectId(row.paymentId) });
    expect(payment!.allocations.find((x: any) => String(x.requestId) === row.allocationId).articleId.toString()).toBe(String(a.a));
    expect(await db().collection('supplyinvoicepayments').countDocuments({ invoiceId: inv.id })).toBe(2);
  });

  it('классификацияincome/expense не стирается sourcePATCH, company/order факта не меняются', async () => {
    const payer = await company(), a = await articles(), inc = await income(payer, a.ia, 100);
    const paid = (await http().post('/api/incomes/' + inc.id + '/payments').set(auth()).send({ date: '2026-11-16', amount: 100 }).expect(200)).body;
    const row = (await operations(payer)).items[0];
    await classify(row.operationId, { articleId: String(a.ib), reason: 'Доход уточнён', clientUid: 'income-class', version: 0 }).expect(200);
    await http().delete('/api/incomes/' + inc.id + '/payments/0').set(auth()).query({ amount: 100, expectedPaymentId: paid.payments[0].paymentId, version: paid.version + 1 }).expect(409);
    await http().patch('/api/incomes/' + inc.id).set(auth()).send({ payments: [{ paymentId: paid.payments[0].paymentId, date: '2026-11-17', amount: 100 }] }).expect(409);
    await http().patch('/api/incomes/' + inc.id).set(auth()).send({ notes: 'Примечание' }).expect(200);
    expect((await operations(payer)).items[0].articleId).toBe(String(a.ib));
    const e = (await http().post('/api/expenses').set(auth()).send({ date: '2026-11-18', amount: 10, companyId: String(payer), articleId: String(a.a), title: 'Расход' }).expect(201)).body;
    await classify('expense:' + e.id, { articleId: String(a.b), reason: 'Расход уточнён', clientUid: 'expense-class', version: 0 }).expect(200);
    await http().patch('/api/expenses/' + e.id).set(auth()).send({ title: 'Новое описание' }).expect(200);
    await http().delete('/api/expenses/' + e.id).set(auth()).expect(409);
    expect((await operations(payer, { source: 'expense' })).items[0].articleId).toBe(String(a.b));
  });

  it('legacyincome identity-plan readonly, applyатомарен иretry возвращаетmappingбезновыхIDs', async () => {
    const payer = await company(), id = new Types.ObjectId();
    await db().collection('incomes').insertOne({ _id: id, title: 'Старые одинаковые части', amount: 100, amountManual: 100, paidAmount: 100, companyId: payer, paidDate: new Date('2026-11-16'), payments: [{ date: new Date('2026-11-16'), amount: 50 }, { date: new Date('2026-11-16'), amount: 50 }], deletedAt: null });
    const before = await operations(payer); expect(before.items).toHaveLength(2); expect(new Set(before.items.map((r: any) => r.operationId)).size).toBe(2);
    expect(before.items[0]).toMatchObject({ classificationEditable: false, classificationPreparation: { kind: 'income-payment-identities', sourceId: String(id) } });
    await classify(before.items[0].operationId, { articleId: null, reason: 'Не готово', clientUid: 'not-ready', version: 0 }).expect(409);
    const plan = (await http().get('/api/incomes/' + id + '/payments/identity-plan').set(auth()).expect(200)).body; expect(plan).toMatchObject({ changesCount: 2, canApply: true, totals: { amount: 100, count: 2 }, synthetic: false });
    expect((await db().collection('incomes').findOne({ _id: id }))!.version).toBeUndefined();
    const body = { confirm: true, version: plan.version, planHash: plan.planHash, clientUid: 'prepare' };
    const result = (await http().post('/api/incomes/' + id + '/payments/materialize').set(auth()).send(body).expect(200)).body;
    const repeat = (await http().post('/api/incomes/' + id + '/payments/materialize').set(auth()).send(body).expect(200)).body;
    expect(repeat.identityMapping).toEqual(result.identityMapping); expect(Object.keys(result.identityMapping)).toHaveLength(2);
    expect(new Set(result.payments.map((p: any) => p.paymentId)).size).toBe(2);
    await http().get('/api/finance/operations/' + encodeURIComponent(before.items[0].operationId)).set(auth()).expect(404);
    expect((await operations(payer)).totals).toEqual(before.totals);
    expect(await db().collection('auditlogs').countDocuments({ action: 'income.payment-identities.materialized', entityId: id })).toBe(1);
  });

  it('syntheticpaidDate получаетmetadataID безновойчасти; staleplan409, классифицированнуюоплатунестереть', async () => {
    const payer = await company(), a = await articles(), id = new Types.ObjectId();
    await db().collection('incomes').insertOne({ _id: id, title: 'Старая полная', amount: 100, amountManual: 100, paidAmount: 100, companyId: payer, paidDate: new Date('2026-11-16'), deletedAt: null });
    const plan = (await http().get('/api/incomes/' + id + '/payments/identity-plan').set(auth()).expect(200)).body; expect(plan.synthetic).toBe(true);
    await http().post('/api/incomes/' + id + '/payments/materialize').set(auth()).send({ confirm: true, version: 1, planHash: plan.planHash, clientUid: 'stale-plan' }).expect(409);
    const ready = (await http().post('/api/incomes/' + id + '/payments/materialize').set(auth()).send({ confirm: true, version: 0, planHash: plan.planHash, clientUid: 'synthetic' }).expect(200)).body;
    expect(ready.legacyPaymentMetadata.paymentId).toBeTruthy(); expect(ready.payments).toHaveLength(1); expect(((await db().collection('incomes').findOne({ _id: id }))!.payments || [])).toHaveLength(0);
    const row = (await operations(payer)).items[0]; expect(row.operationId).toBe('income:' + id + ':' + ready.legacyPaymentMetadata.paymentId);
    await classify(row.operationId, { articleId: String(a.ia), reason: 'Классификация старого дохода', clientUid: 'synthetic-class', version: 0 }).expect(200);
    await http().patch('/api/incomes/' + id).set(auth()).send({ paidDate: '' }).expect(409);
    expect((await operations(payer)).total).toBe(1);
  });

  it('scopeпоисходнойзаявке не расширяется аналитикой, весьmixedinvoiceнедоступендляwrite', async () => {
    const payer = await company(), a = await articles(), inv = await invoice(payer, a.a, a.b), visible = new Types.ObjectId(), hidden = new Types.ObjectId();
    await db().collection('supplyrequests').updateOne({ _id: inv.rows[0] }, { $set: { categoryId: visible } }); await db().collection('supplyrequests').updateOne({ _id: inv.rows[1] }, { $set: { categoryId: hidden } });
    const scope = { categoryIds: [String(visible)], noCategory: false, zones: [{ id: 'scope', categoryIds: new Set([String(visible)]), includeIds: new Set<string>(), excludeIds: new Set<string>(), noCategory: false }] };
    const reader = ctx.module.get(FinancialOperationsReader), actor = { id: token.user.id, username: 'admin-test', role: 'admin' };
    const data = await reader.list({ from: '2026-11-01', to: '2026-11-19', companyId: String(payer) }, actor, scope);
    expect(data).toMatchObject({ total: 2, totals: { expense: 153000 } });
    expect(data.items.every((r: any) => r.scopeRequestId === String(inv.rows[0]))).toBe(true);
    const service = ctx.app.get(FinanceService);
    const calendar = await service.cashflow({ from: '2026-11-01', to: '2026-11-19', org: String(payer) }, scope, actor);
    const paid = calendar.days.flatMap((day) => day.ops);
    expect(paid.map((op) => op.scopeRequestId)).toEqual([String(inv.rows[0]), String(inv.rows[0])]);
    expect(calendar.totals.expense).toBe(data.totals.expense);
  });

  it('историческийlegacyclassoverride переноситсявledger вместеoriginOperationId', async () => {
    const payer = await company(), a = await articles(), id = new Types.ObjectId(), rid = new Types.ObjectId();
    await db().collection('supplyinvoices').insertOne({ _id: id, no: 'C159legacy', status: 'paid', amount: 100, date: new Date('2026-11-15'), payerCompanyId: payer, version: 0, deletedAt: null, paymentSnapshot: { amount: 100, paidAt: new Date('2026-11-16'), lines: [{ requestId: rid, lineAmount: 100, companyId: payer }] } });
    await db().collection('supplyrequests').insertOne({ _id: rid, invoiceId: id, qty: 1, title: 'Старая строка', priceHint: 100, paid: true, paidAt: new Date('2026-11-16'), companyId: payer, articleId: a.a, status: 'ordered', deletedAt: null });
    const op = 'supply-legacy:' + id + ':' + rid;
    expect((await operations(payer)).items[0].warnings.join(' ')).toMatch(/текущей/);
    await classify(op, { articleId: String(a.b), reason: 'По первичке уточнено', clientUid: 'legacy-class', version: 0 }).expect(200);
    await http().post('/api/supply/invoices/' + id + '/unpay').set(auth()).send({ confirm: true, reason: 'Ошибка старой оплаты' }).expect(200);
    const migrated = await db().collection('supplyinvoicepayments').findOne({ invoiceId: id });
    expect(migrated!.allocations[0]).toMatchObject({ originOperationId: op, classificationVersion: 1, classificationOriginal: { articleId: String(a.a) }, classificationOverride: { articleId: String(a.b) } });
    expect((await operations(payer)).total).toBe(0);
  });

  it('months переходятчерезгод, прямыессылкинагруппу/unknown не теряют денежныйвклад', async () => {
    const payer = await company(), a = await articles();
    await db().collection('expenses').insertMany([{ date: new Date('2025-12-15'), amount: 10, articleId: a.mid }, { date: new Date('2026-01-15'), amount: 20, articleId: new Types.ObjectId() }].map(x => ({ ...x, companyId: payer, title: 'Старый расход', deletedAt: null })));
    const r = (await http().get('/api/finance/by-articles').set(auth()).query({ from: '2025-12-01', to: '2026-01-31', companyId: String(payer) }).expect(200)).body;
    expect(r.months).toEqual(['2025-12', '2026-01']); expect(r.head.totals.expense).toBe(30);
    expect(r.articleRows.reduce((sum: number, row: any) => sum + row.total, 0)).toBe(30);
    expect(r.articleRows.find((row: any) => row.id === String(a.exp)).children[0].children[0]).toMatchObject({ id: String(a.mid) + ':self', total: 10, virtual: true });
  });
  it('новая оплата не наследует архивную статью; старые allocations сохраняют original', async () => {
    const payer = await company(), a = await articles(), id = new Types.ObjectId(), rid = new Types.ObjectId();
    await db().collection('supplyinvoices').insertOne({ _id:id, amount:100, status:'issued', payerCompanyId:payer, version:0, deletedAt:null });
    await db().collection('supplyrequests').insertOne({ _id:rid, invoiceId:id, title:'Историческая статья', qty:1, priceHint:100, articleId:a.a, companyId:payer, status:'ordered', deletedAt:null });
    await http().post('/api/supply/invoices/'+id+'/payments').set(auth()).send({date:'2026-11-16',amount:40,clientUid:'before-archive'}).expect(200);
    await db().collection('expensearticles').updateOne({_id:a.a},{$set:{archivedAt:new Date()}});
    const result=(await http().post('/api/supply/invoices/'+id+'/payments').set(auth()).send({date:'2026-11-17',amount:60,clientUid:'after-archive'}).expect(200)).body;
    expect(result.warnings.join(' ')).toContain('Статья источника недоступна');
    const facts=await db().collection('supplyinvoicepayments').find({invoiceId:id}).sort({date:1}).toArray();
    expect(facts[0].allocations[0].classificationOriginal.articleId).toBe(String(a.a));
    expect(facts[1].allocations[0].classificationOriginal.articleId).toBeNull();
    const rows=(await operations(payer)).items;expect(rows.find((r:any)=>r.amount===60).warnings.join(' ')).toContain('Статья источника недоступна');
    const inc=await income(payer,a.ia,100);
    await db().collection('expensearticles').updateOne({_id:a.ia},{$set:{archivedAt:new Date()}});
    await http().post('/api/incomes/'+inc.id+'/payments').set(auth()).send({date:'2026-11-17',amount:40,articleId:String(a.ia)}).expect(400);
    await http().post('/api/incomes/'+inc.id+'/payments').set(auth()).send({date:'2026-11-17',amount:40,clientUid:'default-stale'}).expect(200);
    const saved=await db().collection('incomes').findOne({_id:new Types.ObjectId(inc.id)});expect(saved!.payments[0].classificationOriginal.articleId).toBeNull();
  });

  it.each(['cancel','remove'])('source CAS: %s после первого чтения не прячет конкурентную оплату',async(action)=>{
    const payer=await company(), a=await articles(), inc=await income(payer,a.ia,100), service=ctx.app.get(IncomesService);
    let release!:()=>void, entered!:()=>void;const gate=new Promise<void>(r=>release=r), barrier=new Promise<void>(r=>entered=r);
    const method=action==='cancel'?'assertCanChange':'assertOrderOpen';
    const original=(service as any)[method].bind(service);let blocked=false;
    const spy=jest.spyOn(service as any,method).mockImplementation(async(...args:any[])=>{await original(...args);if(!blocked){blocked=true;entered();await gate;}});
    const pending=(action==='cancel'?http().post('/api/incomes/'+inc.id+'/cancel').set(auth()).send({reason:'Отмена после чтения'}):http().delete('/api/incomes/'+inc.id).set(auth())).then(r=>r);
    await barrier;
    try { await http().post('/api/incomes/'+inc.id+'/payments').set(auth()).send({date:'2026-11-17',amount:40,clientUid:'race-'+action}).expect(200); } finally { release(); }
    const result=await pending;spy.mockRestore();expect(result.status).toBe(409);
    const raw=await db().collection('incomes').findOne({_id:new Types.ObjectId(inc.id)});expect(raw!.payments).toHaveLength(1);expect(raw!.deletedAt).toBeNull();expect(raw!.cancelledAt).toBeFalsy();expect((await operations(payer)).total).toBe(1);
  });

  it('payroll section закрыт при canPayroll=true: canonical list/detail/write не раскрывают факт',async()=>{
    const payer=await company(), id=new Types.ObjectId();await db().collection('payroll_payments').insertOne({_id:id,companyId:payer,date:new Date('2026-11-17'),amount:12345,employeeName:'Закрытое имя',deletedAt:null});
    const actor={id:new Types.ObjectId().toHexString(),username:'money-only',role:'accountant'} as any;
    setRoleSections('accountant',['money']);expect(canSeePayroll(actor)).toBe(true);
    try {const reader=ctx.app.get(FinancialOperationsReader);const result=await reader.list({from:'2026-11-01',to:'2026-11-19',companyId:String(payer)},actor);expect(result.items).toHaveLength(0);expect(result.excludedSources.map(s=>s.source)).toContain('payroll');await expect(reader.detail('payroll:'+id,actor)).rejects.toMatchObject({status:403});const writer=ctx.app.get(FinancialClassificationService);await expect(writer.apply('payroll:'+id,{version:0,reason:'Недоступный источник',clientUid:'payroll-closed',articleId:null},actor,null)).rejects.toMatchObject({status:403});}finally{deleteRoleSections('accountant');}
  });

  it('object by-articles сохраняет contractPrice, scope и процент одновременно с BOTH',async()=>{
    const payer=await company(),a=await articles(),order=new Types.ObjectId();await db().collection('salesorders').insertOne({_id:order,orderNo:'C159-OBJECT',title:'Объект',deletedAt:null});
    await http().post('/api/incomes').set(auth()).send({title:'Цена контракта',companyId:String(payer),orderId:String(order),amountManual:1000}).expect(201);
    await http().post('/api/expenses').set(auth()).send({date:'2026-11-17',amount:250,companyId:String(payer),articleId:String(a.a),title:'Часть цены',salesOrderId:String(order),costCenter:'order'}).expect(201);
    const result=(await http().get('/api/finance/by-articles').set(auth()).query({from:'2026-11-01',to:'2026-11-19',companyId:String(payer),mode:'object',salesOrderId:String(order)}).expect(200)).body;
    expect(result.scope).toMatchObject({mode:'object',salesOrderId:String(order),contractPrice:1000});expect(result.head.totals.expense).toBe(250);expect(result.rows.find((r:any)=>r.id===String(a.exp)).pct).toBe(25);expect(result.articleRows.find((r:any)=>r.id===String(a.exp)).total).toBe(250);
  });

  it('C219: производство, договор и позиция фильтруют доступные связанные факты и сводку одинаково', async () => {
    const payer = await company(), a = await articles();
    const orderA = new Types.ObjectId(), orderB = new Types.ObjectId(), lineA = new Types.ObjectId(), lineB = new Types.ObjectId();
    const paidDate = new Date('2026-11-16'), productionNo = 'C219-Единый';
    await db().collection('salesorders').insertMany([
      { _id: orderA, orderNo: 'C219-A', productionNo, deletedAt: null },
      { _id: orderB, orderNo: 'C219-B', productionNo, deletedAt: null },
    ]);
    await db().collection('incomes').insertMany([
      { _id: lineA, lineNo: 1, title: 'Стелла', amount: 100, orderId: orderA, orderNo: 'C219-A', customer: 'Город', companyId: payer, paidDate },
      { _id: lineB, lineNo: 2, title: 'Стойка', amount: 200, orderId: orderB, orderNo: 'C219-B', customer: 'Город', companyId: payer, paidDate },
    ]);
    await db().collection('supplyrequests').insertOne({ title: 'Металл', priceHint: 50, paid: true, paidAt: paidDate, companyId: payer, salesOrderId: orderA, salesOrderLineId: lineA, articleId: a.a });
    await db().collection('expenses').insertOne({ title: 'Доставка договора', amount: 80, date: paidDate, companyId: payer, salesOrderId: orderB, articleId: a.b });

    expect((await operations(payer, { productionNo })).totals).toMatchObject({ income: 300, expense: 130 });
    expect((await operations(payer, { salesOrderId: String(orderB) })).totals).toMatchObject({ income: 200, expense: 80 });
    const selection = { from: '2026-11-01', to: '2026-11-19', companyId: String(payer), productionNo, salesOrderLineId: String(lineA), facets: 1 };
    const facts = await operations(payer, selection);
    expect(facts.totals).toMatchObject({ income: 100, expense: 50 });
    expect(facts.items.every((op: { salesOrderLineId: string }) => op.salesOrderLineId === String(lineA))).toBe(true);
    expect(facts.facets.orderLines.map((row: { id: string }) => row.id).sort()).toEqual([String(lineA), String(lineB)].sort());
    const report = (await http().get('/api/finance/by-articles').set(auth()).query(selection).expect(200)).body;
    expect(report.head.totals).toMatchObject({ income: 100, expense: 50 });
    expect(report.facets).toEqual(facts.facets);
    expect((await operations(payer, { counterparty: 'Город', doc: 'заказ C219-B' })).totals).toMatchObject({ income: 200, expense: 0 });
    expect((await operations(payer, { counterparty: 'Контрагент не указан', doc: 'Без заказа' })).totals).toMatchObject({ income: 0, expense: 130 });
    await http().get('/api/finance/operations').set(auth()).query({ salesOrderLineId: 'не позиция' }).expect(400);
    await http().get('/api/finance/by-articles').set(auth()).query({ personId: 'не сотрудник' }).expect(400);
  });

  it('C219: оплата снабжения сохраняет позицию и убирает её из факта при переносе аналитики в другой заказ', async () => {
    const payer = await company(), a = await articles();
    const order = new Types.ObjectId(), another = new Types.ObjectId(), line = new Types.ObjectId(), moved = new Types.ObjectId();
    await db().collection('salesorders').insertMany([
      { _id: order, orderNo: 'C219-Оплата', deletedAt: null }, { _id: another, orderNo: 'C219-Перенос', deletedAt: null },
    ]);
    await db().collection('incomes').insertMany([
      { _id: line, orderId: order, title: 'Оплаченная позиция' }, { _id: moved, orderId: order, title: 'Новая позиция заявки' },
    ]);
    const invoiceId = new Types.ObjectId(), requestId = new Types.ObjectId(), date = new Date('2026-11-16');
    await db().collection('supplyinvoices').insertOne({ _id: invoiceId, no: 'C219-01', date, amount: 99, status: 'issued', payerCompanyId: payer, version: 0 });
    await db().collection('supplyrequests').insertOne({ _id: requestId, invoiceId, salesOrderId: order, salesOrderLineId: line, title: 'Крепление', qty: 1, unit: 'шт', priceHint: 99, companyId: payer, invoiceDate: date, articleId: a.a, status: 'ordered' });
    await http().post('/api/supply/invoices/' + invoiceId + '/payments').set(auth()).send({ clientUid: 'c219-pay', amount: 99, date: '2026-11-16' }).expect(200);
    const write = await db().collection('supplyinvoicepayments').findOne({ invoiceId });
    expect(String(write!.allocations[0].salesOrderLineId)).toBe(String(line));
    await db().collection('supplyrequests').updateOne({ _id: requestId }, { $set: { salesOrderLineId: moved } });
    const target = (await operations(payer, { salesOrderLineId: String(line) })).items[0];
    expect(target).toMatchObject({ amount: 99, salesOrderLineId: String(line) });
    await classify(target.operationId, { salesOrderId: String(another), version: 0, clientUid: 'c219-reclassify', reason: 'Перенесли затраты на другой договор' }).expect(200);
    expect((await operations(payer, { salesOrderLineId: String(line) })).total).toBe(0);
    expect((await operations(payer, { salesOrderId: String(another) })).totals.expense).toBe(99);
  });

  it('bounded pipeline: чужая компания/дата и тяжёлая история не попадают в список',async()=>{
    const payer=await company(), other=await company(),a=await articles();
    const history=Array.from({length:40},(_,i)=>({version:i,reason:'История '+i,after:{articleId:String(a.a)}}));
    await db().collection('expenses').insertMany(Array.from({length:900},(_,i)=>({companyId:i<600?payer:other,date:new Date(i<600?'2025-01-01':'2026-11-17'),amount:999,articleId:a.a,title:'Вне выборки',classificationHistory:history,deletedAt:null})));
    await db().collection('expenses').insertMany(Array.from({length:120},(_,i)=>({companyId:payer,date:new Date('2026-11-17'),amount:i+1,articleId:a.a,title:'В периоде',classificationOriginal:{articleId:String(a.a)},classificationHistory:history,deletedAt:null})));
    const started=performance.now(), result=await operations(payer,{source:'expense',limit:2});const duration=Math.round((performance.now()-started)*100)/100;
    console.log('C159 bounded history: outside=900 selected=120 page=2 ms='+duration);
    expect(result.total).toBe(120);expect(result.totals.expense).toBe(7260);expect(result.items).toHaveLength(2);expect(JSON.stringify(result.items)).not.toContain('classificationHistory');
    const detail=(await http().get('/api/finance/operations/'+encodeURIComponent(result.items[0].operationId)).set(auth()).expect(200)).body;expect(detail.classificationHistory).toHaveLength(40);
  });

  it('старые paid источники не меняют аналитику обычным PATCH без original',async()=>{
    const payer=await company(), a=await articles(), rid=new Types.ObjectId(), exp=new Types.ObjectId();
    await db().collection('supplyrequests').insertOne({_id:rid,title:'Оплачено',qty:1,unit:'шт',priceHint:50,paid:true,paidAt:new Date('2026-11-17'),articleId:a.a,companyId:payer,status:'ordered',deletedAt:null});
    await http().patch('/api/supply/requests/'+rid).set(auth()).send({articleId:String(a.b)}).expect(409);
    await db().collection('expenses').insertOne({_id:exp,date:new Date('2026-11-17'),amount:50,articleId:a.a,companyId:payer,title:'Исторический расход',deletedAt:null});
    await http().patch('/api/expenses/'+exp).set(auth()).send({articleId:String(a.b)}).expect(409);
    await http().patch('/api/expenses/'+exp).set(auth()).send({title:'Уточнённое название',articleId:String(a.a)}).expect(200);
  });

  it('cascade rollback: income/reservation/storage/workTask атомарны; retry снимает бронь один раз',async()=>{
    const payer=await company(),a=await articles(),inc=await income(payer,a.ia,100),rid=new Types.ObjectId(),wid=new Types.ObjectId(),mid=new Types.ObjectId(),sid=new Types.ObjectId(),task=new Types.ObjectId();
    await db().collection('storageitems').insertOne({_id:sid,warehouseId:wid,materialId:mid,quantity:10,reservedQty:4,deletedAt:null});
    await db().collection('reservations').insertOne({_id:rid,orderId:'C159-rollback',salesOrderLineId:new Types.ObjectId(inc.id),warehouseId:wid,materialId:mid,qty:4,isActive:true,status:'active',deletedAt:null});
    await db().collection('worktasks').insertOne({_id:task,incomeId:new Types.ObjectId(inc.id),openIncomeId:new Types.ObjectId(inc.id),status:'waiting',deletedAt:null});
    const svc=ctx.app.get(IncomeCancelService),internal=svc as any,release=internal.releaseDeps.bind(svc);let injected=false;
    const spy=jest.spyOn(internal,'releaseDeps').mockImplementation(async(...args:any[])=>{await release(...args);const session=args[2];expect((await db().collection('storageitems').findOne({_id:sid},{session}))!.reservedQty).toBe(0);expect((await db().collection('worktasks').findOne({_id:task},{session}))!.status).toBe('cancelled');if(!injected){injected=true;throw new Error('C159 forced precommit rollback');}});
    const actor={id:token.user.id,role:'admin',username:'admin-test'};
    try {await expect(svc.cancel(inc.id,'Тест отката каскада',true,actor)).rejects.toThrow('C159 forced precommit rollback');}finally{spy.mockRestore();}
    expect((await db().collection('incomes').findOne({_id:new Types.ObjectId(inc.id)}))!.cancelledAt).toBeFalsy();
    expect((await db().collection('reservations').findOne({_id:rid}))!.status).toBe('active');expect((await db().collection('storageitems').findOne({_id:sid}))!.reservedQty).toBe(4);expect((await db().collection('worktasks').findOne({_id:task}))!.status).toBe('waiting');
    await svc.cancel(inc.id,'Тест отката каскада',true,actor);
    expect((await db().collection('reservations').findOne({_id:rid}))!.status).toBe('released');expect((await db().collection('storageitems').findOne({_id:sid}))!.reservedQty).toBe(0);expect((await db().collection('worktasks').findOne({_id:task}))!.status).toBe('cancelled');
    await expect(svc.cancel(inc.id,'Повтор уже отменённой позиции',true,actor)).rejects.toMatchObject({status:409});expect((await db().collection('storageitems').findOne({_id:sid}))!.reservedQty).toBe(0);
  });

  it('legacy header/snapshot paid при row.paid=false защищает исходную аналитику',async()=>{
    const payer=await company(),a=await articles(),id=new Types.ObjectId(),rid=new Types.ObjectId(),date=new Date('2026-11-16');
    const snapshot={amount:100,paidAt:date,lines:[{requestId:rid,lineAmount:100,companyId:payer,articleId:a.a,title:'Старая строка'}]};
    await db().collection('supplyinvoices').insertOne({_id:id,no:'C159-paid-header',status:'paid',amount:100,payerCompanyId:payer,paymentSnapshot:snapshot,deletedAt:null,version:0});
    await db().collection('supplyrequests').insertOne({_id:rid,invoiceId:id,title:'Зеркало false',qty:1,unit:'шт',priceHint:100,articleId:a.a,paid:false,companyId:payer,status:'ordered',deletedAt:null});
    const before=await operations(payer);
    await http().patch('/api/supply/requests/'+rid).set(auth()).send({articleId:String(a.b)}).expect(409);
    const after=await operations(payer);expect(after.totals).toEqual(before.totals);expect(after.items.map((r:any)=>({id:r.operationId,date:r.date,articleId:r.articleId}))).toEqual(before.items.map((r:any)=>({id:r.operationId,date:r.date,articleId:r.articleId})));
    expect(String((await db().collection('supplyrequests').findOne({_id:rid}))!.articleId)).toBe(String(a.a));expect((await db().collection('supplyinvoices').findOne({_id:id}))!.paymentSnapshot).toEqual(snapshot);
    await http().patch('/api/supply/requests/'+rid).set(auth()).send({articleId:String(a.a),title:'Неизменённая статья'}).expect(200);
  });

});
