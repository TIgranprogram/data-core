import { h } from '../core/dom.js';

/** Ссылка «на заказчика»: открывает его карточку в «Контрагентах» (все его заказы, суммы). Пусто — прочерк не рисуем. */
export const customerLink = (name) => (name
  ? h('a', { href: '#partners?type=customer&open=' + encodeURIComponent('c:' + name), title: 'Открыть заказчика: все его заказы' }, name)
  : '');
