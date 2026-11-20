import type { SupplyInvoiceIntakeDto } from './dto-invoice-intake';
import { prepareInvoiceIntake } from './supply-invoice-intake-values';

const invoice: SupplyInvoiceIntakeDto = {
  uid: 'c169-finance-unit', sourceSha256: 'a'.repeat(64), fileId: '1'.repeat(24),
  supplierId: '2'.repeat(24), payerCompanyId: '3'.repeat(24), no: '128/Б', date: '2026-11-20',
  currency: 'RUB', gross: 144.23, vatMode: 'excluded', vatRate: 20, vatAmount: 24.04,
  lines: [
    { rowKey: '1', title: 'Лист', qty: 1.5, unit: 'м²', unitPrice: 80.1, amount: 120.15 },
    { rowKey: '2', title: 'Шайба', qty: 1, unit: 'шт', unitPrice: .04, amount: .04 },
  ],
};

describe('подготовка первички счёта C169', () => {
  it('сохраняет обе цены документа и считает НДС и валовые суммы построчно', () => {
    const data = prepareInvoiceIntake(invoice);
    expect(data.payload.lines).toEqual(invoice.lines);
    expect(data.pricesRub).toEqual([144.18, .05]);
    expect(prepareInvoiceIntake({ ...invoice, no: ' № 128 / б ' }).businessKey).toBe(data.businessKey);
    expect(prepareInvoiceIntake({ ...invoice, no: '128/В' }).businessKey).not.toBe(data.businessKey);
  });
  it.each<Partial<SupplyInvoiceIntakeDto>>([
    { gross: 144.24 }, { vatAmount: 24.03 }, { vatRate: undefined }, { date: '2026-02-30' },
    { payerCompanyId: invoice.supplierId }, { vatMode: 'none', vatRate: 20 },
    { lines: [invoice.lines[0], invoice.lines[0]] }, { lines: [{ ...invoice.lines[0], qty: 0 }] },
    { lines: [{ ...invoice.lines[0], amount: 120.14 }] },
  ])('останавливает импорт при несогласованных реквизитах %#', override => {
    expect(() => prepareInvoiceIntake({ ...invoice, ...override })).toThrow();
  });
});
