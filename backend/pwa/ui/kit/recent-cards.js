import { PREFIX } from '../../core/api.js';
import { recentStore as store, recentUserKey as userKey } from '../../core/recent-session.js';
import { current } from '../../core/router.js';
import { h } from '../../core/dom.js';
import { recentHref, recentThumb, recentOrderNumber } from '../../core/recent-cards.js';
import { icon } from '../icons.js';
import { openPopMenu, closePopMenu, isOpenFor } from './pop-menu.js';

const list = (value) => Array.isArray(value) ? value : [];
/** Запоминаем только успешно загруженную карточку текущего пользователя и текущего адреса. */
export function recentRecorder(of) {
  const owner = userKey();
  return (row, title, kind) => {
    if (!owner || owner !== userKey()) return;
    const { section, params } = current();
    const ids = of === 'salesorders' ? [row?.id, row?._id, row?.key, row?.productionNo, ...list(row?.orders).map((o) => o.id || o._id)] : [row?.id || row?._id];
    const open = String(params.open || '');
    if (!open || params.new || !ids.some((x) => x != null && String(x) === open) || (params.of || section) !== of) return;
    const id = of === 'salesorders' ? String(row.key || row.productionNo || row.id || open) : open;
    const customer = of === 'salesorders' ? (Array.isArray(row.customers) ? row.customers.filter((v) => typeof v === 'string').join(', ') : typeof row.customer === 'string' ? row.customer : '') : '';
    const photos = [row.photo, ...list(row.photos), { thumb: row.photoThumb }, ...list(row.lines).map((l) => l.photo), ...list(row.orders).flatMap((o) => list(o.lines).map((l) => l.photo))];
    const thumb = photos.flatMap((p) => [p?.thumb, p?.url]).map(recentThumb).find(Boolean);
    const productionNo = of === 'salesorders' ? row.productionNo || row.key : of === 'orderpass' ? row.productionNo || row.orderNo : undefined;
    store()?.remember({ section, of, id, title: [title, customer].filter(Boolean).join(' · '), kind, thumb, productionNo, tab: params.tab, d: params.d });
    document.dispatchEvent(new Event('dc:recent-cards'));
  };
}
/** Миниатюра — декоративный узел внутри одной ссылки; сбой загрузки возвращает значок сущности. */
function thumbnail(entry) {
  const fallback = () => icon(({ salesorders: 'orders', salesorder: 'orders', orders: 'orders', products: 'stock', stock: 'stock', requests: 'requests', partners: 'partners', dict: 'dicts' })[entry.of] || 'history');
  const box = h('span', { class: 'pm-thumb', 'aria-hidden': 'true' });
  if (entry.of === 'salesorders' || entry.of === 'orderpass') {
    box.append(h('b', { class: 'pm-order-number' }, recentOrderNumber(entry)));
    return box;
  }
  const src = recentThumb(entry.thumb);
  box.append(src ? h('img', { src: src.startsWith('/db/') ? src : PREFIX + src, alt: '', loading: 'lazy', decoding: 'async',
    onerror: () => box.replaceChildren(fallback()) }) : fallback());
  return box;
}
/** Раздел записи → цвет раздела бокового меню (--sec-*): рамка карточки и подпись вида (пользователь 2026-11-13: «каша»). */
const AREA = { products: 'products', offers: 'products', docs: 'products', doctpl: 'products', passports: 'products', passarchive: 'products',
  salesorders: 'orders', salesorder: 'orders', design: 'orders', designtasks: 'orders', work: 'orders', matching: 'orders',
  requests: 'supply', suppliercatalog: 'supply', contracts: 'supply', partners: 'supply',
  stock: 'stock', 'stock-mobile': 'stock', movements: 'stock', orders: 'money', money: 'money', expenses: 'money', payroll: 'money' };
const areaOf = (e) => AREA[e.of] || AREA[e.section] || '';
const kindLabel = (kind) => /[а-яё]/iu.test(kind || '') ? kind : '';
/** Строка записи: вид (цветом раздела) отдельной строкой, название — до двух строк. */
function entryLabel(e) {
  const kind = kindLabel(e.kind);
  const title = (kind && e.title.startsWith(kind) ? e.title.slice(kind.length).replace(/^\s*·?\s*/, '') : e.title) || e.title;
  return h('span', { class: 'pm-rc' }, kind ? h('small', { class: 'pm-rc-kind' }, kind) : null, h('span', { class: 'pm-rc-title', title }, title));
}
/** Тип сущности задаёт отдельную подписанную группу; порядок карточек остаётся по давности. */
const TYPE_LABELS = { salesorders: 'Заказы', salesorder: 'Договоры с заказчиками', products: 'Изделия', passports: 'Паспорта', passarchive: 'Архив паспортов',
  requests: 'Заявки', partners: 'Контрагенты', stock: 'Склад', orders: 'Позиции заказов', offers: 'Коммерческие предложения',
  contracts: 'Договоры', expenses: 'Расходы', money: 'Деньги', work: 'Работы', designtasks: 'Проектирование', docs: 'Документы' };
function recentGroups(entries) {
  const groups = new Map();
  for (const e of entries) {
    const type = e.of === 'orderpass' ? 'passports' : e.of;
    const title = Object.hasOwn(TYPE_LABELS, type) ? TYPE_LABELS[type] : kindLabel(e.kind) || 'Прочие карточки';
    if (!groups.has(title)) groups.set(title, { title, items: [] });
    groups.get(title).items.push({ label: entryLabel(e), lead: thumbnail(e), href: recentHref(e), cls: areaOf(e) ? 'rc-' + areaOf(e) : '' });
  }
  const priority = ['Заказы', 'Изделия', 'Паспорта', 'Архив паспортов'];
  return [...groups.values()].sort((a, b) => {
    const rank = (g) => { const i = priority.indexOf(g.title); return i < 0 ? priority.length : i; };
    return rank(a) - rank(b);
  });
}
/** Эталон pop-menu: на телефоне нижний лист, на широком экране меню у кнопки. */
export function recentCardsButton(allowed) {
  const btn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Недавно открытые карточки',
    'aria-label': 'Недавно открытые карточки', 'aria-haspopup': 'menu', onclick: () => {
      if (isOpenFor(btn)) { closePopMenu(); return; }
      const cache = store();
      const entries = cache?.list(allowed) || [];
      openPopMenu({ anchor: btn, side: 'down', cls: 'pm-recent',
        head: entries.length ? null : h('p', { class: 'hint' }, 'Здесь появятся карточки, которые вы откроете. История хранится только в этом браузере.'),
        groups: [
          ...recentGroups(entries),
          entries.length ? { sep: true, items: [{ label: 'Очистить список', onSelect: () => cache.clear() }] } : null,
        ],
      });
    } }, icon('history'));
  return btn;
}
