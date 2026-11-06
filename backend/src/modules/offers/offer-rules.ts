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

/** Что известно про КП для обхода администратором: заказ из КП уже создан — «Оплачено» не открываем (ЗЯ-1, решение B). */
export interface OfferBypass { admin?: boolean; hasOrder?: boolean }

/**
 * Проверка смены статуса; бросает 400 по-русски. Администратор (ЗЯ-1): переходы в любом направлении
 * и выход из «Оплачено», если заказ из КП ещё не создан. Возвращает true, когда обошли обычное правило
 * (нужна причина и запись в журнал). Цена к «Отправлено» обязательна для всех.
 */
export function checkMove(from: OfferStatus, to: OfferStatus, items: Array<{ productName: string; unitPrice?: number | null }>, bypass: OfferBypass = {}): boolean {
  const open = !!bypass.admin && !bypass.hasOrder;
  let overridden = false;
  if (from === 'paid' && !open) throw new BadRequestException('КП оплачено — менять статус нельзя');
  if (from === to) throw new BadRequestException(`КП уже в статусе «${STATUS_RU[to]}»`);
  if (from === 'paid') {
    overridden = true;
  } else if (!canMove(from, to)) {
    if (!bypass.admin) throw new BadRequestException(`Из статуса «${STATUS_RU[from]}» нельзя перейти в «${STATUS_RU[to]}»`);
    overridden = true;
  }
  if (to === 'sent') {
    if (!items.length) throw new BadRequestException('Добавьте хотя бы одну строку в КП');
    const bad = items.find((i) => !(Number(i.unitPrice) > 0));
    if (bad) throw new BadRequestException(`Укажите цену у строки «${bad.productName}» — без цен КП отправить нельзя`);
  }
  return overridden;
}

/** Оплаченное КП править нельзя; администратору можно, пока заказ из КП не создан. true — обход (нужна причина и журнал). */
export function checkEditable(status: OfferStatus, bypass: OfferBypass = {}): boolean {
  if (status !== 'paid') return false;
  if (bypass.admin && !bypass.hasOrder) return true;
  throw new BadRequestException('КП оплачено — правка закрыта');
}

export type VatMode = 'with' | 'without';
export const DEFAULT_VAT_RATE = 22;

/**
 * НДС КП: режим пусто → по ставке фирмы (> 0 — «с НДС»); ставка пусто → ставка фирмы, нет — 22.
 * «Без НДС» ставку не печатает, но возвращаем её для формы.
 */
export function resolveVat(mode: VatMode | null | undefined, rate: number | null | undefined, orgRate: number | null | undefined): { vatMode: VatMode; vatRate: number } {
  const org = Number(orgRate);
  const vatMode: VatMode = mode ?? (org > 0 ? 'with' : 'without');
  const own = rate === null || rate === undefined ? NaN : Number(rate);
  const vatRate = Number.isFinite(own) ? own : org > 0 ? org : DEFAULT_VAT_RATE;
  return { vatMode, vatRate };
}

/** НДС внутри суммы: total × ставка / (100 + ставка), 2 знака. */
export const vatAmount = (total: number, rate: number): number => round2((Number(total) * rate) / (100 + rate));

/** Цена строки с наценкой, % (отрицательная — скидка): округление до рубля. */
export const markedUp = (price: number, percent: number): number => Math.round((Number(price) * (100 + percent)) / 100);

/** Срок действия в календарных днях: validUntil − date; нет даты или не больше нуля — null. */
export function validDays(date: Date | string, validUntil?: Date | string | null): number | null {
  if (!validUntil) return null;
  const n = Math.round((new Date(validUntil).getTime() - new Date(date).getTime()) / 86400000);
  return Number.isFinite(n) && n > 0 ? n : null;
}
