// Путь заказа. Подробности и адреса разделов берутся из общей карты.
import { h } from '../core/dom.js';
import { guide } from '../ui/kit/index.js';
import { byId, tone } from './atlas-util.js';

const STAGES = [
  { id: 'salesorders', icon: 'partners', name: 'Клиент и заказ',
    input: 'Запрос клиента', result: 'Позиции, договор и срок заказа' },
  { id: 'design', icon: 'table', name: 'Проектирование',
    input: 'Позиция с новым изделием', result: 'Изделие в каталоге и его состав' },
  { id: 'work', icon: 'ops', name: 'Производство',
    input: 'Состав изделия и материалы', result: 'Изготовленные позиции заказа' },
  { id: 'salesorders', stage: 'shipping', icon: 'stock', name: 'Отгрузка',
    input: 'Готовые позиции заказа', result: 'Отгрузка записана в заказе' },
  { id: 'money', icon: 'money', name: 'Деньги',
    input: 'Оплаты клиентов и расходы', result: 'Поступления, выплаты и долги' },
];

const MATERIALS = [
  { id: 'requests', icon: 'requests', name: 'Снабжение',
    input: 'Что нужно купить', result: 'Заявка, счёт и приёмка' },
  { id: 'stock', icon: 'stock', name: 'Склад',
    input: 'Поставки и остатки', result: 'Бронь и выдача в работу' },
];

function flow(stages, open) {
  return guide.route(stages.map(({ id, stage, ...card }) => ({
    ...card, tok: tone(byId.get(id)), data: { atlasNode: id, ...(stage ? { atlasStage: stage } : {}) },
    onClick: (e) => open(id, false, e.currentTarget),
  })));
}

export function atlasOverview(open) {
  return h('div', { class: 'g-route' },
    flow(STAGES, open),
    h('section', { class: 'g-route-branch', 'aria-labelledby': 'atlas-materials-title' },
      h('h2', { id: 'atlas-materials-title' }, 'Материалы для производства'),
      flow(MATERIALS, open)));
}
