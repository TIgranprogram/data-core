import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { busyBlock, failBlock } from '../ui/kit/busy.js';
import { dateTime } from '../core/format.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { table } from '../ui/kit/index.js';
import { withConfirm } from '../ui/confirm-password.js';
import { requests } from './requests.js';
import { orders } from './orders.js';
import { salesorder as salesorders } from './salesorders.js';
import { stock } from './stock.js';
import { partners } from './partners.js';
import { products } from './products.js';
import { passports } from './passports.js';
import { offers } from './offers.js';
import { design } from './design.js';
import { work } from './work.js';


/** Корзина (CANON §2 «Удаление»): всё удалённое, «Восстановить». */
const SOURCES = [
  { id: 'requests', section: requests, title: 'Заявки', path: '/supply/requests' },
  { id: 'stock', section: stock, title: 'Позиции склада', path: '/stock/items' },
  { id: 'salesorders', section: salesorders, title: 'Заказы', path: '/salesorders' },
  { id: 'orders', section: orders, title: 'Позиции заказов', path: '/incomes' },
  { id: 'partners', section: partners, title: 'Контрагенты', path: '/partners' },
  { id: 'products', section: products, title: 'Изделия', path: '/showcase' },
  { id: 'passports', section: passports, title: 'Паспорта', path: '/passports' },
  { id: 'offers', section: offers, title: 'Коммерческие предложения', path: '/offers' },
  { id: 'design', section: design, title: 'Задачи проектирования', path: '/design-tasks' },
  { id: 'work', section: work, title: 'Задания в работе', path: '/work-tasks' },
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
    const holder = h('div', null, busyBlock('', { cls: 'muted' }));
    const panel = h('div', { class: 'panel' }, h('h3', null, src.title), holder);
    api(src.path, { query: { deleted: 1, sort: '-deletedAt', limit: 100 } }).then((r) => {
      holder.replaceChildren(table({ columns: [{ label: 'Запись' }, { label: 'Удалено', num: true }, { label: '' }], empty: { title: 'Корзина пуста', hint: 'Удалённое хранится здесь, его можно вернуть.' }, rows: r.items.map((row) => {
        const v = src.section.searchRow(row);
        const btn = session.canEdit ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { const go = () => src.section.remove.restore(row); if (src.section.remove.password) { if ((await withConfirm(go, { text: 'Восстановление требует вашего пароля.' })) === null) { e.target.disabled = false; return; } } else await go(); toast('Восстановлено'); load(); } catch (ex) { toastError(ex); e.target.disabled = false; }
        } }, 'Восстановить') : null;
        return { cells: [h('div', null, h('div', null, v.title), h('div', { class: 'muted small' }, v.sub)), dateTime(row.deletedAt), { v: btn, cls: 'right' }] };
      }) }));
    }).catch((e) => holder.replaceChildren(failBlock(e, load)));
    return panel;
  }

  load();
  return { el };
}
