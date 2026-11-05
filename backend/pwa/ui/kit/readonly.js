import { mark } from './mark.js';
import { h } from '../../core/dom.js';

/** Компактная карточная группа: сохраняет 0, false и DOM-ссылки, не строит пустые группы. */
export function readonlyGroup({ title, rows = [] } = {}) {
  const shown = rows.filter(Boolean).filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (!shown.length) return null;
  return mark(h('section', { class: 'k-readonly' }, title ? h('h3', null, title) : null,
    h('dl', { class: 'k-readonly-pairs' }, ...shown.flatMap(([label, value]) => [h('dt', null, label), h('dd', null, value === false ? 'Нет' : value === true ? 'Да' : value)]))), 'readonlyGroup');
}
/** Адаптер прежнего card.view: grp-маркеры делят пары, заголовки пустых групп не попадают в DOM. */
export function readonlyGroups(rows = []) {
  const groups = []; let title = ''; let pairs = [];
  const flush = () => { const group = readonlyGroup({ title, rows: pairs }); if (group) groups.push(group); pairs = []; };
  for (const pair of rows.filter(Boolean)) {
    if (pair[0]?.classList?.contains('fields-grp')) { flush(); title = pair[0].textContent; }
    else pairs.push(pair);
  }
  flush();
  return groups.length ? mark(h('div', { class: 'k-readonly-groups' }, ...groups), 'readonlyGroup') : null;
}
