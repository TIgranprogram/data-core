/** Форматы по-русски (CANON §2 «Тексты»): 19.10.2026, 12 500,00 ₽, количества без лишних нулей. */
const two = (n) => String(n).padStart(2, '0');

export function date(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function dateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${date(d)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Дата для <input type=date>: YYYY-MM-DD в местном времени. */
export function isoDay(v = new Date()) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

const moneyFmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function money(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? `${moneyFmt.format(n)} ₽` : '';
}

const qtyFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
export function qty(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? qtyFmt.format(n) : String(v);
}

/** Число из поля ввода: «1 234,5» → 1234.5; пусто → undefined. */
export function parseNum(v) {
  const s = String(v ?? '').replace(/\s/g, '').replace(',', '.');
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
