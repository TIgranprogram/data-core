import { randomInt } from 'crypto';

/** Типы сущностей: S — позиция склада (materials), M — материал (зарезервирован), P — изделие (products). */
export const QR_TYPES = ['S', 'M', 'P'] as const;
export type QrType = (typeof QR_TYPES)[number];

/** Алфавит кода: без 0, O, 1, I, L (путаются глазами и на печати). */
export const QR_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_RE = /^[SMP]-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

/** Новый случайный код: `S-7K3QX9TD`. */
export function makeCode(type: QrType, rnd: (n: number) => number = randomInt): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += QR_ALPHABET[rnd(QR_ALPHABET.length)];
  return `${type}-${s}`;
}

/** Адрес в QR. База — QR_BASE_URL из .env, по умолчанию публичный адрес проекта. */
export function qrUrl(code: string, base = process.env.QR_BASE_URL || 'https://kppdf-crm.ru/db'): string {
  return `${base.replace(/\/+$/, '')}/q/${code}`;
}
