/** Ставка НДС по умолчанию, если у счёта её нет (до шага 2 аудита данных). */
export const DEFAULT_VAT_RATE = 20;

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Цена за единицу из суммы строки (с НДС) и количества. null — считать нечего. */
export function unitPrices(lineTotalWithVat: number, qty: number, vatRate = DEFAULT_VAT_RATE): { price: number; priceWithVat: number } | null {
  if (!(lineTotalWithVat > 0) || !(qty > 0)) return null;
  const withVat = lineTotalWithVat / qty;
  return { priceWithVat: r4(withVat), price: r4(withVat / (1 + vatRate / 100)) };
}
