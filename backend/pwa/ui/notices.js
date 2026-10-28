
/**
 * Уведомления — колокольчик в верхней строке и история (2026-10-25: один вид со всплывашками, `notice-card.js`).
 * Сообщение: { id, text, sub?, tone?: 'success'|'error'|'warn'|'info', action?: { label, run }, href?, label?, keep?, once? }.
 * Одинаковый id заменяет прежнее; `once: мс` — если такой id уже был недавно, не добавлять (без лавины одинаковых).
 */
// Хранение: в браузере (localStorage) — всё, кроме сообщений с действием-функцией (новая версия: проверка добавит снова).
// Со ссылкой (`href`) или `keep: true` — пока не убрали; остальное (в т. ч. «успех») — сутки. Не больше 100 записей.
// Задачи и сообщения сотрудникам будут храниться на сервере (тот же вид).
const KEY = 'dc-notices';
const DAY = 24 * 3600 * 1000;
const MAX = 100;
const items = new Map();
const subs = new Set();
const hrefAction = (x) => ({ label: x.label || 'Открыть', run: () => { location.hash = x.href; } });
const stored = (x) => x.href || !x.action || x.persist;
const save = () => {
  try {
    const list = [...items.values()].filter(stored).sort((a, b) => b.at - a.at).slice(0, MAX)
      .map(({ id, text, sub, tone, href, label, keep, at, read }) => ({ id, text, sub, tone, href, label, keep, at, read }));
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* без хранилища — только в памяти */ }
};
const notify = () => { save(); subs.forEach((fn) => fn()); };
try {
  for (const x of JSON.parse(localStorage.getItem(KEY) || '[]')) {
    if (x?.id && (x.keep || x.href || Date.now() - (x.at || 0) < DAY)) items.set(x.id, { ...x, tone: x.tone || 'info', ...(x.href ? { action: hrefAction(x) } : {}) });
  }
} catch { /* пусто */ }

export function addNotice(n) {
  const old = items.get(n.id);
  if (n.once && old && Date.now() - old.at < n.once) return;
  const x = { at: Date.now(), tone: 'info', ...n };
  if (x.href && !x.action) x.action = hrefAction(x);
  items.set(x.id, x); notify();
}
export function removeNotice(id) { if (items.delete(id)) notify(); }
export function clearNotices() { if (items.size) { items.clear(); notify(); } }
/** Выбросить устаревшие (сутки) — при открытии списка. */
const prune = () => { for (const [id, x] of items) if (!x.keep && !x.href && Date.now() - x.at >= DAY) items.delete(id); };

/** Для колокольчика (ui/bell.js): список, подписка, «прочитано», проверка «горит». */
export const listNotices = () => [...items.values()].sort((a, b) => b.at - a.at);
export const onNotices = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export function markNoticesRead() { let c = false; for (const x of items.values()) if (!x.read) { x.read = true; c = true; } if (c) notify(); }
export const pruneNotices = prune;
