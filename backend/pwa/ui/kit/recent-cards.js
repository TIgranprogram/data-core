import { session, PREFIX } from '../../core/api.js';
import { current } from '../../core/router.js';
import { h } from '../../core/dom.js';
import { createRecentCards, recentHref } from '../../core/recent-cards.js';
import { icon } from '../icons.js';
import { openPopMenu, closePopMenu, isOpenFor } from './pop-menu.js';

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
    const id = String(row?.id || row?._id || '');
    if (params.new || params.open !== id || (params.of || section) !== of) return;
    store()?.remember({ section, of, id, title, kind, tab: params.tab, d: params.d });
  };
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
          { title: 'Недавно открытые', items: entries.map((e) => ({ label: [e.kind, e.title].filter(Boolean).join(' · '), href: recentHref(e) })) },
          entries.length ? { sep: true, items: [{ label: 'Очистить список', onSelect: () => cache.clear() }] } : null,
        ],
      });
    } }, icon('history'));
  return btn;
}
