import { h } from '../core/dom.js';
import { actionText, isFailure } from './errors.js';

/** Всплывающее сообщение. undo — кнопка «Отменить» (CANON §2 «Удаление»), 10 секунд. */
export function toast(text, { error = false, undo, ms, actions } = {}) {
  let box = document.querySelector('.toasts');
  if (!box) { box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast' + (error ? ' error' : '') }, h('span', null, text));
  const close = () => t.remove();
  if (undo) {
    t.append(h('button', { type: 'button', onclick: async () => { close(); await undo(); } }, 'Отменить'));
  }
  // actions — кнопки-предложения (SK-7b: «Посмотреть» / «Не сейчас»), закрывают сообщение
  for (const a of actions || []) t.append(h('button', { type: 'button', onclick: async () => { close(); await a.run?.(); } }, a.label));
  box.append(t);
  setTimeout(close, ms ?? (actions ? 20000 : undo ? 10000 : error ? 6000 : 3500));
  return close; // долгое действие: toast('Готовлю…', { ms: … }) — закрыть, когда готово
}

// ОШ: текст — по-русски (внутренние ошибки — общим текстом); action — «Не удалось <действие>: …» (ОШ2.4).
// Одинаковые подряд: сбой (сеть, 5xx, код) — один раз в 30 с; ответ сервера («Укажите…») — в 4 с, чтобы повторное нажатие не было «тишиной».
const lastShown = new Map();
export const toastError = (e, action) => {
  const t = actionText(typeof action === 'string' ? action : '', e);
  const gap = isFailure(e) ? 30000 : 4000;
  if (Date.now() - (lastShown.get(t) || 0) < gap) return;
  lastShown.set(t, Date.now());
  toast(t, { error: true });
};
