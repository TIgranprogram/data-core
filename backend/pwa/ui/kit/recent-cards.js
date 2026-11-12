import { session, PREFIX } from '../../core/api.js';
import { current } from '../../core/router.js';
import { h } from '../../core/dom.js';
import { createRecentCards, recentHref, recentThumb } from '../../core/recent-cards.js';
import { icon } from '../icons.js';
import { openPopMenu, closePopMenu, isOpenFor } from './pop-menu.js';

const list = (value) => Array.isArray(value) ? value : [];
const userKey = () => String(session.user?.id || session.user?._id || '');
function store() {
  try { const id = userKey(); return id ? createRecentCards(localStorage, `dc-recent-cards:${PREFIX}:${id}`) : null; }
  catch { return null; }
}
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
    store()?.remember({ section, of, id, title: [title, customer].filter(Boolean).join(' · '), kind, thumb, tab: params.tab, d: params.d });
  };
}
/** Миниатюра — декоративный узел внутри одной ссылки; сбой загрузки возвращает значок сущности. */
function thumbnail(entry) {
  const fallback = () => icon(({ salesorders: 'orders', salesorder: 'orders', orders: 'orders', products: 'stock', stock: 'stock', requests: 'requests', partners: 'partners', dict: 'dicts' })[entry.of] || 'history');
  const box = h('span', { class: 'pm-thumb', 'aria-hidden': 'true' });
  const src = recentThumb(entry.thumb);
  box.append(src ? h('img', { src: src.startsWith('/db/') ? src : PREFIX + src, alt: '', loading: 'lazy', decoding: 'async',
    onerror: () => box.replaceChildren(fallback()) }) : fallback());
  return box;
}
/** Эталон pop-menu: на телефоне нижний лист, на широком экране меню у кнопки. */
export function recentCardsButton(allowed) {
  const btn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Недавно открытые карточки',
    'aria-label': 'Недавно открытые карточки', 'aria-haspopup': 'menu', onclick: () => {
      if (isOpenFor(btn)) { closePopMenu(); return; }
      const cache = store();
      const entries = cache?.list(allowed) || [];
      openPopMenu({ anchor: btn, side: 'down',
        head: entries.length ? null : h('p', { class: 'hint' }, 'Здесь появятся карточки, которые вы откроете. История хранится только в этом браузере.'),
        groups: [
          { title: 'Недавно открытые', items: entries.map((e) => ({ label: e.kind && !e.title.startsWith(e.kind) ? e.kind + ' · ' + e.title : e.title, lead: thumbnail(e), href: recentHref(e) })) },
          entries.length ? { sep: true, items: [{ label: 'Очистить список', onSelect: () => cache.clear() }] } : null,
        ],
      });
    } }, icon('history'));
  return btn;
}
