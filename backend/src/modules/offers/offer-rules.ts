import { BadRequestException } from '@nestjs/common';
import type { OfferStatus } from './offer.schema';

export const STATUS_RU: Record<OfferStatus, string> = {
  draft: 'Черновик', sent: 'Отправлено', accepted: 'Принято', paid: 'Оплачено', rejected: 'Отклонено', cancelled: 'Отменено',
};

const FORWARD: Partial<Record<OfferStatus, OfferStatus>> = { draft: 'sent', sent: 'accepted', accepted: 'paid' };

/** Переход допустим: вперёд по цепочке или «Отклонено / Отменено» из любого, кроме «Оплачено». */
export function canMove(from: OfferStatus, to: OfferStatus): boolean {
  if (from === 'paid' || from === to) return false;
  if (to === 'rejected' || to === 'cancelled') return true;
  return FORWARD[from] === to;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Сумма строки и итог КП; цена не задана — строка считается как 0. */
export function calcTotals<T extends { quantity: number; unitPrice?: number | null }>(items: T[]): { items: Array<T & { total: number }>; total: number } {
  const rows = items.map((i) => ({ ...i, total: round2((Number(i.quantity) || 0) * (Number(i.unitPrice) || 0)) }));
  return { items: rows, total: round2(rows.reduce((s, r) => s + r.total, 0)) };
}

/** Проверка смены статуса; бросает 400 по-русски. */
export function checkMove(from: OfferStatus, to: OfferStatus, items: Array<{ productName: string; unitPrice?: number | null }>): void {
  if (from === 'paid') throw new BadRequestException('КП оплачено — менять статус нельзя');
  if (from === to) throw new BadRequestException(`КП уже в статусе «${STATUS_RU[to]}»`);
  if (!canMove(from, to)) throw new BadRequestException(`Из статуса «${STATUS_RU[from]}» нельзя перейти в «${STATUS_RU[to]}»`);
  if (to === 'sent') {
    if (!items.length) throw new BadRequestException('Добавьте хотя бы одну строку в КП');
    const bad = items.find((i) => !(Number(i.unitPrice) > 0));
    if (bad) throw new BadRequestException(`Укажите цену у строки «${bad.productName}» — без цен КП отправить нельзя`);
  }
}

/** Оплаченное КП править нельзя. */
export function checkEditable(status: OfferStatus): void {
  if (status === 'paid') throw new BadRequestException('КП оплачено — правка закрыта');
}
