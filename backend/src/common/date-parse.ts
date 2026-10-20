/**
 * Дата из ячейки Google-таблицы / поля формы → Date (полночь UTC) или undefined.
 * Понимает: Date; «ГГГГ-ММ-ДД» (и ISO со временем); «дд.мм.гггг», «дд.мм.гг», «д.м.гггг»;
 * число-дату Google/Excel (дни от 30.12.1899). Мусор и несуществующие даты → undefined.
 */
const GOOGLE_EPOCH = Date.UTC(1899, 11, 30);

function utc(y: number, m: number, d: number): Date | undefined {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // 31.02 и т.п. — Date «перекатывает» на март: такую дату не принимаем
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : undefined;
}

export function parseSheetDate(v: unknown): Date | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : utc(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === 'number') {
    // число-дата: 25 000..80 000 ≈ 1968..2119 — иначе это не дата (сумма, номер)
    if (!Number.isFinite(v) || v < 25000 || v > 80000) return undefined;
    const d = new Date(GOOGLE_EPOCH + Math.floor(v) * 86400000);
    return utc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return utc(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})(?:\s.*)?$/.exec(s);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += 2000;
    return utc(y, +m[2], +m[1]);
  }
  if (/^\d+(\.\d+)?$/.test(s)) return parseSheetDate(Number(s));
  return undefined;
}
