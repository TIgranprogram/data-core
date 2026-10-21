/**
 * Артикул позиции склада (TASKS АР): «артикул» — поставщика (из заявки, таблицы или вписан руками);
 * «внутренний код» — свой: автоартикул `СКЛ-<год>-<№>` (ставится, когда своего артикула нет — поле `article`
 * обязательно в общей схеме) и `sku` по категории (RAS-…, POK-…). Автоартикул не выдаём за артикул поставщика.
 */
export const AUTO_ARTICLE = /^СКЛ-\d{4}-\d+$/;
export const isAutoArticle = (a: unknown) => !String(a ?? '').trim() || AUTO_ARTICLE.test(String(a).trim());

/** Для показа: артикул поставщика (или null) и внутренний код (СКЛ-… и/или sku). */
export function articleView(m: { article?: unknown; sku?: unknown; internalArticle?: unknown }) {
  const a = String(m.article ?? '').trim();
  const auto = isAutoArticle(a);
  const internal = [auto ? a : String(m.internalArticle ?? '').trim(), String(m.sku ?? '').trim()].filter(Boolean);
  return { supplierArticle: auto ? null : a, internalCode: [...new Set(internal)].join(' · ') || null };
}

export type ArticleDecision = 'set' | 'same' | 'conflict' | 'skip' | 'duplicate';

/**
 * Взять артикул из заявки / таблицы в позицию (АР.2):
 *  - пусто / автоартикул → set (СКЛ-… сохраняется как внутренний код);
 *  - уже такой же → same; у позиции свой другой → conflict (не менять молча — в «Требуют заполнения»);
 *  - этот артикул уже у другой позиции → duplicate (артикул уникален в общей схеме) — не менять, показать;
 *  - во входящем пусто или автоартикул → skip.
 */
export function decideArticle(current: unknown, incoming: unknown, takenByOther = false): ArticleDecision {
  const inc = String(incoming ?? '').trim();
  if (!inc || isAutoArticle(inc)) return 'skip';
  const cur = String(current ?? '').trim();
  if (cur.toLowerCase() === inc.toLowerCase()) return 'same';
  if (!isAutoArticle(cur)) return 'conflict';
  return takenByOther ? 'duplicate' : 'set';
}
