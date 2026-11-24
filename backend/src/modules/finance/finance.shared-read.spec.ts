import { Types } from 'mongoose';
import { FinanceService } from './finance.service';
import { visibleFinanceRequests } from './finance-visibility';
import { FinancialClassificationService } from './financial-classification.service';

const oid = () => new Types.ObjectId();

function cursor(rows: unknown[] = []) {
  const c = {
    sort() { return c; },
    limit() { return c; },
    toArray: async () => rows,
  };
  return c;
}

type Call = { name: string; op: string; filter?: unknown; options?: unknown };

describe('finance — чтение shared через слой', () => {
  it('снимок оплаты читает и снятую заявку', async () => {
    const companyId = oid();
    const requestId = oid();
    const invoiceId = oid();
    const calls: Call[] = [];
    const paidAt = new Date('2026-11-10T00:00:00Z');
    const db = {
      collection: (name: string) => ({
        findOne: async () => null,
        find: (filter?: unknown, options?: unknown) => {
          calls.push({ name, op: 'find', filter, options });
          const f = (filter ?? {}) as { deletedAt?: unknown; _id?: unknown };
          if (name === 'organizations') return cursor([{ _id: companyId, name: 'Наша', shortName: 'Наша' }]);
          if (name === 'supplyinvoices') return cursor([{
            _id: invoiceId, no: '1', payerCompanyId: companyId,
            paymentSnapshot: { paidAt, lines: [{ requestId, lineAmount: 10, companyId, title: 'Лист' }] },
          }]);
          if (name === 'supplyrequests' && f.deletedAt === undefined && f._id) {
            return cursor([{ _id: requestId, articleId: 'art-1', deletedAt: new Date(), status: 'received' }]);
          }
          return cursor([]);
        },
        aggregate: () => ({ toArray: async () => [] }),
        countDocuments: async () => 0,
        distinct: async () => [],
      }),
    };
    const svc = new FinanceService({ db } as never, { paidOps: async () => [] } as never, { tree: async () => [] } as never, {} as never);
    const ops = await svc.operationsSource('2026-11-01', '2026-11-30', [companyId]);
    const snap = calls.find((c) => c.name === 'supplyrequests' && (c.filter as { deletedAt?: unknown }).deletedAt === undefined);
    expect(snap?.options).toEqual({ projection: {
      articleId: 1, categoryId: 1, salesOrderId: 1, salesOrderLineId: 1, costCenter: 1, costObject: 1, supplierId: 1, deletedAt: 1, status: 1,
    } });
    expect(ops.some((op) => op.articleId === 'art-1')).toBe(true);
    const live = calls.filter((c) => c.name === 'supplyrequests' && (c.filter as { deletedAt?: unknown }).deletedAt === null);
    expect(live.length).toBeGreaterThan(0);
  });

  it('список «заполнить» оставляет живой фильтр заявок', async () => {
    const calls: Call[] = [];
    const db = {
      collection: (name: string) => ({
        findOne: async () => null,
        find: (filter?: unknown, options?: unknown) => {
          calls.push({ name, op: 'find', filter, options });
          return cursor([]);
        },
        countDocuments: async () => 0,
        distinct: async () => [],
      }),
    };
    const svc = new FinanceService({ db } as never, { unassignedPayments: async () => 0 } as never, { tree: async () => [] } as never, {} as never);
    await svc.needsFill(5, null, { role: 'admin', isOwner: true } as never);
    const reqs = calls.filter((c) => c.name === 'supplyrequests');
    expect(reqs).toHaveLength(2);
    for (const c of reqs) expect(c.filter).toMatchObject({ deletedAt: null });
    expect(reqs[0].options).toEqual({ projection: { num: 1, title: 1, priceHint: 1, invoiceDate: 1, invoiceNo: 1, companyId: 1 } });
  });
});

describe('видимость заявок в деньгах', () => {
  it('фильтр живой, проекция только _id', async () => {
    const id = oid();
    const calls: Call[] = [];
    const connection = {
      db: {
        collection: (name: string) => ({
          find: (filter?: unknown, options?: unknown) => {
            calls.push({ name, op: 'find', filter, options });
            return cursor(name === 'supplyrequests' ? [{ _id: id }] : []);
          },
        }),
      },
    };
    const seen = await visibleFinanceRequests(connection as never, { zones: [], categoryIds: [], noCategory: false }, [String(id)]);
    expect(seen?.has(String(id))).toBe(true);
    const req = calls.find((c) => c.name === 'supplyrequests');
    expect(req?.filter).toMatchObject({ deletedAt: null });
    expect(req?.options).toEqual({ projection: { _id: 1 } });
  });
});

describe('классификация — заявка через слой', () => {
  const articles = { docs: async () => [], assertSelectable: async () => undefined };

  it('заявка без счёта идёт через find слоя, расход остаётся findOne', async () => {
    const id = oid();
    const calls: Call[] = [];
    const col = (name: string) => ({
      findOne: async (filter?: unknown, options?: unknown) => {
        calls.push({ name, op: 'findOne', filter, options });
        if (name === 'expenses') return { _id: id, date: '2026-11-02', companyId: id, amount: 5 };
        return null;
      },
      find: (filter?: unknown, options?: unknown) => {
        calls.push({ name, op: 'find', filter, options });
        return cursor(name === 'supplyrequests' ? [{ _id: id, paid: true, status: 'received', priceHint: 12, companyId: id, paidAt: '2026-11-02' }] : []);
      },
    });
    const svc = new FinancialClassificationService({ db: { collection: col } } as never, articles as never);
    const request = await svc.locate('supply-request:' + id);
    expect(request).toMatchObject({ source: 'request', amount: 12 });
    const read = calls.find((c) => c.name === 'supplyrequests');
    expect(read).toMatchObject({ op: 'find', options: {} });
    expect(read?.filter).toMatchObject({ _id: id, deletedAt: null });
    calls.length = 0;
    const expense = await svc.locate('expense:' + id);
    expect(expense.source).toBe('expense');
    expect(calls[0]).toMatchObject({ name: 'expenses', op: 'findOne' });
  });

  it('доступ к складу считает живые заявки', async () => {
    const requestId = oid();
    const invoiceId = oid();
    const calls: Call[] = [];
    const col = (name: string) => ({
      find: (filter?: unknown, options?: unknown) => {
        calls.push({ name, op: 'find', filter, options });
        return cursor(name === 'supplyrequests' ? [{ _id: requestId }] : []);
      },
      countDocuments: async (filter?: unknown) => {
        calls.push({ name, op: 'count', filter });
        return 1;
      },
    });
    const svc = new FinancialClassificationService({ db: { collection: col } } as never, articles as never);
    await svc.assertAccess({
      source: 'invoice', requestId, invoiceId, collection: 'supplyinvoices', document: {}, metadata: {},
      path: null, operationId: 'x', sourceId: 's', date: '2026-11-01', companyId: 'c', editable: true, amount: 1,
    } as never, { role: 'admin', isOwner: true } as never, { zones: [], categoryIds: [], noCategory: false } as never, true);
    const reqs = calls.filter((c) => c.name === 'supplyrequests');
    expect(reqs.map((c) => c.op)).toEqual(['find', 'count', 'count']);
    expect(reqs[0].filter).toMatchObject({ _id: requestId, deletedAt: null });
    expect(reqs[1].filter).toEqual({ invoiceId, deletedAt: null });
    expect(reqs[2].filter).toMatchObject({ invoiceId, deletedAt: null });
  });
});
