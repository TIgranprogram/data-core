import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { requests } from './requests.js';
import { orders } from './orders.js';
import { salesorders } from './salesorders.js';
import { stock } from './stock.js';

/** Поиск по всему (PRODUCT §6): номер / название / поставщик → совпадения во всех разделах. */
const SOURCES = [
  { section: requests, title: 'Заявки', path: '/supply/requests' },
  { section: stock, title: 'Склад', path: '/stock/items' },
  { section: salesorders, title: 'Заказы', path: '/salesorders' },
  { section: orders, title: 'Позиции заказов', path: '/incomes' },
];

export function mountSearch(params) {
  const q = (params.q || '').trim();
  const el = h('div', null, h('div', { class: 'page-head' }, h('h1', null, q ? `Поиск: «${q}»` : 'Поиск')));
  if (!q) { el.append(h('div', { class: 'panel state' }, 'Введите номер заявки, название, поставщика или заказ в строке поиска сверху.')); return { el }; }
  const box = h('div', { class: 'results' });
  el.append(box);
  for (const src of SOURCES) {
    const list = h('ul', { class: 'cards', style: { display: 'block' } }, h('li', { class: 'muted' }, 'Ищу…'));
    const more = h('div', { class: 'list-foot' });
    box.append(h('div', { class: 'panel' }, h('h3', null, src.title), list, more));
    api(src.path, { query: { search: q, limit: 10 } }).then((r) => {
      if (!r.items.length) { list.replaceChildren(h('li', { class: 'muted', style: { cursor: 'default' } }, 'Ничего не найдено')); return; }
      list.replaceChildren(...r.items.map((row) => {
        const v = src.section.searchRow(row);
        return h('li', { onclick: () => src.section.open(row.id) }, h('div', { class: 'c-main' }, h('div', { class: 'c-title' }, v.title), h('div', { class: 'c-sub' }, v.sub)), h('div', { class: 'c-side' }, v.side));
      }));
      if (r.total > r.items.length) more.append(h('a', { href: `#${src.section.id}?q=${encodeURIComponent(q)}` }, `Все результаты в разделе «${src.title}» (${r.total}) →`));
    }).catch((e) => list.replaceChildren(h('li', null, 'Не удалось выполнить поиск: ' + e.message)));
  }
  return { el };
}
