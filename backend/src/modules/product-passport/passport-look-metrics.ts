import type { PdfBox, PdfLook } from './passport-pdf-v2-types';

/** 1 мм в пунктах PDF (72 pt = 25,4 мм). */
const PT = 72 / 25.4;
/** Поля набора без бланка — те же числа, что `M` в passport-pdf-v2-common. */
const BODY = { l: 34, r: 28, t: 30, b: 44 };

export function mmToPt(mm: number): number {
  return Math.round(mm * PT * 10) / 10;
}

/** Стороны в мм. Все пустые — null (текст на прежних полях). Заданная сторона подменяет поле, остальные — как без бланка. */
export function boxFromMm(m?: { top?: number | null; right?: number | null; bottom?: number | null; left?: number | null } | null): PdfBox | null {
  if (!m || [m.top, m.right, m.bottom, m.left].every((v) => v == null)) return null;
  return {
    t: m.top == null ? BODY.t : mmToPt(m.top),
    r: m.right == null ? BODY.r : mmToPt(m.right),
    b: m.bottom == null ? BODY.b : mmToPt(m.bottom),
    l: m.left == null ? BODY.l : mmToPt(m.left),
  };
}

/**
 * Цвет линий. Нет фона (ни обложки, ни страницы) или «чёрно-белый» — чёрный, как паспорт печатается сейчас.
 * Цвет без картинки вид не меняет.
 */
export function firmAccent(look?: PdfLook | null, mono?: boolean): string {
  if (mono || !look || (!look.cover && !look.page)) return '#000';
  const c = String(look.color || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#000';
}

/** A5 148×210. Вместе поля не съедают набор: ширины ≥ 80 мм, высоты ≥ 100 мм. */
export function assertTextRoom(top: number | null, right: number | null, bottom: number | null, left: number | null, what: string) {
  if ([top, right, bottom, left].every((v) => v == null)) return;
  const t = top ?? 0, r = right ?? 0, b = bottom ?? 0, l = left ?? 0;
  if (l + r > 148 - 80) throw new Error(`${what}: слева и справа вместе оставляют меньше 80 мм для текста`);
  if (t + b > 210 - 100) throw new Error(`${what}: сверху и снизу вместе оставляют меньше 100 мм для текста`);
}
