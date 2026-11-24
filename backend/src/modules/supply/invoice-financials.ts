import { BadRequestException } from '@nestjs/common';
import { moscowToday } from '../../common/moscow-today';

export {
  INVOICE_CURRENCIES, FOREIGN_INVOICE_CURRENCIES, roundMoney, cents, moneyValue, allocate, financials, legacyReconciliation, paymentTotals,
} from '../../common/invoice-amounts';
export type { FinancialRecord } from '../../common/invoice-amounts';
export { moscowToday };

export const FINANCIAL_META = ['currency', 'currencyName', 'exchangeRate', 'exchangeRateDate', 'exchangeRateSource', 'confirmedAmountRub', 'conversionNote', 'vatMode', 'vatRate', 'declaredVatAmount'];
export const SOURCE_LINE_KEYS = ['sourceUnitPrice', 'sourceLineAmount', 'vatMode', 'vatRate', 'declaredVatAmount'];
export function factDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value || value > moscowToday()) throw new BadRequestException('Дата факта: существующий день не позже сегодня, ГГГГ-ММ-ДД');
  return value;
}
