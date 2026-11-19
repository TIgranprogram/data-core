import request from 'supertest';
import { Types } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { SupplyInvoice } from '../../src/modules/supply/supply-invoice.schema';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

describe('C158 QA: атомарность, копейки и безопасное сторно', () => {
  let ctx: TestContext, token: AuthTokens, payer: Types.ObjectId;
  const db = () => ctx.connection.db!, http = () => request(ctx.app.getHttpServer()), auth = () => authHeader(token.access);
  const get = async (id: string) => (await http().get('/api/supply/invoices/' + id).set(auth()).expect(200)).body;
  const pay = (id: string, body: object) => http().post('/api/supply/invoices/' + id + '/payments').set(auth()).send(body);
  async function fixture(amount: number, count = 1) {
    const invoice = new Types.ObjectId(), ids = Array.from({ length: count }, () => new Types.ObjectId());
    const group = new Types.ObjectId(), articleIds = ids.map(() => new Types.ObjectId());
    await db().collection('expensearticles').insertMany([
      { _id: group, name: 'QA C158 статьи ' + group, type: 'expense', nodeKind: 'group', selectable: false, parentId: null, version: 0, deletedAt: null },
      ...articleIds.map((_id, i) => ({ _id, name: 'QA Статья ' + i, type: 'expense', nodeKind: 'article', selectable: true, parentId: group, version: 0, deletedAt: null })),
    ]);
    await db().collection('supplyinvoices').insertOne({ _id: invoice, no: 'QA-C158-' + invoice, date: new Date('2026-09-01'), status: 'issued', amount, payerCompanyId: payer, version: 0, deletedAt: null });
    await db().collection('supplyrequests').insertMany(ids.map((_id, i) => ({ _id, invoiceId: invoice, title: 'QA строка ' + i, qty: 1, unit: 'шт', priceHint: amount / count, companyId: payer, articleId: articleIds[i], status: 'ordered', deletedAt: null, paid: false })));
    return { id: String(invoice), ids };
  }
  beforeAll(async () => {
    ctx = await createTestApp({ strictValidation: true }); token = await loginAsAdmin(ctx.app); payer = new Types.ObjectId();
    await db().collection('organizations').insertOne({ _id: payer, inn: '9900009158', name: 'QA C158 компания', isOurCompany: true, deletedAt: null });
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('конфликт CAS после записи факта откатывает всю транзакцию; тот же ключ затем можно выполнить', async () => {
    const x = await fixture(100), body = { clientUid: 'qa-rollback', date: '2026-09-17', amount: 100 };
    // Управляемая потеря CAS в последней фазе: уже вставленный факт обязан откатиться Mongo-транзакцией.
    const model = ctx.module.get(getModelToken(SupplyInvoice.name));
    const failedCas = jest.spyOn(model, 'updateOne').mockReturnValueOnce({ exec: async () => ({ matchedCount: 0 }) } as never);
    try { await pay(x.id, body).expect(409); } finally { failedCas.mockRestore(); }
    expect(await db().collection('supplyinvoicepayments').countDocuments({ invoiceId: new Types.ObjectId(x.id) })).toBe(0);
    const inv = await db().collection('supplyinvoices').findOne({ _id: new Types.ObjectId(x.id) });
    expect(inv).toMatchObject({ status: 'issued', version: 0 }); expect(inv?.paymentAccountingVersion).toBeUndefined();
    expect(await db().collection('supplyrequests').findOne({ _id: x.ids[0] })).toMatchObject({ paid: false });
    await pay(x.id, body).expect(200);
    expect(await db().collection('supplyinvoicepayments').countDocuments({ invoiceId: new Types.ObjectId(x.id) })).toBe(1);
  });

  it('две оплаты трёх статей сохраняют копейки и дату факта отдельно от момента ввода', async () => {
    const x = await fixture(.03, 3), before = Date.now();
    await pay(x.id, { clientUid: 'qa-two-cents', date: '2026-09-17', amount: .02 }).expect(200);
    const final = (await pay(x.id, { clientUid: 'qa-last-cent', date: '2026-09-18', amount: .01 }).expect(200)).body;
    expect(final).toMatchObject({ paidAmount: .03, sourcePaidAmount: .03, balanceDue: 0, paymentState: 'paid' });
    for (const p of final.payments) {
      expect(p.allocations.reduce((sum: number, a: { amountRub: number }) => sum + Math.round(a.amountRub * 100), 0)).toBe(Math.round(p.amount * 100));
      expect(new Set(p.allocations.map((a: { articleId: string }) => a.articleId)).size).toBe(3);
      expect(new Date(p.createdAt).getTime()).toBeGreaterThanOrEqual(before);
      expect(p.date).toMatch(/^2026-09-1[78]$/); expect(p.createdAt.slice(0, 10)).not.toBe(p.date);
    }
    const facts = (await (ctx.module.get(FinanceService) as unknown as { ops(from: string, to: string, ids: Types.ObjectId[]): Promise<{ ops: { doc: string; amount: number }[] }> }).ops('2026-09-01', '2026-09-30', [payer])).ops.filter(o => o.doc === 'QA-C158-' + x.id);
    expect(facts.reduce((sum, o) => sum + Math.round(o.amount * 100), 0)).toBe(3);
  });

  it('dry-run сторно не меняет факт; подтверждение и потерянный ответ создают ровно одну отмену', async () => {
    const x = await fixture(100), first = (await pay(x.id, { clientUid: 'qa-void-fact', date: '2026-09-17', amount: 100 }).expect(200)).body;
    const paymentId = first.payments[0].id, url = '/api/supply/invoices/' + x.id + '/payments/' + paymentId + '/void';
    const before = await get(x.id), preview = (await http().post(url).set(auth()).send({}).expect(200)).body;
    expect(preview).toMatchObject({ dryRun: true, canProceed: true });
    expect((await get(x.id)).version).toBe(before.version); expect((await get(x.id)).paidAmount).toBe(100);
    const body = { confirm: true, reason: 'ошибочная регистрация QA', clientUid: 'qa-void-once', version: before.version };
    await http().post(url).set(auth()).send(body).expect(200);
    await http().post(url).set(auth()).send(body).expect(200);
    await http().post(url).set(auth()).send({ ...body, reason: 'иная причина с тем же ключом' }).expect(409);
    const after = await get(x.id);
    expect(after).toMatchObject({ paidAmount: 0, paymentState: 'unpaid', paymentAccountingVersion: 1 });
    expect(after.payments).toHaveLength(1); expect(after.payments[0]).toMatchObject({ id: paymentId, state: 'voided', date: '2026-09-17', amount: 100 });
    expect(after.paymentAdjustments.filter((a: { operation: string }) => a.operation === 'payment_reversed')).toHaveLength(1);
  });
});
