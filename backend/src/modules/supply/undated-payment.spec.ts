import { Types } from 'mongoose';
import { undatedBasis } from './undated-payment';
import { financials, paymentTotals } from './invoice-financials';

describe('C165: финансовая основа и состояние без даты', () => {
  const invoice = { amount: 100, payerCompanyId: new Types.ObjectId(), supplierId: new Types.ObjectId() };
  const lines = [{ _id: new Types.ObjectId(), qty: 2, priceHint: 100, companyId: invoice.payerCompanyId, articleId: new Types.ObjectId() }];
  it('номер/название не меняют основу, плательщик/цена/статья меняют', () => {
    const basis = undatedBasis(invoice, lines);
    expect(undatedBasis({ ...invoice, no: 'Исправлен номер' }, lines.map(x => ({ ...x, title: 'Название' })))).toBe(basis);
    expect(undatedBasis(invoice, lines.map(x => ({ ...x, priceHint: 120 })))).not.toBe(basis);
    expect(undatedBasis(invoice, lines.map(x => ({ ...x, articleId: new Types.ObjectId() })))).not.toBe(basis);
    expect(undatedBasis({ ...invoice, payerCompanyId: new Types.ObjectId() }, lines)).not.toBe(basis);
  });
  it('подтверждение не является paidAmount/нулевым долгом и работает без marker1', () => {
    const pending = { ...invoice, status: 'issued', undatedPaymentEvidence: { state: 'pending', amountRub: 100 } };
    expect(paymentTotals(pending, financials(pending, lines), [])).toMatchObject({ paymentState: 'date_required', undatedConfirmedAmountRub: 100, paidAmount: null, sourcePaidAmount: null, balanceDue: null, sourceBalance: null });
  });
});
