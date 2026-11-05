import { mark } from './mark.js';
import { h } from '../../core/dom.js';

/**
 * Пустое состояние — единственная фабрика «Пусто / Ничего не найдено / Нет данных» (ORDER-MASTER-PLAN §2, L7).
 * empty({ title?, hint?, action?: { label, href }, kind?: 'empty'|'notFound'|'noData', query?, onReset?, resetLabel? }) → .state
 *  kind 'empty'    — записей ещё нет: title + одна строка «что заполнить и где» (hint) + обычная ссылка (action);
 *  kind 'notFound' — поиск/фильтр ничего не дал: «По «query» ничего не найдено.» / «Ничего не найдено.» + кнопка «Сбросить» (onReset);
 *  kind 'noData'   — данных за период нет: «Нет данных».
 * Свои тексты — через title; самодельные .xx-empty / .xx-none запрещены.
 */
export function empty({ title, hint, action, kind = 'empty', query, onReset, resetLabel = 'Сбросить' } = {}) {
  const text = title || (kind === 'notFound' ? (query ? `По «${query}» ничего не найдено.` : 'Ничего не найдено.') : kind === 'noData' ? 'Нет данных' : 'Пусто');
  const reset = kind === 'notFound' && onReset ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: onReset }, resetLabel) : null;
  return mark(h('div', { class: 'state' },
    h('div', null, text),
    hint || action ? h('p', { class: 'state-hint' }, hint || '', hint && action ? ' ' : '', action ? h('a', { href: action.href }, action.label) : null) : null,
    reset), 'empty');
}

/** Прежнее имя (list/table/sections импортируют emptyState) — тот же эталон. */
export const emptyState = empty;
