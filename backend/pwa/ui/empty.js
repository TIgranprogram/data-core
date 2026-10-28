import { h } from '../core/dom.js';

/** Пустое состояние: заголовок + одна строка подсказки «что заполнить и где» (+ обычная ссылка).
 *  emptyState({ title, hint?, action?: { label, href } }) → .state */
export function emptyState({ title, hint, action }) {
  return h('div', { class: 'state' },
    h('div', null, title),
    hint || action ? h('p', { class: 'state-hint' }, hint || '', hint && action ? ' ' : '', action ? h('a', { href: action.href }, action.label) : null) : null);
}
