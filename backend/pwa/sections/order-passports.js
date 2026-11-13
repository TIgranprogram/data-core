import { session } from '../core/api.js';
import { h } from '../core/dom.js';
import { canWorkPassport as canEdit } from './passports/common.js';
import { orderPassportsButton, printOrderButton } from './order-passport-plan.js';

/**
 * ПНЗ.2: в карточке заказа — «Паспорта заказа» (план, выпуск — правая панель, sections/order-passport-plan.js).
 * C111 Ш5: рядом «Печать паспортов…», если есть выпущенные (печать видна и тем, кто паспорта не правит).
 */
export function orderPassportActions(order, items = []) {
  const issued = items.filter((p) => p.status === 'issued' || (!p.status && p.passportNumber && !String(p.passportNumber).startsWith('draft-'))).length;
  const edit = canEdit() && session.canEdit;
  const kids = [issued ? printOrderButton(order.id, { issued, size: 'M' }) : null, edit ? orderPassportsButton(order.id, 'M') : null].filter(Boolean);
  return kids.length ? h('div', { class: 'actions' }, ...kids) : null;
}
