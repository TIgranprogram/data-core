import { h } from '../core/dom.js';
import { actionText, isFailure } from './errors.js';
import { noticeCard, splitReason } from './notice-card.js';
import { addNotice } from './notices.js';

/**
 * Всплывающее сообщение — тот же вид, что строка в колокольчике (DESIGN §4 «Уведомление»).
 * undo — кнопка «Отменить» (CANON §2 «Удаление»), 10 секунд. tone: 'success' | 'error' | 'warn' | 'info'
 * (по умолчанию: error → «ошибка», с actions → «сообщение», иначе «успех»); sub — вторая строка (причина);
 * notice: false — не записывать в историю (по умолчанию пишется всё, кроме «Готовлю…» — текст на «…»).
 */
export function toast(text, { error = false, undo, ms, actions, tone, sub, notice } = {}) {
  let box = document.querySelector('.toasts');
  if (!box) { box = h('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const tn = tone || (error ? 'error' : actions ? 'info' : 'success');
  let title = String(text ?? ''), reason = sub;
  if (!reason && tn === 'error') ({ title, sub: reason } = splitReason(title));
  const close = () => t.remove();
  const acts = [];
  if (undo) acts.push({ label: 'Отменить', run: async () => { close(); await undo(); } });
  // actions — кнопки-предложения (SK-7b: «Посмотреть» / «Не сейчас»), закрывают сообщение
  for (const a of actions || []) acts.push({ label: a.label, run: async () => { close(); await a.run?.(); } });
  const t = noticeCard({ tone: tn, title, sub: reason, actions: acts, cls: 'toast' });
  box.append(t);
  setTimeout(close, ms ?? (actions ? 20000 : undo ? 10000 : tn === 'error' ? 6000 : 3500));
  // история: кроме «Готовлю…» и явного notice:false; отмену (undo) в историю не кладём — её уже нет
  if (notice !== false && !/…\s*$/.test(title)) {
    const first = (actions || [])[0];
    addNotice({ id: `t:${tn}:${title}|${reason || ''}`, text: title, sub: reason, tone: tn, once: 60000,
      ...(first ? { action: { label: first.label, run: first.run || (() => {}) }, persist: true } : {}) });
  }
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
