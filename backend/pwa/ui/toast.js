import { h } from '../core/dom.js';
import { errText } from './errors.js';

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

// ОШ: текст — errText (по-русски, внутренние ошибки — общим текстом); одинаковая ошибка подряд (4 с) — один раз
let lastErr = ''; let lastAt = 0;
export const toastError = (e) => {
  const t = errText(e);
  if (t === lastErr && Date.now() - lastAt < 4000) return;
  lastErr = t; lastAt = Date.now();
  toast(t, { error: true });
};
