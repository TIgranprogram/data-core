/** ПРЖ-4: похожесть названия позиции заказа на изделие (слова, без порядка). */
const words = (v: unknown) => new Set(String(v ?? '').toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter((w) => w.length > 1));

/** 0..1: доля общих слов от меньшего набора; полное вхождение строки — 1. */
export function nameSimilarity(a: unknown, b: unknown): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / Math.min(x.size, y.size);
}

type Cand = { id: string; name?: string | null; fullName?: string | null; orderName?: string | null; sku?: string | null };

/** Лучшие изделия для названия позиции: порог 0.5, не больше `limit`, по убыванию. */
export function suggestProducts(title: string, prods: Cand[], limit = 3) {
  return prods
    .map((p) => ({ p, score: Math.max(...[p.name, p.fullName, p.orderName, p.sku].map((n) => nameSimilarity(title, n))) }))
    .filter((r) => r.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => ({ productId: r.p.id, sku: r.p.sku ?? null, name: r.p.name || r.p.fullName || r.p.orderName || r.p.sku || '', score: Math.round(r.score * 100) / 100 }));
}
