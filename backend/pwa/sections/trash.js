import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { busyBlock, failBlock } from '../ui/busy.js';
import { dateTime } from '../core/format.js';
import { toast, toastError } from '../ui/toast.js';
import { withConfirm } from '../ui/confirm-password.js';
import { requests } from './requests.js';
import { orders } from './orders.js';
import { salesorder as salesorders } from './salesorders.js';
import { stock } from './stock.js';
import { partners } from './partners.js';


/** Корзина (CANON §2 «Удаление»): всё удалённое, «Восстановить». */
const SOURCES = [
  { id: 'requests', section: requests, title: 'Заявки', path: '/supply/requests' },
  { id: 'stock', section: stock, title: 'Позиции склада', path: '/stock/items' },
  { id: 'salesorders', section: salesorders, title: 'Заказы', path: '/salesorders' },
  { id: 'orders', section: orders, title: 'Строки заказов', path: '/incomes' },
  { id: 'partners', section: partners, title: 'Контрагенты', path: '/partners' },
];

export function mountTrash() {
  const el = h('div', null, h('div', { class: 'page-head' }, h('h1', null, 'Корзина'), h('span', { class: 'muted small' }, 'Удалённое можно вернуть. Записи не стираются насовсем.')));
  const box = h('div', { class: 'results' });
  el.append(box);

  async function load() {
    // SK-8d: только разделы, открытые роли
    box.replaceChildren(...SOURCES.filter((s) => session.sees(s.id)).map((s) => block(s)));
  }

  function block(src) {
    const body = h('tbody', null, h('tr', null, busyBlock('', { tag: 'td', cls: 'muted' })));
    const panel = h('div', { class: 'panel' }, h('h3', null, src.title),
      h('div', { class: 'table-wrap', style: { display: 'block' } }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, h('th', null, 'Запись'), h('th', null, 'Удалено'), h('th', null, ''))), body)));
    api(src.path, { query: { deleted: 1, sort: '-deletedAt', limit: 100 } }).then((r) => {
      if (!r.items.length) { body.replaceChildren(h('tr', null, h('td', { class: 'muted', colspan: 3 }, 'Корзина пуста. Удалённое хранится здесь, его можно вернуть.'))); return; }
      body.replaceChildren(...r.items.map((row) => {
        const v = src.section.searchRow(row);
        const btn = session.canEdit ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { const go = () => src.section.remove.restore(row); if (src.section.remove.password) { if ((await withConfirm(go, { text: 'Восстановление требует вашего пароля.' })) === null) { e.target.disabled = false; return; } } else await go(); toast('Восстановлено'); load(); } catch (ex) { toastError(ex); e.target.disabled = false; }
        } }, 'Восстановить') : null;
        return h('tr', { class: 'static' }, h('td', null, h('div', null, v.title), h('div', { class: 'muted small' }, v.sub)),
          h('td', { class: 'num' }, dateTime(row.deletedAt)), h('td', { class: 'right' }, btn));
      }));
    }).catch((e) => body.replaceChildren(h('tr', null, h('td', { colspan: 3 }, failBlock(e, load)))));
    return panel;
  }

  load();
  return { el };
}
