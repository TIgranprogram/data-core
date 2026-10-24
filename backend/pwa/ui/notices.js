import { h } from '../core/dom.js';
import { icon } from './icons.js';

/**
 * Уведомления — колокольчик в верхней строке (замечание пользователя 2026-10-24: «Обновить приложение» всегда
 * выглядит как просьба обновить; нужен значок, который загорается, когда есть что-то новое).
 * Сейчас — системные сообщения (новая версия приложения); дальше сюда же — задачи и сообщения сотрудникам.
 * Сообщение: { id, text, sub?, action?: { label, run } }. Одинаковый id заменяет прежнее.
 */
// Хранение (2026-10-24): уведомление со ссылкой (`href`) живёт в браузере, пока его не убрали; обычное — сутки,
// `keep: true` — без срока. Системные с действием-функцией (новая версия) не хранятся — их снова добавит проверка.
// Задачи и сообщения сотрудникам будут храниться на сервере (тот же вид).
const KEY = 'dc-notices';
const DAY = 24 * 3600 * 1000;
const items = new Map();
const subs = new Set();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...items.values()].filter((x) => x.href).map(({ id, text, sub, href, label, keep, at }) => ({ id, text, sub, href, label, keep, at })))); } catch { /* без хранилища — только в памяти */ } };
const notify = () => { save(); subs.forEach((fn) => fn()); };
try {
  for (const x of JSON.parse(localStorage.getItem(KEY) || '[]')) {
    if (x?.id && (x.keep || Date.now() - (x.at || 0) < DAY)) items.set(x.id, { ...x, action: { label: x.label || 'Открыть', run: () => { location.hash = x.href; } } });
  }
} catch { /* пусто */ }

/** { id, text, sub?, action?: { label, run } } или со ссылкой { href, label? } — тогда хранится; keep — без срока. */
export function addNotice(n) {
  const x = { at: Date.now(), ...n };
  if (x.href && !x.action) x.action = { label: x.label || 'Открыть', run: () => { location.hash = x.href; } };
  items.set(x.id, x); notify();
}
export function removeNotice(id) { if (items.delete(id)) notify(); }

/** Кнопка-колокольчик: точка с числом — только когда есть сообщения; по нажатию — список. */
export function bellButton() {
  const badge = h('span', { class: 'bell-badge', hidden: true });
  const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon bell', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => { e.stopPropagation(); toggle(); } }, icon('bell'), badge);
  const pop = h('div', { class: 'menu bell-pop', role: 'menu', hidden: true });
  const wrap = h('div', { class: 'bell-wrap' }, btn, pop);
  const render = () => {
    const n = items.size;
    badge.hidden = !n; badge.textContent = n > 9 ? '9+' : String(n);
    btn.classList.toggle('has-new', n > 0);
    btn.title = n ? `Уведомления: ${n}` : 'Уведомлений нет';
    btn.setAttribute('aria-label', btn.title);
    // одинаковый вид у любого уведомления: нажал — переход / действие; «×» — убрать из стопки
    pop.replaceChildren(...(n ? [...items.values()].map((x) => h('div', { class: 'bell-item' },
      h('button', { type: 'button', class: 'bell-go', role: 'menuitem', title: x.action?.label || '', onclick: () => { close(); x.action?.run(); } },
        h('span', { class: 'bell-text' }, x.text), x.sub ? h('small', null, x.sub) : null, x.action ? h('span', { class: 'bell-act' }, x.action.label + ' →') : null),
      h('button', { type: 'button', class: 'bell-x', 'aria-label': 'Убрать уведомление', title: 'Убрать', onclick: (e) => { e.stopPropagation(); removeNotice(x.id); } }, '×')))
      : [h('div', { class: 'bell-empty' }, 'Новых уведомлений нет')]));
  };
  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const toggle = () => { pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); if (!pop.hidden) pop.querySelector('button')?.focus(); };
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { close(); btn.focus(); } });
  subs.add(render); render();
  return wrap;
}
