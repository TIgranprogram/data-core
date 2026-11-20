import { BadRequestException, ConflictException } from '@nestjs/common';
import { legalHash } from '../../common/legal/legal-utils';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const cents = (v: unknown) => Math.round(Number(v) * 100);

/** Полный исторический итог и согласованный состав не подменяют друг друга. */
export function agreedOfferTotal(items: Row[]): number {
  return items.filter((r) => r.scopeState !== 'excluded').reduce((sum, r) => sum + cents(r.total || 0), 0) / 100;
}

/** Источник строки неизменен; исключение не удаляет её из истории. */
export function validateSourceItems(items: Row[], previous?: Row[]) {
  const keys = new Set<string>();
  for (const row of items) {
    if (row.sourceLine) {
      if (!row.sourceRowKey || row.sourceLine.rowKey !== row.sourceRowKey) throw new BadRequestException('Укажите устойчивый ключ исходной строки');
      if (keys.has(row.sourceRowKey)) throw new BadRequestException('Повтор исходной строки КП');
      keys.add(row.sourceRowKey);
      if (row.productName !== row.sourceLine.title || Number(row.quantity) !== Number(row.sourceLine.qty) || (row.sourceLine.unitPrice !== undefined && cents(row.unitPrice) !== cents(row.sourceLine.unitPrice))) throw new ConflictException('Название, количество и цена исходной строки сохраняются по документу');
    } else if (row.sourceRowKey) throw new BadRequestException('Для исходной строки нужен снимок документа');
    if (row.scopeState === 'excluded' && (!row.exclusionReason?.trim() || !row.exclusionConfirmedAt)) throw new BadRequestException('Для исключения строки нужны причина и дата подтверждения');
    if (row.matchStatus === 'confirmed' && !row.productId) throw new BadRequestException('Сначала выберите изделие для сопоставления');
  }
  for (const old of previous || []) {
    if (!old.sourceLine) continue;
    const next = items.find((r) => r.sourceRowKey === old.sourceRowKey);
    if (!next || legalHash(next.sourceLine) !== legalHash(old.sourceLine)) throw new ConflictException('Исходная строка КП неизменяема: сохраните новую редакцию документа');
  }
}

/** Привязка не создаёт второй договор и не означает оплату/принятие КП. */
export function assertOfferOrderMatch(offer: Row, order: Row, lines: Row[]) {
  if (String(offer.companyId) !== String(order.companyId)) throw new ConflictException('В КП и договоре разные наши компании');
  if (!offer.counterpartyId || !order.counterpartyId || String(offer.counterpartyId) !== String(order.counterpartyId)) throw new ConflictException('Уточните одного покупателя в КП и договоре');
  const selected = (offer.items || []).filter((r: Row) => r.scopeState !== 'excluded');
  if (selected.length !== lines.length) throw new ConflictException('Состав КП отличается от договора');
  const used = new Set<number>();
  for (const row of selected) {
    const hit = lines.findIndex((line, index) => !used.has(index)
      && String(line.sourceLine?.title || line.title).trim() === String(row.sourceLine?.title || row.productName).trim()
      && Number(line.qty) === Number(row.quantity)
      && cents(line.amount ?? Number(line.qty) * Number(line.unitPrice || 0)) === cents(row.total)
      && String(line.sourceLine?.dimensions || line.size || '') === String(row.sourceLine?.dimensions || row.size || ''));
    if (hit < 0) throw new ConflictException('Позиции, количества, размеры или суммы КП и договора различаются');
    used.add(hit);
  }
}
