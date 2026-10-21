import { api } from './api.js';
import { normSearch } from './facets.js';

/**
 * Сопоставление строк из таблицы с базой (TASKS МВ.2–МВ.3) — общее для заявок, склада и дальше.
 *   matchLines(lines, items, { supplierName }) → [{ line, item|null, by: 'alias'|'article'|'name'|'similar'|null, score, similar: [{ item, score }] }]
 * lines — из core/paste-parse.js ({ article, name, qty, … }); items — [{ label, cat, values: { article, unit, categoryName } }].
 * Порядок: «как называется у поставщика» (сервер, /supply/aliases/match) → артикул → точное название →
 * похожие (доля общих слов, %): ≥ 90% — берём сами, 45–90% — предлагаем на выбор, ниже — новая позиция.
 */
const key = (s) => normSearch(s || '').replace(/\s+/g, '');
const words = (s) => new Set(normSearch(s || '').split(' ').filter((w) => w.length > 1 && !/^(для|из|на|под|с|и|в|мм|шт)$/.test(w)));
export function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let common = 0; for (const w of A) if (B.has(w)) common++;
  return common / Math.min(A.size, B.size) * 0.7 + common / Math.max(A.size, B.size) * 0.3;
}

export async function matchLines(lines, items, { supplierName = '' } = {}) {
  let aliases = [];
  try { aliases = await api('/supply/aliases/match', { method: 'POST', body: { supplierName, lines: lines.map((l) => ({ name: l.name, article: l.article })) } }); } catch { /* без связок — по артикулу и названию */ }
  const byLabel = new Map(items.map((x) => [normSearch(x.label), x]));
  return lines.map((line, i) => {
    const al = aliases[i];
    if (al) {
      const it = byLabel.get(normSearch(al.title)) || { label: al.title, cat: al.categoryName || '', values: { unit: al.unit, article: al.article, categoryName: al.categoryName } };
      return { line, item: it, by: 'alias', score: 1, similar: [] };
    }
    // артикул в своей колонке, иначе — «код» внутри названия (DSR015-6s Такелажная…)
    const codes = [line.article, ...String(line.name || '').split(/\s+/).filter((w) => w.length >= 4 && /\d/.test(w) && /[\p{L}-]/u.test(w) && !/^[мm]\d/i.test(w))].filter(Boolean).map(key);
    for (const a of codes) {
      const it = items.find((x) => key(x.values?.article) === a) || items.find((x) => key(x.label).includes(a));
      if (it) return { line, item: it, by: 'article', score: 1, similar: [] };
    }
    const n = normSearch(line.name);
    const exact = byLabel.get(n);
    if (exact) return { line, item: exact, by: 'name', score: 1, similar: [] };
    const scored = items.map((x) => ({ item: x, score: similarity(line.name, x.label) })).filter((x) => x.score >= 0.45).sort((p, q) => q.score - p.score).slice(0, 3);
    if (scored[0]?.score >= 0.9) return { line, item: scored[0].item, by: 'similar', score: scored[0].score, similar: [] };
    return { line, item: null, by: null, score: 0, similar: scored };
  });
}

/** Запомнить «строка поставщика → наша позиция» после внесения. */
export function rememberPairs(supplierName, pairs) {
  const list = pairs.filter((p) => p.title && (p.extName || p.extArticle));
  if (!list.length) return Promise.resolve();
  return api('/supply/aliases', { method: 'POST', body: { supplierName, pairs: list } }).catch(() => {});
}
