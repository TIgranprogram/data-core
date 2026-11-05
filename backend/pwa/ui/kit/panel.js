import { mark } from './mark.js';
import { h } from '../../core/dom.js';

/**
 * panel — эталон содержимого правой панели (оболочку-«ящик» открывает openCard, ui/card.js; ввод — sideForm).
 *   panel({ title, sub?, kind?, blocks: [{ title?, body }], footer: [кнопки], onClose? }) → { el, head, body, foot }
 * Шапка L (тип записи над заголовком, заголовок, подзаголовок, ✕), блоки полей, подвал с кнопками — те же классы, что у openCard.
 */
export function panel({ title, sub, kind, blocks = [], footer = [], onClose } = {}) {
  const head = h('div', { class: 'drawer-head' },
    h('div', { class: 't' }, kind ? h('div', { class: 'drawer-kind' }, kind) : null, h('h2', null, title), sub ? h('div', { class: 'muted small' }, sub) : null),
    onClose ? h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Закрыть панель', 'aria-label': 'Закрыть', onclick: onClose }, '✕') : null);
  const body = h('div', { class: 'drawer-body' }, ...blocks.map((b) => h('section', { class: 'form-block', 'data-tone': 'main' }, b.title ? h('div', { class: 'form-sec-t' }, b.title) : null, b.body)));
  const foot = h('div', { class: 'drawer-foot' }, ...[].concat(footer).filter(Boolean));
  const el = mark(h('aside', { class: 'drawer docked k-panel', role: 'region', 'aria-label': title }, head, body, foot), 'panel');
  return { el, head, body, foot };
}
