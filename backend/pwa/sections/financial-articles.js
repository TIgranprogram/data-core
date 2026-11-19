import { api } from '../core/api.js';
export { flattenArticles, articleChoices, articleParentChoices, categoryArticleCandidates, selectableArticle } from './financial-articles-state.js';
const cache = new Map();
export function loadFinancialArticles({ type, includeArchived = true, includeUsage = false, refresh = false } = {}) {
  const key = `${type || 'all'}:${includeArchived}:${includeUsage}`; const old = cache.get(key);
  if (!refresh && old && Date.now() - old.at < 60000) return old.promise;
  const promise = api('/financial-articles', { query: { ...(type ? { type } : {}), includeArchived: includeArchived ? 1 : 0, ...(includeUsage ? { includeUsage: 1 } : {}) } });
  cache.set(key, { at: Date.now(), promise }); promise.catch(() => { if (cache.get(key)?.promise === promise) cache.delete(key); }); return promise;
}
export function resetFinancialArticles() { cache.clear(); }
