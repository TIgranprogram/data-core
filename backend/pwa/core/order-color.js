/**
 * Цвет заказа на доске «Проектирование» (DESIGN §4 «Доска заказов»): чистый хеш id заказа → один из 12 токенов
 * `--oc-1…--oc-12` (ui/tokens.css). В базе цвета нет: у всех пользователей и после перезагрузки он тот же.
 * Цвет — не единственный признак: рядом всегда «ЗНП № …» (оттенки могут совпасть у двух заказов — это нормально).
 */
export const ORDER_COLORS = 12;

/** Номер оттенка 1…12 по id заказа (FNV-1a, 32 бита). Пусто — 0 («Без заказа», серый). */
export function orderColorIndex(id) {
  const s = String(id ?? '');
  if (!s) return 0;
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return (x % ORDER_COLORS) + 1;
}

/** Значения свойств `--oc` / `--oc-soft` для карточки заказа или его изделия. */
export function orderColor(id) {
  const n = orderColorIndex(id);
  return n ? { n, oc: `var(--oc-${n})`, soft: `var(--oc-${n}-soft)` } : { n: 0, oc: 'var(--muted)', soft: 'var(--surface-2)' };
}

/** Поставить цвет заказа на элемент (CSS-переменные; inline-стиль объектом для них не работает). */
export function paintOrder(el, id) {
  const c = orderColor(id);
  el.style.setProperty('--oc', c.oc);
  el.style.setProperty('--oc-soft', c.soft);
  el.dataset.oc = String(c.n);
  return el;
}
