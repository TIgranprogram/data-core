import { h } from '../core/dom.js';

/**
 * Окно чата поверх любого экрана (справа, ~420 px; на узком экране — во весь экран). Экран под ним не меняется.
 * Внутри — тот же чат (sections/chat.js → mountChat). Закрыть: ✕, Esc, повторный клик по кнопке «Чат».
 * Слой выше правой панели ввода (z-index 55 > .drawer 41), ниже модальных окон (60).
 */
let win = null; // { el, inst }
export const CHAT_WINDOW = 'dc-chat-window'; // событие: окно открыто/закрыто (detail = true/false)

export const isChatWindowOpen = () => !!win;

export async function openChatWindow(params = {}) {
  if (win) { win.inst.update(params); return; }
  const { mountChat } = await import('../sections/chat.js');
  if (win) { win.inst.update(params); return; }
  const body = h('div', { class: 'chat-win-body' });
  const el = h('aside', { class: 'chat-win', role: 'dialog', 'aria-label': 'Чат' },
    h('button', { type: 'button', class: 'btn btn-ghost btn-icon chat-win-x', title: 'Закрыть (Esc)', 'aria-label': 'Закрыть чат', onclick: closeChatWindow }, '✕'),
    body);
  document.body.append(el);
  let inst;
  // внутри окна смена собеседника — без адреса страницы
  const nav = { open: (id) => inst.update({ with: id }), list: () => inst.update({ list: '1' }) };
  inst = mountChat(body, { params, nav, single: true });
  win = { el, inst };
  document.addEventListener('keydown', onKey);
  document.dispatchEvent(new CustomEvent(CHAT_WINDOW, { detail: true }));
}

export function closeChatWindow() {
  if (!win) return;
  win.inst.destroy(); win.el.remove(); win = null;
  document.removeEventListener('keydown', onKey);
  document.dispatchEvent(new CustomEvent(CHAT_WINDOW, { detail: false }));
}

function onKey(e) { if (e.key === 'Escape' && !e.defaultPrevented) closeChatWindow(); }

export function toggleChatWindow() { return win ? closeChatWindow() : openChatWindow({}); }
