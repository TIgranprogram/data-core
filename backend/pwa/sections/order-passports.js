import { session } from '../core/api.js';
import { h } from '../core/dom.js';
import { canWorkPassport as canEdit } from './passports/common.js';
import { orderPassportsButton } from './order-passport-plan.js';

/**
 * ПНЗ.2: в карточке заказа — одна кнопка «Паспорта заказа». Всё остальное (план по позициям, выпуск готовых, печать всех
 * одним PDF) — в правой панели, sections/order-passport-plan.js.
 */
export function orderPassportActions(order) {
  if (!canEdit() || !session.canEdit) return null;
  return h('div', { class: 'actions' }, orderPassportsButton(order.id, 'M'));
}
