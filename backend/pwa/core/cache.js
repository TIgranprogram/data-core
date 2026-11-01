/**
 * cachedFetch(key, ttl, fn) — один запрос на ttl мс по ключу: параллельные вызовы делят один promise.
 * Ошибка fn не кэшируется (следующий вызов пробует снова) и пробрасывается; fallback-значение — забота вызывающего (.catch).
 */
const store = new Map();
export function cachedFetch(key, ttl, fn) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at <= ttl) return hit.p;
  const p = Promise.resolve().then(fn);
  const rec = { at: Date.now(), p };
  store.set(key, rec);
  p.catch(() => { if (store.get(key) === rec) store.delete(key); });
  return p;
}
/** Сбросить кэш ключа (или весь, если ключ не задан) — после записи. */
export function dropCache(key) { if (key === undefined) store.clear(); else store.delete(key); }
