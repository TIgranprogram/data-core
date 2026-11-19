import type { Connection } from 'mongoose';
import type { FinancialRecord } from './invoice-financials';
/** Только агрегаты: история/allocations остаются на сервере Mongo, наружу идут итог и счётчик. */
export async function invoicePaymentSummaries(connection: Connection, ids: unknown[], visibleRequestIds?: unknown[]): Promise<Map<string, FinancialRecord>> {
  if (!ids.length) return new Map();
  const stages: FinancialRecord[] = [{ $match: { invoiceId: { $in: ids }, deletedAt: null } }];
  if (visibleRequestIds) {
    stages.push({ $set: { allocations: { $filter: { input: '$allocations', as: 'a', cond: { $in: ['$$a.requestId', visibleRequestIds] } } } } });
    stages.push({ $match: { 'allocations.0': { $exists: true } } });
    stages.push({ $set: { amount: { $sum: '$allocations.amountRub' }, sourceAmount: { $sum: '$allocations.sourceAmount' } } });
  }
  stages.push({ $group: { _id: '$invoiceId', paidAmount: { $sum: { $cond: [{ $eq: ['$state', 'active'] }, '$amount', 0] } }, sourcePaidAmount: { $sum: { $cond: [{ $eq: ['$state', 'active'] }, '$sourceAmount', 0] } }, paymentsTotal: { $sum: 1 } } });
  const rows = await connection.db!.collection('supplyinvoicepayments').aggregate(stages).toArray();
  return new Map(rows.map((r) => [String(r._id), r]));
}
