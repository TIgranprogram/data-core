import { searchTokens, normSearch } from '../../common/text/search-norm';
import { shortProductName } from '../showcase/order-product-name';

/**
 * Сопоставление позиций договора (`incomes`) с изделиями (`products`) — чистые правила (КМ2).
 * Состояние позиции: confirmed | none | legacy (есть изделие, статуса нет — старые данные, считаются сопоставленными)
 * | auto (предложено, не подтверждено) | unmatched.
 */
export type LineState = 'confirmed' | 'none' | 'legacy' | 'auto' | 'unmatched';
type Doc = Record<string, unknown>;

export const lineState = (l: Doc): LineState => {
  const st = l.matchStatus;
  if (st === 'none') return 'none';
  if (st === 'confirmed') return l.productId ? 'confirmed' : 'unmatched';
  if (st === 'auto') return 'auto';
  return l.productId ? 'legacy' : 'unmatched';
};
export const isMatched = (l: Doc): boolean => ['confirmed', 'none', 'legacy'].includes(lineState(l));

/** Ключ справочника соответствий: короткое название позиции, нормализованное для поиска. */
export const aliasKey = (title: unknown): string => normSearch(shortProductName(String(title ?? '')));

export type MatchProduct = { id: string; name?: string; sku?: string; orderName?: string; fullName?: string };
export type Suggestion = { productId: string; name: string; sku: string; score: number; percent: number; reason: 'alias' | 'sku' | 'name' | 'similar'; label: string };

const label = (s: number) => (s >= 0.9 ? 'почти наверняка' : s >= 0.6 ? 'похоже' : 'возможно');
const MIN_SCORE = 0.4;

const jaccard = (a: string[], b: string[]): number => {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
};

/**
 * Топ-3 изделия для названия из договора. Высшая уверенность: сохранённое соответствие (алиас), затем артикул в тексте,
 * затем полное равенство с name / orderName / fullName; остальное — пересечение слов (Жаккар) с порогом.
 * Автоподтверждения нет — решает человек.
 */
export function suggest(title: string, products: MatchProduct[], aliasProductId?: string): Suggestion[] {
  const key = aliasKey(title);
  const full = new Set(searchTokens(title));
  const keyTokens = searchTokens(key);
  const out: Suggestion[] = [];
  for (const p of products) {
    const names = [p.name, p.orderName, p.fullName].filter(Boolean).map(String);
    const sku = normSearch(p.sku);
    let score = 0, reason: Suggestion['reason'] = 'similar';
    if (aliasProductId && aliasProductId === p.id) { score = 0.98; reason = 'alias'; }
    else if (sku.length >= 3 && full.has(sku)) { score = 0.95; reason = 'sku'; }
    else if (key && names.some((n) => aliasKey(n) === key)) { score = 0.92; reason = 'name'; }
    else {
      const j = Math.max(0, ...names.map((n) => jaccard(keyTokens, searchTokens(aliasKey(n)))));
      score = Math.min(0.85, j);
    }
    if (score >= MIN_SCORE) out.push({ productId: p.id, name: p.name || p.orderName || p.sku || '', sku: p.sku ?? '', score: Math.round(score * 100) / 100, percent: Math.round(score * 100), reason, label: label(score) });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru')).slice(0, 3);
}

/** «Уверенное» предложение — можно подтвердить пачкой. */
export const isConfident = (s?: Suggestion) => !!s && s.score >= 0.9;

export type OrderMatch = { total: number; matched: number; unmatched: string[] };

/** Сводка по позициям одного договора: сколько всего, сколько сопоставлено, названия несопоставленных. */
export function summarizeLines(lines: Doc[]): OrderMatch {
  const bad = lines.filter((l) => !isMatched(l));
  return { total: lines.length, matched: lines.length - bad.length, unmatched: bad.map((l) => String(l.title ?? '')) };
}

const short = (t: string) => (t.length > 40 ? `${t.slice(0, 40).trim()}…` : t);

/** Текст блока для `assign`: «Договор № X: не сопоставлено N из M позиций («…», …)». */
export function blockText(orderNo: string, m: OrderMatch): string {
  const no = orderNo || 'без номера';
  if (!m.total) return `Договор № ${no}: нет позиций`;
  const names = m.unmatched.slice(0, 5).map((t) => `«${short(t)}»`).join(', ');
  return `Договор № ${no}: не сопоставлено ${m.unmatched.length} из ${m.total} позиций (${names}${m.unmatched.length > 5 ? ', …' : ''})`;
}
