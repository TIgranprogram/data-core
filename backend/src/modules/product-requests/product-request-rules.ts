import { searchTokens } from '../../common/text/search-norm';
import { aliasKey } from '../matching/matching-rules';

/** Ключ названия заявки: «то же изделие» в другом заказе даёт тот же ключ. */
export const requestKey = (title: unknown): string => aliasKey(title);

const jaccard = (a: string[], b: string[]): number => {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
};

export const SIMILAR_MIN = 0.6;

/** Открытые заявки с похожим (но не тем же) названием — подсказка «это то же изделие?». */
export function similarRequests<T extends { titleKey: string }>(key: string, open: T[]): T[] {
  const tokens = searchTokens(key);
  return open.filter((r) => r.titleKey !== key && jaccard(tokens, searchTokens(r.titleKey)) >= SIMILAR_MIN);
}

/** Σ количества позиций (пустое/некорректное количество = 0). */
export const qtySum = (lines: Array<{ qty?: unknown }>): number =>
  Math.round(lines.reduce((s, l) => s + (Number(l.qty) > 0 ? Number(l.qty) : 0), 0) * 1000) / 1000;

/** Фото из позиции, которых ещё нет в заявке (порядок сохраняется). */
export function mergePhotoIds(have: unknown[], add: unknown[]): string[] {
  const seen = new Set(have.map(String));
  return [...have.map(String), ...add.map(String).filter((x) => !seen.has(x) && seen.add(x))];
}
