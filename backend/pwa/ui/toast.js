import { h } from '../core/dom.js';

/** Всплывающее сообщение. undo — кнопка «Отменить» (CANON §2 «Удаление»), 10 секунд. */
export function toast(text, { error = false, undo, ms } = {}) {
  let box = document.querySelector('.toasts');
  if (!box) { box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast' + (error ? ' error' : '') }, h('span', null, text));
  const close = () => t.remove();
  if (undo) {
    t.append(h('button', { type: 'button', onclick: async () => { close(); await undo(); } }, 'Отменить'));
  }
  box.append(t);
  setTimeout(close, ms ?? (undo ? 10000 : error ? 6000 : 3500));
  return close; // долгое действие: toast('Готовлю…', { ms: … }) — закрыть, когда готово
}

export const toastError = (e) => toast(e?.message || String(e), { error: true });
