import { h } from '../core/dom.js';
import { api } from '../core/api.js';
import { icon } from './icons.js';
import { setBadgePart } from './app-badge.js';
import { noticeCard, noticeTime, TONE_LABEL } from './notice-card.js';
import { listNotices, onNotices, markNoticesRead, pruneNotices, removeNotice, clearNotices } from './notices.js';

/**
 * Колокольчик (УВ): вкладки «Важные» и «Система» (сервер /notifications; «Система» дополнена локальными
 * сообщениями браузера). Число на колокольчике — непрочитанные «Важные». Сообщения — отдельная кнопка «Чат» (ui/chat-button.js).
 * Опрос счётчика — раз в 60 с, пока окно видно, и при возврате в окно; панель открыта — список обновляется вместе с ним.
 */
const REFRESH = 'dc-bell-refresh'; // событие: пересчитать число
const TABS = [['important', 'Важные'], ['system', 'Система']];
const asHash = (href) => (String(href).startsWith('#') ? href : '#' + String(href).replace(/^\//, ''));

export function bellButton() {
  const badge = h('span', { class: 'bell-badge', hidden: true });
  const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon bell', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => { e.stopPropagation(); toggle(); } }, icon('bell'), badge);
  const pop = h('div', { class: 'menu bell-pop', role: 'menu', hidden: true });
  const wrap = h('div', { class: 'bell-wrap' }, btn, pop);
  const S = { tab: 'important', unread: { important: 0, system: 0 }, data: { important: null, system: null } };

  const total = () => S.unread.important;
  const paintBadge = () => {
    const n = total();
    setBadgePart('bell', n);
    badge.hidden = !n; badge.textContent = n > 9 ? '9+' : String(n);
    btn.classList.toggle('has-new', n > 0);
    btn.title = n ? `Важное: ${n}` : 'Уведомлений нет';
    btn.setAttribute('aria-label', btn.title);
  };
  const counts = async () => {
    try {
      const u = await api('/notifications/unread');
      S.unread = { important: Number(u?.important) || 0, system: Number(u?.system) || 0 };
    } catch { /* нет связи — оставляем прежние числа */ }
    paintBadge();
    if (!pop.hidden) paint();
  };
  const loadTab = async (tab = S.tab) => {
    try {
      const r = await api(`/notifications?kind=${tab}&limit=50`);
      S.data[tab] = r.items || [];
      if (r.unread) S.unread = { important: Number(r.unread.important) || 0, system: Number(r.unread.system) || 0 };
    } catch { /* оставляем прежний список */ }
    paintBadge(); if (!pop.hidden) paint();
  };

  const openItem = (x) => {
    close();
    if (!x.read) api(`/notifications/${x.id}/read`, { method: 'POST' }).then(counts).catch(() => {});
    x.read = true;
    const href = x.href || (x.type === 'zone_unassigned' ? '#staff?tab=zones' : '');
    if (href) location.hash = asHash(href);
  };
  const serverItem = (x) => h('div', { class: 'bell-item' + (x.read ? '' : ' is-new') + ((x.href || x.type === 'zone_unassigned') ? ' is-link' : ''), onclick: () => openItem(x) },
    noticeCard({ tone: 'info', title: x.text, sub: x.sub, time: noticeTime(x.createdAt), role: 'menuitem' }));
  const localItem = (x) => h('div', { class: 'bell-item' + (x.read ? '' : ' is-new') },
    noticeCard({
      tone: x.tone, title: x.text, sub: x.sub, time: noticeTime(x.at) + (x.tone === 'success' ? ' · ' + TONE_LABEL.success : ''), role: 'menuitem',
      actions: x.action ? [{ label: x.action.label, run: () => { close(); x.action.run(); } }] : null,
      onClose: () => removeNotice(x.id),
    }));

  const readAll = async () => {
    try { await api(`/notifications/read-all?kind=${S.tab}`, { method: 'POST' }); } catch { /* ниже обновим */ }
    if (S.tab === 'system') markNoticesRead();
    for (const x of S.data[S.tab] || []) x.read = true;
    await counts();
  };

  function body() {
    const srv = S.data[S.tab];
    const loc = S.tab === 'system' ? listNotices() : [];
    const head = h('div', { class: 'bell-head' }, h('b', null, S.tab === 'important' ? 'Важные' : 'Система'),
      h('span', null,
        (S.unread[S.tab] || (S.tab === 'system' && loc.some((x) => !x.read))) ? h('button', { type: 'button', class: 'bell-clear', onclick: (e) => { e.stopPropagation(); readAll(); } }, 'Прочитать все') : null,
        loc.length ? h('button', { type: 'button', class: 'bell-clear', onclick: (e) => { e.stopPropagation(); clearNotices(); } }, 'Очистить') : null));
    const rows = [...loc.map(localItem), ...(srv || []).map(serverItem)];
    return [head, ...(srv === null && !loc.length ? [h('div', { class: 'bell-empty' }, 'Загружаем…')]
      : rows.length ? rows
        : [h('div', { class: 'bell-empty' }, S.tab === 'important' ? 'Важных уведомлений нет. Сюда приходит то, что требует вашего внимания.' : 'Системных сообщений нет.')])];
  }
  function paint() {
    const tabs = h('div', { class: 'bell-tabs', role: 'tablist' }, ...TABS.map(([k, label]) => {
      const n = k === 'important' ? S.unread.important : 0;
      return h('button', { type: 'button', role: 'tab', 'aria-selected': String(S.tab === k), class: 'bell-tab' + (S.tab === k ? ' on' : ''),
        onclick: (e) => { e.stopPropagation(); S.tab = k; paint(); loadTab(k); } }, label, n ? h('span', { class: 'bell-badge static' }, n > 9 ? '9+' : String(n)) : null);
    }));
    pop.replaceChildren(tabs, ...body());
  }

  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const toggle = () => {
    pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden));
    if (pop.hidden) return;
    pruneNotices(); paint(); loadTab();
  };
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { close(); btn.focus(); } });
  onNotices(() => { if (!pop.hidden) paint(); });
  document.addEventListener(REFRESH, counts);
  window.addEventListener('focus', counts);
  setInterval(() => { if (document.visibilityState === 'visible' && wrap.isConnected) counts(); }, 120000);
  paintBadge(); counts();
  return wrap;
}
