import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { FINANCIAL_META, type FinancialRecord as Row } from './invoice-financials';
export const hasUndatedPayment = (invoice: Row) => invoice.undatedPaymentEvidence?.state === 'pending';
export const undatedLocked = () => new ConflictException({ message: 'Оплата подтверждена без даты — сначала укажите дату либо снимите подтверждение с причиной', code: 'UNDATED_PAYMENT_PENDING' });
const ordered = (value: any): any => value === null || typeof value !== 'object' ? value : Array.isArray(value) ? value.map(ordered) : Object.fromEntries(Object.keys(value).sort().map(k => [k, ordered(value[k])]));
export const undatedHash = (value: unknown) => createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
/** Название и номер могут исправляться; денежная основа и аналитические ссылки фиксируются. */
export function undatedBasis(invoice: Row, lines: Row[]) {
  return undatedHash({ amount: invoice.amount, payerCompanyId: String(invoice.payerCompanyId || ''), supplierId: String(invoice.supplierId || ''), financial: Object.fromEntries(FINANCIAL_META.map(k => [k, invoice[k] ?? null])), financialLines: invoice.financialLines || {}, lines: lines.map(x => ({ id: String(x._id), qty: x.qty, priceHint: x.priceHint, companyId: String(x.companyId || ''), articleId: String(x.articleId || ''), categoryId: String(x.categoryId || ''), salesOrderId: String(x.salesOrderId || ''), costCenter: x.costCenter || null, costObject: x.costObject || null })).sort((a,b) => a.id.localeCompare(b.id)) });
}
