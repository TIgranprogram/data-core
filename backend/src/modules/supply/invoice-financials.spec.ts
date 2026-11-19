import { allocate, factDate, financials, paymentTotals } from './invoice-financials';
const line = (id: string, amount: number, qty = 1) => ({ _id: id, qty, priceHint: amount, title: id });
describe('C158: финансовые инварианты', () => {
  it('включённый НДС22/5%,0% и без НДС не прибавляет налог дважды', () => {
    expect(financials({ vatMode: 'included', vatRate: 22 }, [line('a', 15700)]).calculatedVatAmount).toBe(2831.15);
    expect(financials({ vatMode: 'included', vatRate: 5 }, [line('a', 7455)]).calculatedVatAmount).toBe(355);
    expect(financials({ vatMode: 'included', vatRate: 0 }, [line('a', 10)]).requests[0]).toMatchObject({ vatMode: 'included', vatRate: 0, sourceVatAmount: 0 });
    expect(financials({ vatMode: 'none' }, [line('a', 10)]).requests[0].vatMode).toBe('none');
  });
  it('разнос копеек детерминирован и суммы не теряются', () => {
    const a = allocate(.02, [{ id: 'c', weight: 1 }, { id: 'a', weight: 1 }, { id: 'b', weight: 1 }]);
    expect([...a.values()].reduce((s, n) => s + n, 0)).toBe(.02);
    expect(a.get('a')).toBe(.01); expect(a.get('b')).toBe(.01); expect(a.get('c')).toBe(0);
  });
  it('неизвестные рубли не840руб за840USD; условная единица сохраняется отдельно', () => {
    const usd = financials({ currency: 'USD', financialLines: { a: { sourceLineAmount: 840 } } }, [line('a', 0)]);
    expect(usd).toMatchObject({ sourceAmount: 840, accountingAmountRub: null, accountingState: 'unresolved' });
    expect(financials({ currency: 'UE', currencyName: 'по договору', confirmedAmountRub: 30326, financialLines: { a: { sourceLineAmount: 360 } } }, [line('a', 0)])).toMatchObject({ currency: 'UE', sourceAmount: 360, accountingAmountRub: 30326 });
  });
  it('реальные рубли разных курсов не становятся ложным остатком валютного документа', () => {
    const inv = { currency: 'USD', paymentAccountingVersion: 1, financialLines: { a: { sourceLineAmount: 100 } }, exchangeRate: 80 };
    const f = financials(inv, [line('a', 8000)]);
    expect(paymentTotals(inv, f, [{ state: 'active', amount: 4000, sourceAmount: 50 }, { state: 'active', amount: 4500, sourceAmount: 50 }])).toMatchObject({ paymentState: 'paid', paidAmount: 8500, sourceBalance: 0, balanceDue: 0 });
  });
  it('расхождение исходной цены и суммы предупреждается без перезаписи первички', () => {
    const f = financials({ currency: 'USD', financialLines: { a: { sourceUnitPrice: .45, sourceLineAmount: 581.90 } } }, [line('a', 0, 1300)]);
    expect(f.sourceAmount).toBe(581.90); expect(f.warnings.length).toBe(1);
  });
  it('несуществующий день и будущая дата не превращаются в факт', () => {
    expect(() => factDate('2026-02-30')).toThrow(); expect(() => factDate('2099-01-01')).toThrow(); expect(factDate('2026-09-17')).toBe('2026-09-17');
  });

  it('несогласованная legacy оплата без snapshot не придумывает сумму оплаты или долг', () => {
    const inv = { status: 'paid', amount: 36824.24 }, f = financials(inv, [line('a', 153980)]);
    expect(paymentTotals(inv, f, [])).toMatchObject({ reconciliationRequired: true, paymentState: 'reconciliation', paidAmount: null, sourcePaidAmount: null, sourceBalance: null, balanceDue: null });
  });
  it('legacy snapshot сохраняет известную оплату при конфликте текущего обязательства', () => {
    const inv = { status: 'paid', amount: 120, paymentSnapshot: { amount: 100, lines: [{ requestId: 'a', lineAmount: 100 }] } }, f = financials(inv, [line('a', 120)]);
    expect(paymentTotals(inv, f, [])).toMatchObject({ reconciliationRequired: true, paymentState: 'reconciliation', paidAmount: 100, sourcePaidAmount: 100, sourceBalance: null, balanceDue: null });
    const stable = { ...inv, amount: 100 };
    expect(paymentTotals(stable, financials(stable, [line('a', 100)]), [])).toMatchObject({ reconciliationRequired: false, paymentState: 'paid', balanceDue: 0 });
  });

});
