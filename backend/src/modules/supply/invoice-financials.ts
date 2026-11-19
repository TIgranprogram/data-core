import { BadRequestException, ConflictException } from '@nestjs/common';

export const INVOICE_CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY', 'UE'] as const;
export const FOREIGN_INVOICE_CURRENCIES = INVOICE_CURRENCIES.filter((currency) => currency !== 'RUB');

export type FinancialRecord = Record<string, any>;
export const FINANCIAL_META = ['currency', 'currencyName', 'exchangeRate', 'exchangeRateDate', 'exchangeRateSource', 'confirmedAmountRub', 'conversionNote', 'vatMode', 'vatRate', 'declaredVatAmount'];
export const SOURCE_LINE_KEYS = ['sourceUnitPrice', 'sourceLineAmount', 'vatMode', 'vatRate', 'declaredVatAmount'];
export const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const cents = (n: number) => Math.round(n * 100);
export function moneyValue(value: unknown, name: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (positive && value === 0) || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) throw new BadRequestException(`${name}: укажите сумму с точностью до копейки`);
  return value;
}
export const moscowToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function factDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value || value > moscowToday()) throw new BadRequestException('Дата факта: существующий день не позже сегодня, ГГГГ-ММ-ДД');
  return value;
}
/** Разнос в минимальных единицах, одинаковые остатки — по стабильному id строки. */
export function allocate(amount: number, rows: { id: string; weight: number }[]): Map<string, number> {
  const units = cents(amount), weights = rows.map((x) => ({ id: x.id, units: BigInt(cents(x.weight)) }));
  const total = weights.reduce((sum, x) => sum + x.units, BigInt(0));
  if (units < 0 || !Number.isSafeInteger(units) || (units > 0 && total <= BigInt(0))) throw new ConflictException('Нельзя распределить сумму: проверьте строки счёта');
  const shares = weights.map((x) => { const product = BigInt(units) * x.units; return { id: x.id, units: total > BigInt(0) ? product / total : BigInt(0), fraction: total > BigInt(0) ? product % total : BigInt(0) }; });
  let left = BigInt(units) - shares.reduce((sum, x) => sum + x.units, BigInt(0));
  for (const x of [...shares].sort((a, b) => a.fraction === b.fraction ? a.id.localeCompare(b.id) : a.fraction > b.fraction ? -1 : 1)) if (left-- > BigInt(0)) x.units++;
  return new Map(shares.map((x) => [x.id, Number(x.units) / 100]));
}
export function financials(inv: FinancialRecord, lines: FinancialRecord[]) {
  const currency = inv.currency || 'RUB', foreign = currency !== 'RUB', warnings: string[] = [];
  const stored: FinancialRecord = inv.financialLines || {};
  const rows = lines.filter((x) => !x.deletedAt && x.status !== 'cancelled').map((line) => {
    const id = String(line._id || line.id), meta = stored[id] || {}, qty = Number(line.qty) || 0;
    const sourceLineAmount = meta.sourceLineAmount ?? (meta.sourceUnitPrice !== undefined ? roundMoney(meta.sourceUnitPrice * qty) : foreign ? null : Number(line.priceHint) || 0);
    const mode = meta.vatMode ?? inv.vatMode, rate = meta.vatRate ?? inv.vatRate;
    if (mode === 'mixed') throw new BadRequestException('Для смешанного НДС укажите режим каждой строки');
    if (mode && mode !== 'none' && ![0, 5, 7, 10, 20, 22].includes(rate)) throw new BadRequestException('Укажите ставку НДС строки или счёта');
    const raw = sourceLineAmount === null ? null : moneyValue(sourceLineAmount, 'Сумма исходной строки');
    const gross = raw === null ? null : mode === 'excluded' ? roundMoney(raw * (1 + rate / 100)) : raw;
    const tax = raw === null || !mode ? null : mode === 'none' ? 0 : mode === 'excluded' ? roundMoney(gross! - raw) : roundMoney(raw * rate / (100 + rate));
    if (meta.sourceUnitPrice !== undefined && raw !== null && Math.abs(roundMoney(meta.sourceUnitPrice * qty) - raw) > .009) warnings.push(`Позиция «${line.title || id}»: исходный итог отличается от количества × округлённой цены`);
    const declared = meta.declaredVatAmount ?? null;
    if (declared !== null && tax !== null && Math.abs(declared - tax) > .01) warnings.push(`Позиция «${line.title || id}»: НДС первички отличается от расчёта`);
    return { ...line, _id: line._id, sourceUnitPrice: meta.sourceUnitPrice ?? (raw !== null && qty > 0 ? roundMoney(raw / qty) : null), sourceLineAmount: raw, sourceGrossAmount: gross, sourceVatAmount: tax, vatMode: mode ?? null, vatRate: rate ?? null, declaredVatAmount: declared, id };
  });
  const sourceKnown = rows.every((x) => x.sourceGrossAmount !== null), sourceAmount = sourceKnown ? roundMoney(rows.reduce((s, x) => s + (x.sourceGrossAmount || 0), 0)) : null;
  let accountingAmountRub: number | null = foreign ? null : sourceAmount;
  if (foreign && sourceKnown && inv.confirmedAmountRub != null) accountingAmountRub = moneyValue(inv.confirmedAmountRub, 'Подтверждённая сумма');
  else if (foreign && sourceKnown && Number(inv.exchangeRate) > 0) accountingAmountRub = roundMoney(rows.reduce((s, x) => s + roundMoney((x.sourceGrossAmount || 0) * inv.exchangeRate), 0));
  const distributed = accountingAmountRub === null ? new Map<string, number>() : allocate(accountingAmountRub, rows.map((x) => ({ id: x.id, weight: x.sourceGrossAmount || 0 })));
  const calculatedVatAmount = rows.every((x) => x.sourceVatAmount !== null) ? roundMoney(rows.reduce((s, x) => s + (x.sourceVatAmount || 0), 0)) : null;
  const declaredVatAmount = inv.declaredVatAmount ?? null;
  const vatDifference = declaredVatAmount !== null && calculatedVatAmount !== null ? roundMoney(declaredVatAmount - calculatedVatAmount) : null;
  if (vatDifference !== null && Math.abs(vatDifference) > .01) warnings.push('НДС документа отличается от расчётного; сверьте первичку');
  return { currency, currencyName: inv.currencyName ?? null, sourceAmount, accountingAmountRub, accountingState: accountingAmountRub === null ? 'unresolved' : 'resolved', calculatedVatAmount, declaredVatAmount, vatDifference, warnings, requests: rows.map((x) => ({ ...x, accountingLineAmountRub: distributed.get(x.id) ?? null })) };
}
/** Legacy paid не доказывает текущую сумму при расхождении источников. Никакой автоматической правки. */
export function legacyReconciliation(inv: FinancialRecord, f: ReturnType<typeof financials>) {
  if (inv.paymentAccountingVersion === 1 || inv.status !== 'paid' || f.currency !== 'RUB') return null;
  const snapshot = inv.paymentSnapshot;
  const known = snapshot && Number.isFinite(snapshot.amount) && snapshot.amount > 0 ? Number(snapshot.amount) : null;
  const currentIds = new Set(f.requests.map((x) => x.id));
  const snapshotLines = Array.isArray(snapshot?.lines) ? snapshot.lines : [];
  const snapshotConflict = snapshot && (known === null || cents(snapshotLines.reduce((sum: number, x: FinancialRecord) => sum + Number(x.lineAmount || 0), 0)) !== cents(known || 0) || snapshotLines.length !== currentIds.size || new Set(snapshotLines.map((x: FinancialRecord) => String(x.requestId))).size !== currentIds.size || snapshotLines.some((x: FinancialRecord) => !currentIds.has(String(x.requestId))));
  const sourceConflict = f.sourceAmount === null || !(f.sourceAmount > 0) || !Number.isFinite(Number(inv.amount)) || cents(Number(inv.amount)) !== cents(f.sourceAmount || 0) || (known !== null && cents(known) !== cents(f.sourceAmount || 0));
  if (!inv.reconciliationRequired && !snapshotConflict && !sourceConflict) return null;
  return { knownPaidAmount: known, reason: String(inv.reconciliationReason || 'Старая оплата и текущие суммы счёта не согласованы. Нужна сверка первичных документов; долг не рассчитан.') };
}
export function paymentTotals(inv: FinancialRecord, f: ReturnType<typeof financials>, payments: FinancialRecord[]) {
  const ledger = inv.paymentAccountingVersion === 1, reconciliation = legacyReconciliation(inv, f);
  if (reconciliation) return { paidAmount: reconciliation.knownPaidAmount, sourcePaidAmount: reconciliation.knownPaidAmount, sourceBalance: null, balanceDue: null, balanceEstimated: false, paymentState: 'reconciliation', paymentSource: 'legacy', reconciliationRequired: true, reconciliationReason: reconciliation.reason };
  const active = payments.filter((p) => p.state === 'active');
  const paidAmount = ledger ? roundMoney(active.reduce((sum, p) => sum + p.amount, 0)) : inv.status === 'paid' ? Number(inv.paymentSnapshot?.amount ?? inv.amount) || 0 : 0;
  const sourcePaidAmount = ledger ? roundMoney(active.reduce((sum, p) => sum + p.sourceAmount, 0)) : inv.status === 'paid' ? f.sourceAmount || paidAmount : 0;
  const sourceBalance = f.sourceAmount === null ? null : Math.max(0, roundMoney(f.sourceAmount - sourcePaidAmount));
  const paymentState = sourceBalance === 0 && (f.sourceAmount || 0) > 0 ? 'paid' : sourcePaidAmount > 0 ? 'partial' : 'unpaid';
  const balanceDue = f.currency === 'RUB' ? Math.max(0, roundMoney((f.accountingAmountRub ?? Number(inv.amount) ?? 0) - paidAmount)) : sourceBalance === 0 ? 0 : f.accountingAmountRub !== null && f.sourceAmount ? roundMoney(f.accountingAmountRub * (sourceBalance! / f.sourceAmount)) : null;
  return { paidAmount, sourcePaidAmount, sourceBalance, balanceDue, balanceEstimated: f.currency !== 'RUB', paymentState, paymentSource: ledger ? 'ledger' : 'legacy', reconciliationRequired: false, reconciliationReason: null };
}
