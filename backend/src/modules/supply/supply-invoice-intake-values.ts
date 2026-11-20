import { BadRequestException } from '@nestjs/common';
import { parseSheetDate } from '../../common/date-parse';
import { legalHash } from '../../common/legal/legal-utils';
import type { SupplyInvoiceIntakeDto } from './dto-invoice-intake';
import { cents, financials, moneyValue, roundMoney } from './invoice-financials';
import { normInvoiceNo } from './supply-invoice-rules';

/** Один снимок для проверки запроса, записи и независимого восстановления из текущих строк. */
export function prepareInvoiceIntake(dto: SupplyInvoiceIntakeDto) {
  const date = parseSheetDate(dto.date);
  if (!date || date.toISOString().slice(0, 10) !== dto.date) throw new BadRequestException('Укажите существующую дату счёта в формате ГГГГ-ММ-ДД');
  const no = dto.no.trim();
  const noKey = normInvoiceNo(no);
  if (!noKey) throw new BadRequestException('Укажите полный номер счёта');
  const gross = moneyValue(dto.gross, 'Итог счёта', true);
  const vatAmount = dto.vatAmount === undefined ? undefined : moneyValue(dto.vatAmount, 'НДС счёта');
  if (dto.vatMode === 'none' && ((dto.vatRate ?? 0) !== 0 || (vatAmount ?? 0) !== 0)) {
    throw new BadRequestException('Для счёта без НДС ставка и НДС должны быть нулевыми или отсутствовать');
  }
  const seen = new Set<string>();
  const lines = dto.lines.map(line => {
    const rowKey = line.rowKey.trim();
    const title = line.title.trim();
    const unit = line.unit.trim();
    if (!rowKey || seen.has(rowKey)) throw new BadRequestException('Каждой строке счёта нужен отдельный ключ');
    if (!title || !unit || !Number.isFinite(line.qty) || line.qty <= 0) throw new BadRequestException('Заполните наименование, единицу и положительное количество строки');
    seen.add(rowKey);
    const unitPrice = moneyValue(line.unitPrice, 'Цена за единицу');
    const amount = moneyValue(line.amount, 'Сумма строки');
    if (cents(roundMoney(unitPrice * line.qty)) !== cents(amount)) throw new BadRequestException(`Строка «${title}»: сумма не совпадает с количеством × цену`);
    return { rowKey, title, qty: line.qty, unit, unitPrice, amount };
  });
  const { uid, sourceSha256, vatMode, vatRate, currency } = dto;
  const payerCompanyId = dto.payerCompanyId.toLowerCase();
  const supplierId = dto.supplierId.toLowerCase();
  const fileId = dto.fileId.toLowerCase();
  if (payerCompanyId === supplierId) throw new BadRequestException('Поставщик и наша компания должны быть разными организациями');
  const payload = {
    uid, sourceSha256, supplierId, payerCompanyId, fileId, no, date: dto.date, currency, gross, vatMode,
    ...(vatRate !== undefined ? { vatRate } : {}), ...(vatAmount !== undefined ? { vatAmount } : {}), lines,
  };
  const headerTax = { currency, vatMode, vatRate, declaredVatAmount: vatAmount };
  const inputLines = lines.map((line, index) => ({ _id: String(index), title: line.title, qty: line.qty }));
  const financialLines = Object.fromEntries(lines.map((line, index) => [
    String(index), { sourceUnitPrice: line.unitPrice, sourceLineAmount: line.amount },
  ]));
  const valuation = financials({ ...headerTax, financialLines }, inputLines);
  if (valuation.sourceAmount === null || cents(valuation.sourceAmount) !== cents(gross)) throw new BadRequestException('Итог счёта не совпадает с суммой строк');
  if (vatAmount !== undefined && (valuation.calculatedVatAmount === null || cents(valuation.calculatedVatAmount) !== cents(vatAmount))) {
    throw new BadRequestException('НДС счёта не совпадает с расчётом по строкам');
  }
  return {
    payload,
    date,
    noKey,
    headerTax,
    payloadHash: legalHash(payload),
    businessKey: legalHash([supplierId, payerCompanyId, noKey, dto.date]),
    pricesRub: valuation.requests.map(line => line.accountingLineAmountRub!),
  };
}

export type PreparedInvoiceIntake = ReturnType<typeof prepareInvoiceIntake>;
export const intakeLineUid = (uid: string, rowKey: string) => 'c169-supply-' + legalHash([uid, rowKey]);
