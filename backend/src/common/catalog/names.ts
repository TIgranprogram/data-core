/** ТИ-8: правила «какое название где» (docs/roles/tz/NAMES.md). */

export type Named = { name?: string | null; fullName?: string | null; orderName?: string | null; sku?: string | null };

const s = (v?: string | null) => (typeof v === 'string' ? v.trim() : '');

/** Н-2: короткое название изделия; пусто — длинное, затем «в заказе», затем артикул. */
export function productShortName(p: Named): string {
  return s(p.name) || s(p.fullName) || s(p.orderName) || s(p.sku);
}

/** «Наше: <sku> · <name>» — вторая строка позиции заказа (без префикса «Наше: » — его добавляет экран). */
export function ourProductLabel(p: Named): string {
  const name = productShortName(p);
  const sku = s(p.sku);
  return sku && name !== sku ? `${sku} · ${name}` : name;
}

/** Н-1: название позиции склада для заявки — «в счёте», если заполнено, иначе короткое. */
export function materialRequestTitle(m: { name?: string | null; invoiceName?: string | null }): string {
  return s(m.invoiceName) || s(m.name);
}
