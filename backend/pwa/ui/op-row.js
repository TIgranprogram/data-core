import { PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { money } from '../core/format.js';
import { patch } from '../core/router.js';

/** Миниатюра фото строки (поле thumb с сервера); битая картинка убирается сама. */
export const opThumb = (thumb) => (thumb ? h('img', { class: 'q-thumb', src: PREFIX + thumb, decoding: 'async', onerror: (e) => e.target.remove(), alt: '', loading: 'lazy' }) : null);

/** Строка операции денег (календарь, прогноз): миниатюра, название, подпись, сумма. Клик — карточка справа. */
export function opRow(o) {
  return h('li', { class: 'q-row' + (o.thumb ? ' has-pic' : '') + (o.beforeStart ? ' dim' : ''), tabindex: '0', onclick: () => patch({ of: o.type === 'income' ? 'orders' : 'requests', open: o.id }) },
    opThumb(o.thumb),
    h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, o.title), h('div', { class: 'q-sub' }, [o.type === 'income' ? 'поступление' : 'выплата', o.method, o.company, o.doc, o.counterparty, o.category, o.beforeStart ? 'до старта учёта' : ''].filter(Boolean).join(' · '))),
    h('div', { class: 'q-side' }, h('span', { class: 'num ' + (o.type === 'income' ? 'pos' : 'neg') }, (o.type === 'income' ? '+' : '−') + money(o.amount))));
}
