import { BadRequestException } from '@nestjs/common';

export const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Дата ГГГГ-ММ-ДД → Date (UTC, полночь); неверная — 400 по-русски. */
export function parseDay(v: unknown): Date {
  const s = String(v ?? '');
  const d = new Date(s + 'T00:00:00Z');
  if (!DAY.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new BadRequestException('Дата — в формате ГГГГ-ММ-ДД');
  return d;
}

/** Сумма: число больше нуля, до копеек. */
export function parseAmount(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new BadRequestException('Сумма больше нуля');
  return Math.round(n * 100) / 100;
}

export const cleanText = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
