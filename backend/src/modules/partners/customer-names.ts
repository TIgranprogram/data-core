import type { Connection } from 'mongoose';

type Db = NonNullable<Connection['db']>;

/**
 * Один источник «Заказчики» (TASKS ЗЧ.1): контрагенты-заказчики (`organizations` type 'customer', СП.1)
 * + заказчики из заказов (`salesorders.customer`, `incomes.customer`). Для полей «Заказчик» в заявке, заказе,
 * позиции заказа и фильтров. Тексты, когда-то вписанные в заявки (`orderLabel`), и список Google-таблицы сюда НЕ входят.
 */
export const normName = (s: unknown) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'„“”]/g, '').replace(/\s+/g, ' ').trim();

/** Без дублей по написанию (регистр, пробелы, кавычки); при совпадении — название контрагента. По алфавиту. */
export function uniqueNames(preferred: unknown[], others: unknown[]) {
  const out = new Map<string, string>();
  for (const v of [...preferred, ...others]) {
    const t = String(v ?? '').replace(/\s+/g, ' ').trim();
    if (t && !out.has(normName(t))) out.set(normName(t), t);
  }
  return [...out.values()].sort((a, b) => a.localeCompare(b, 'ru'));
}

export async function customerNames(db: Db) {
  const [orgs, so, inc] = await Promise.all([
    db.collection('organizations').find({ deletedAt: null, type: 'customer', isOurCompany: { $ne: true } }, { projection: { name: 1 } }).toArray(),
    db.collection('salesorders').distinct('customer', { deletedAt: null }),
    db.collection('incomes').distinct('customer', { deletedAt: null }),
  ]);
  return uniqueNames(orgs.map((o) => o.name), [...so, ...inc]);
}

/** «ИП Сахаджи, Академия благоустройства» → { customer: 'ИП Сахаджи', object: 'Академия благоустройства' } (ЗЧ.2); без запятой — null. */
export function splitCustomer(text: unknown) {
  const s = String(text ?? '').trim();
  const i = s.indexOf(',');
  if (i <= 0) return null;
  const customer = s.slice(0, i).trim(), object = s.slice(i + 1).trim();
  return customer && object ? { customer, object } : null;
}
