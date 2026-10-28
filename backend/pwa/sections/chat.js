import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { toastError } from '../ui/toast.js';
import { noticeTime } from '../ui/notice-card.js';

/**
 * Правая панель «Переписка» (`?of=chat&open=<userId>`): лента (старые сверху), поле внизу.
 * Enter — отправить, Shift+Enter — новая строка. При открытии входящие помечаются прочитанными;
 * пока панель открыта — обновление раз в 15 с. Сервер: /messages/*.
 */
const EVERY = 15000;
export const BELL_REFRESH = 'dc-bell-refresh';

function view(r) {
  const feed = h('div', { class: 'chat-feed', role: 'log', 'aria-live': 'polite' });
  const text = h('textarea', { class: 'chat-input', rows: 2, maxlength: 2000, placeholder: 'Сообщение…  Enter — отправить, Shift+Enter — новая строка', 'aria-label': 'Сообщение' });
  const send = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => submit() }, 'Отправить');
  const host = h('div', { class: 'chat' }, feed, h('div', { class: 'chat-form' }, text, send));
  let timer = 0, sig = ''; // timer живёт, пока host в странице (tick сам останавливается)

  const paint = (items) => {
    const list = [...items].reverse(); // сервер отдаёт свежие сверху
    const s = list.map((m) => m.id + (m.readAt ? 'r' : '')).join(',');
    if (s === sig) return;
    sig = s;
    const stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60 || !feed.childElementCount;
    feed.replaceChildren(...(list.length
      ? list.map((m) => h('div', { class: 'chat-msg' + (m.mine ? ' mine' : '') },
        h('div', { class: 'chat-text' }, m.text), h('div', { class: 'chat-time' }, noticeTime(m.createdAt) + (m.mine && m.readAt ? ' · прочитано' : ''))))
      : [h('div', { class: 'chat-empty' }, 'Сообщений пока нет. Напишите первым — собеседник увидит его в колокольчике.')]));
    if (stick) feed.scrollTop = feed.scrollHeight;
  };
  const load = async () => {
    if (!host.isConnected) return;
    try {
      const res = await api(`/messages/with/${r.id}?limit=100`);
      paint(res.items || []);
      if ((res.items || []).some((m) => !m.mine && !m.readAt)) {
        await api(`/messages/with/${r.id}/read`, { method: 'POST' });
        document.dispatchEvent(new Event(BELL_REFRESH));
      }
    } catch { /* фон: молча, следующий опрос повторит */ }
  };
  const tick = () => { if (!host.isConnected) return; if (document.visibilityState === 'visible') load(); timer = setTimeout(tick, EVERY); };
  async function submit() {
    const v = text.value.trim();
    if (!v || send.disabled) return;
    send.disabled = true; send.classList.add('is-busy');
    try {
      await api('/messages', { method: 'POST', body: { toUserId: r.id, text: v } });
      text.value = ''; sig = ''; await load();
    } catch (e) { toastError(e, 'отправить сообщение'); }
    send.disabled = false; send.classList.remove('is-busy'); text.focus();
  }
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
  // Запускаем, когда панель встанет в страницу
  timer = setTimeout(tick, 300);
  return host;
}

export const chat = {
  id: 'chat',
  title: 'Переписка',
  get: async (id) => {
    const res = await api('/messages/users');
    const u = (res.items || []).find((x) => x.id === id);
    return { id, name: u?.name || 'Сотрудник', role: u?.role || '' };
  },
  card: {
    heading: (r) => r.name,
    subheading: (r) => r.role || 'Переписка',
    noHistory: true,
    view: () => [],
    extra: (r) => view(r),
  },
};
