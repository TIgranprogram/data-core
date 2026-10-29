import { h } from '../core/dom.js';
import { api } from '../core/api.js';
import { go } from '../core/router.js';
import { icon } from './icons.js';

/**
 * Кнопка «Чат» в шапке рядом с колокольчиком: число = непрочитанные сообщения (личные + «Всем»).
 * Клик — страница #chat (откроется последний собеседник). Опрос — раз в 2 мин, пока окно видно, при возврате в окно
 * и по событию CHAT_REFRESH (чат отметил прочитанным или отправил сообщение).
 */
export const CHAT_REFRESH = 'dc-chat-refresh';

export function chatButton() {
  const badge = h('span', { class: 'bell-badge', hidden: true });
  const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon bell', title: 'Сообщения', 'aria-label': 'Сообщения', onclick: () => go('chat', {}) }, icon('chat'), badge);
  const paint = (n) => {
    badge.hidden = !n; badge.textContent = n > 9 ? '9+' : String(n);
    btn.classList.toggle('has-new', n > 0);
    btn.title = n ? `Непрочитанных сообщений: ${n}` : 'Сообщения';
    btn.setAttribute('aria-label', btn.title);
  };
  const counts = async () => {
    try { const t = await api('/messages/threads'); paint(Number(t?.unread) || 0); } catch { /* нет связи — оставляем прежнее число */ }
  };
  document.addEventListener(CHAT_REFRESH, counts);
  window.addEventListener('focus', counts);
  setInterval(() => { if (document.visibilityState === 'visible' && btn.isConnected) counts(); }, 120000);
  counts();
  return btn;
}
