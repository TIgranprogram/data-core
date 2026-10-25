import { h } from '../core/dom.js';
import { icon } from './icons.js';
import { noticeCard, noticeTime, TONE_LABEL } from './notice-card.js';

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

/** Кнопка-колокольчик: точка с числом — только когда есть непрочитанное; по нажатию — история по времени. */
export function bellButton() {
  const badge = h('span', { class: 'bell-badge', hidden: true });
  const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon bell', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => { e.stopPropagation(); toggle(); } }, icon('bell'), badge);
  const pop = h('div', { class: 'menu bell-pop', role: 'menu', hidden: true });
  const wrap = h('div', { class: 'bell-wrap' }, btn, pop);
  // непрочитанное: не открывали список после появления; сообщение с действием-функцией (обновление) горит, пока не выполнено
  const unread = () => [...items.values()].filter((x) => !x.read || (x.action && !x.href && !stored(x))).length;
  const render = () => {
    const n = unread(), all = [...items.values()].sort((a, b) => b.at - a.at);
    badge.hidden = !n; badge.textContent = n > 9 ? '9+' : String(n);
    btn.classList.toggle('has-new', n > 0);
    btn.title = n ? `Уведомления: ${n}` : 'Уведомлений нет';
    btn.setAttribute('aria-label', btn.title);
    pop.replaceChildren(...(all.length ? [
      h('div', { class: 'bell-head' }, h('b', null, 'Уведомления'),
        h('button', { type: 'button', class: 'bell-clear', onclick: (e) => { e.stopPropagation(); clearNotices(); } }, 'Очистить')),
      ...all.map((x) => h('div', { class: 'bell-item' + (x.read ? '' : ' is-new') },
        noticeCard({
          tone: x.tone, title: x.text, sub: x.sub, time: noticeTime(x.at) + (x.tone === 'success' ? ' · ' + TONE_LABEL.success : ''), role: 'menuitem',
          actions: x.action ? [{ label: x.action.label, run: () => { close(); x.action.run(); } }] : null,
          onClose: () => removeNotice(x.id),
        })))]
      : [h('div', { class: 'bell-empty' }, 'Уведомлений нет')]));
  };
  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const toggle = () => {
    pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden));
    if (pop.hidden) return;
    prune();
    for (const x of items.values()) x.read = true;
    save(); render(); pop.querySelector('button')?.focus();
  };
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { close(); btn.focus(); } });
  subs.add(() => { if (pop.hidden) render(); else { for (const x of items.values()) x.read = true; render(); } }); render();
  return wrap;
}
