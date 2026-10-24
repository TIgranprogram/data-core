/**
 * Индикатор работы — один на приложение (ОШ2.5, DESIGN §4 «Загрузка и сбой»):
 *   busyBlock('склад')        → «Загружаю склад…» в блоке; через 10 с — «Долго…» и «Повторить» (если передан retry);
 *   failBlock(e, retry)       → «Не загрузилось: <причина>» + «Повторить» — фоновая ошибка в месте блока, без всплывашки;
 *   busyBtn(btn, 'Сохраняю…') → кнопка заблокирована, крутилка и подпись; через 10 с — «Долго… Сохраняю…»; вернуть — done().
 * tag/cls — чтобы встать в список (li) или таблицу (td) соседа.
 */
import { h } from '../core/dom.js';
import { errText } from './errors.js';

const LONG_MS = 10000;
const retryBtn = (retry) => h('button', { type: 'button', class: 'btn btn-sm', onclick: retry }, 'Повторить');

export function busyBlock(what = '', { retry, tag = 'div', cls = 'state' } = {}) {
  const text = h('span', null, 'Загружаю' + (what ? ' ' + what : '') + '…');
  const el = h(tag, { class: cls + ' is-loading', role: 'status', 'aria-live': 'polite' }, text);
  setTimeout(() => {
    if (!el.isConnected) return; // уже загрузилось — блок заменён
    text.textContent = 'Долго… сервер ещё отвечает.';
    if (retry) el.append(' ', retryBtn(retry));
  }, LONG_MS);
  return el;
}

export function failBlock(e, retry, { tag = 'div', cls = 'state', text = 'Не загрузилось' } = {}) {
  return h(tag, { class: cls + ' is-failed', role: 'status' },
    h('div', null, `${text}: ${errText(e)}`), retry ? retryBtn(retry) : null);
}

/** text=null — подпись не менять (только крутилка); delay — крутилка, если дольше (мгновенные действия без мигания). */
export function busyBtn(btn, text = 'Сохраняю…', { delay = 0 } = {}) {
  const kids = [...btn.childNodes];
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  const on = () => { btn.classList.add('is-busy'); if (text) btn.textContent = text; };
  const t1 = delay ? setTimeout(on, delay) : (on(), 0);
  const t2 = setTimeout(() => { if (text) btn.textContent = 'Долго… ' + text; }, LONG_MS);
  return function done() {
    clearTimeout(t1); clearTimeout(t2);
    btn.classList.remove('is-busy');
    if (text) btn.replaceChildren(...kids);
    btn.disabled = wasDisabled;
  };
}
