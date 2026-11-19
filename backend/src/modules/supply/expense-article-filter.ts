import type { Connection } from 'mongoose';
import { oid } from '../../common/list-query';

/** Фильтр использует действующий справочник; потомки выбираются без Mongo 5+ и без сидов. */
export async function expenseArticleMatch(connection: Connection, value: string): Promise<Record<string, unknown>> {
  if (value === 'none') return { articleId: null };
  const root = oid(value, 'статьи расходов');
  const articles = await connection.db!.collection('expensearticles').find({ deletedAt: null }, { projection: { parentId: 1 } }).toArray();
  const ids = new Set([String(root)]);
  let changed = true;
  while (changed) { changed = false; for (const a of articles) if (a.parentId && ids.has(String(a.parentId)) && !ids.has(String(a._id))) { ids.add(String(a._id)); changed = true; } }
  return { articleId: { $in: articles.filter((a) => ids.has(String(a._id))).map((a) => a._id) } };
}
