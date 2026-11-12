/** Последние просмотренные карточки: только локальные адреса, отдельный ключ каждого пользователя. */
const word = (v) => typeof v === 'string' && /^[a-z][a-z0-9-]{0,63}$/i.test(v) ? v : '';
const label = (v) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
/** Текстовый ключ допустим только у производственного заказа; он всегда кодируется URLSearchParams. */
const recordId = (v, of) => typeof v === 'string' && (/^[a-f0-9]{24}$/i.test(v) ||
  (of === 'salesorders' && v.trim() && v.length <= 160 && !/[\u0000-\u001f\u007f\\]/.test(v) && !v.includes('://'))) ? v : '';
/** Только локальный файл изображения, без query, внешнего адреса и обхода каталога uploads. */
export function recentThumb(value) {
  if (typeof value !== 'string' || value.length > 1024) return '';
  let path; try { path = decodeURIComponent(value); } catch { return ''; }
  if (!/^\/(?:db\/)?uploads\/[\p{L}\p{N}_ .()/-]+\.(?:jpe?g|png|webp|gif|avif)$/iu.test(path) || path.split('/').some((s) => s === '.' || s === '..')) return '';
  return encodeURI(path);
}
export function recentEntry(v) {
  if (!v || !word(v.section) || !word(v.of) || !recordId(v.id, v.of)) return null;
  const title = label(v.title);
  if (!title) return null;
  return { section: word(v.section), of: word(v.of), id: v.id, title, kind: label(v.kind), ...(recentThumb(v.thumb) ? { thumb: recentThumb(v.thumb) } : {}),
    ...(word(v.tab) ? { tab: word(v.tab) } : {}), ...(word(v.d) ? { d: word(v.d) } : {}) };
}
const same = (a, b) => a.of === b.of && a.id === b.id && a.d === b.d;
export function recentHref(entry) {
  const e = recentEntry(entry);
  if (!e) return '';
  const p = new URLSearchParams({ open: e.id, of: e.of });
  if (e.tab) p.set('tab', e.tab);
  if (e.d) p.set('d', e.d);
  return '#' + e.section + '?' + p;
}
export function createRecentCards(storage, key) {
  const read = () => {
    try {
      const data = JSON.parse(storage.getItem(key) || '[]');
      if (!Array.isArray(data)) return [];
      const out = [];
      for (const raw of data.slice(0, 100)) { const e = recentEntry(raw); if (e && !out.some((x) => same(e, x))) out.push(e); }
      return out.slice(0, 20);
    } catch { return []; }
  };
  return {
    list: (allowed = () => true) => read().filter((e) => allowed(e.section) && allowed(e.of)),
    remember(value) {
      const e = recentEntry(value);
      if (!e) return;
      try { storage.setItem(key, JSON.stringify([e, ...read().filter((x) => !same(x, e))].slice(0, 20))); } catch { /* приватный режим */ }
    },
    clear() { try { storage.removeItem(key); } catch { /* приватный режим */ } },
  };
}
