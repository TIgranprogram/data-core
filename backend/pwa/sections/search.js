import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { requests } from './requests.js';
import { orders } from './orders.js';
import { salesorders } from './salesorders.js';
import { stock } from './stock.js';
import { passports } from './passports.js';
import { partners } from './partners.js';
import { products } from './products.js';

/** Поиск по всему (PRODUCT §6): номер / название / поставщик → совпадения во всех разделах. Раздел без прав (403) не показывается. */
const SOURCES = [
  { section: requests, title: 'Заявки', path: '/supply/requests' },
  { section: stock, title: 'Склад', path: '/stock/items' },
  { section: salesorders, title: 'Заказы', path: '/salesorders' },
  { section: orders, title: 'Позиции заказов', path: '/incomes' },
  { section: passports, title: 'Паспорта', path: '/passports' },
  { section: partners, title: 'Контрагенты', path: '/partners' },
  { section: products, title: 'Каталог', path: '/showcase' },
];

export function mountSearch(params) {
  const q = (params.q || '').trim();
  const el = h('div', null, h('div', { class: 'page-head' }, h('h1', null, q ? `Поиск: «${q}»` : 'Поиск')));
  if (!q) { el.append(h('div', { class: 'panel state' }, 'Введите номер заявки, название, поставщика или заказ в строке поиска сверху.')); return { el }; }
  const box = h('div', { class: 'results' });
  const none = h('div', { class: 'panel state', hidden: true },
    h('div', null, `По «${q}» ничего не найдено ни в одном разделе.`),
    h('p', { class: 'muted' }, 'Проверьте написание или введите часть слова: «двойн кач» найдёт «Качели двойные»; номер — цифрами.'));
  el.append(none, box);
  let pending = SOURCES.length; let found = 0;
  const done = () => { if (--pending === 0 && !found) { none.hidden = false; box.hidden = true; } };
  for (const src of SOURCES) {
    const list = h('ul', { class: 'cards', style: { display: 'block' } }, h('li', { class: 'muted' }, 'Ищу…'));
    const more = h('div', { class: 'list-foot' });
    const panel = h('div', { class: 'panel' }, h('h3', null, src.title), list, more);
    box.append(panel);
    api(src.path, { query: { search: q, limit: 10 } }).then((r) => {
      // пустой раздел не показываем; если пусто везде — одна строка сверху
      if (!r.items.length) { panel.remove(); return; }
      found++;
      list.replaceChildren(...r.items.map((row) => {
        const v = src.section.searchRow(row);
        return h('li', { onclick: () => src.section.open(row.id) }, h('div', { class: 'c-main' }, h('div', { class: 'c-title' }, v.title), h('div', { class: 'c-sub' }, v.sub)), h('div', { class: 'c-side' }, v.side));
      }));
      if (r.total > r.items.length) more.append(h('a', { href: `#${src.section.id}?q=${encodeURIComponent(q)}` }, `Все результаты в разделе «${src.title}» (${r.total}) →`));
    }).catch((e) => { found += e.status === 403 ? 0 : 1; e.status === 403 ? panel.remove() : list.replaceChildren(h('li', null, 'Не удалось выполнить поиск: ' + e.message)); }).finally(done);
  }
  return { el };
}
