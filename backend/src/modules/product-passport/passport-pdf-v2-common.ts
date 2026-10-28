import type { Page } from './passport-pdf';
import { PdfPassportV2 } from './passport-pdf-v2-types';

export const A5 = { w: 419.53, h: 595.28 };
export const A4L = { w: 841.89, h: 595.28 };
export const M = { l: 34, r: 28, t: 30, b: 44 };
export const CW = A5.w - M.l - M.r;
export const BOTTOM = A5.h - M.b;
export const BODY = 8.8;

export type Draw = (d: PDFKit.PDFDocument, y: number) => void;
export interface V2Page extends Page { footer?: boolean }
export type Cell = string | { box: true } | { img?: Buffer; h: number };

export const has = (v: unknown) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));
export const num = (v: unknown) => String(v).replace('.', ',');
export function years(n: number): string {
  const a = Math.abs(n) % 100, b = a % 10;
  return `${num(n)} ${a > 10 && a < 20 ? 'лет' : b === 1 ? 'год' : b >= 2 && b <= 4 ? 'года' : 'лет'}`;
}
export const range = (a: unknown, b: unknown, unit: string) => (has(a) && has(b) ? `${num(a)}–${num(b)} ${unit}` : has(a) ? `от ${num(a)} ${unit}` : has(b) ? `до ${num(b)} ${unit}` : '');
export const lines = (s?: string) => String(s ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

/** Плитки «Коротко» (§3.7): только заполненные. */
export function shortTiles(p: PdfPassportV2): Array<{ label: string; value: string }> {
  return [
    { label: 'Возраст', value: range(p.ageFrom, p.ageTo, 'лет') },
    { label: 'Рост пользователя', value: range(p.heightMin, p.heightMax, 'см') },
    { label: 'Пользователей одновременно', value: has(p.maxUsers) ? `не более ${num(p.maxUsers)}` : '' },
    { label: 'Вес пользователя', value: has(p.weightMax) ? `до ${num(p.weightMax)} кг` : '' },
    { label: 'Высота падения', value: has(p.fallHeight) ? `до ${num(p.fallHeight)} мм` : '' },
    { label: 'Срок службы', value: has(p.serviceLifeYears) ? years(Number(p.serviceLifeYears)) : '' },
    { label: 'Гарантия', value: has(p.warrantyMonths) ? `${num(p.warrantyMonths)} мес.` : '' },
  ].filter((t) => t.value);
}

/** Пиктограмма правила: «Не …» — запрещающий знак (красный круг с чертой), иначе — информационный (круг цвета категории). */
export function ruleIcon(d: PDFKit.PDFDocument, x: number, y: number, r: number, text: string, color: string) {
  const cx = x + r, cy = y + r;
  if (/^не\s/i.test(text)) {
    d.save().lineWidth(1.6).strokeColor(color).circle(cx, cy, r - 1).stroke();
    d.moveTo(cx - (r - 1) * 0.7, cy - (r - 1) * 0.7).lineTo(cx + (r - 1) * 0.7, cy + (r - 1) * 0.7).stroke().restore();
  } else {
    d.save().lineWidth(1.2).strokeColor(color).moveTo(cx, y + 1).lineTo(x + 2 * r - 1, y + 2 * r - 1).lineTo(x + 1, y + 2 * r - 1).closePath().stroke();
    d.font('gost').fontSize(r * 1.1).fillColor('#000').text('!', x, cy - r * 0.2, { width: 2 * r, align: 'center', lineBreak: false }).restore();
  }
}

