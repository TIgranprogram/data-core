import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { canFollow } from '../core/route-access.js';
import { busyBlock, failBlock } from '../ui/kit/busy.js';
import { dateTime } from '../core/format.js';
import { go } from '../core/router.js';
import { avatarNode } from '../ui/avatars.js';
import { actionLabel, changeList } from '../ui/history.js';

/*
 * «История» (TASKS И.2) — все изменения в приложении: кто, что, когда; фильтры — кто / раздел / даты.
 * Только директор и администратор (сервер: GET /audit-logs/app). Строка → карточка: «было → стало» и ссылка на саму запись.
 */
const TYPES = [
  { value: 'SupplyRequest', label: 'Заявки', route: 'requests' },
  { value: 'Material', label: 'Склад', route: 'stock' },
  { value: 'StockMovement', label: 'Движения', route: 'movements' },
  { value: 'SalesOrder', label: 'Договоры заказчиков', route: 'salesorders', of: 'salesorder' },
  { value: 'Income', label: 'Позиции заказов', route: 'salesorders', of: 'orders' },
  { value: 'Partner', label: 'Контрагенты', route: 'partners' },
  { value: 'Counterparty', label: 'Контрагенты (архив)' },
  { value: 'Product', label: 'Изделия', route: 'products' },
  { value: 'DesignTask', label: 'Задачи проектирования', route: 'design' },
  { value: 'WorkTask', label: 'Задания в работе', route: 'work' },
  { value: 'CommercialOffer', label: 'Коммерческие предложения', route: 'offers' },
  { value: 'Order', label: 'Заказы (архив)' },
  { value: 'DictItem', label: 'Справочники' },
];
const T = Object.fromEntries(TYPES.map((t) => [t.value, t]));
const typeLabel = (t) => T[t]?.label || t;
const who = (r) => r.actorName || r.userName || '';
const whoNode = (r) => (who(r) ? h('span', { class: 'who-cell' }, r.actorAvatar ? avatarNode({ avatar: r.actorAvatar, displayName: who(r) }, 20) : null, who(r)) : '—');
const actLabel = (r) => r.actionRu || actionLabel(r.action);
const restored = (r) => r.action === 'restore' || String(r.action || '').endsWith('restored');
const recordTitle = (r) => r.title || (recordHref(r) ? 'Открыть запись' : '');

function recordHref(r) {
  const type = T[r.entityType];
  if (!type?.route || !r.entityId) return '';
  const params = new URLSearchParams({ open: r.entityId });
  if (type.of) params.set('of', type.of);
  const href = '#' + type.route + '?' + params;
  return canFollow(session, href) ? href : '';
}

/** Изменения этой записи журнала — из истории самой записи (там посчитано «было → стало»). */
function changesOf(r) {
  const box = h('div', null, busyBlock('подробности', { tag: 'p', cls: 'muted' }));
  if (!r.entityId) { box.replaceChildren(); return box; }
  api('/audit-logs/record', { query: { entityType: r.entityType, entityId: r.entityId } }).then((res) => {
    const x = res.items.find((i) => i.createdAt === r.createdAt);
    const list = changeList(x?.changes, {}, x?.first);
    box.replaceChildren(h('div', { class: 'section-title' }, 'Что изменилось'),
      list ? h('ul', { class: 'timeline' }, h('li', null, list)) : h('p', { class: 'muted' }, 'Подробностей по полям нет (действие без изменения полей или запись старше журнала).'));
  }).catch((e) => box.replaceChildren(failBlock(e, null, { text: 'Подробности недоступны' })));
  return box;
}

export const history = {
  id: 'history',
  title: 'История',
  get: async (id) => {
    const r = await api('/audit-logs/app', { query: { id, limit: 1 } });
    if (!r.items[0]) throw new Error('Запись журнала не найдена');
    return r.items[0];
  },

  list: {
    path: '/audit-logs/app',
    sortDefault: '',
    createLabel: false,
    searchPlaceholder: 'Выберите условия в фильтрах',
    emptyText: 'Изменений за выбранное время нет.', emptyHint: 'Выберите период шире.',
    filters: [
      { key: 'entityType', label: 'Раздел', type: 'chips', options: async () => TYPES.map(({ value, label }) => ({ value, label })) },
      { key: 'userId', label: 'Кто', type: 'select', options: async () => api('/audit-logs/app/users') },
      { key: 'from', label: 'С даты', short: 'с', type: 'date' },
      { key: 'to', label: 'По дату', short: 'по', type: 'date' },
    ],
    hints: { '': 'Все изменения в приложении: кто, что и когда. Откройте строку — увидите, какие поля как изменились, и саму запись.' },
    groupBy: (r) => new Date(r.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
    rowAction: (r) => {
      const href = recordHref(r);
      return href ? { label: 'Открыть', title: 'Открыть саму запись', run: () => { location.hash = href; } } : null;
    },
    columns: [
      { key: 'createdAt', label: 'Когда', cls: 'num nowrap', render: (r) => new Date(r.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) },
      { key: 'userName', label: 'Кто', cls: 'nowrap', render: whoNode },
      { key: 'entityType', label: 'Раздел', cls: 'nowrap md-hide', render: (r) => typeLabel(r.entityType) },
      { key: 'action', label: 'Что', cls: 'nowrap', render: (r) => h('span', null, actLabel(r)) },
      { key: 'title', label: 'Запись', cls: 'clip', render: (r) => h('span', { title: r.title || '' }, recordTitle(r) || h('span', { class: 'muted' }, '—')) },
    ],
    card: {
      title: (r) => `${actLabel(r)}: ${r.title || typeLabel(r.entityType)}`,
      sub: (r) => [dateTime(r.createdAt), who(r), typeLabel(r.entityType)].filter(Boolean).join(' · '),
      side: () => [],
    },
  },

  card: {
    heading: (r) => `${actLabel(r)}: ${r.title || typeLabel(r.entityType)}`,
    subheading: (r) => dateTime(r.createdAt),
    view: (r) => {
      const href = recordHref(r);
      return [
        ['Кто', whoNode(r)],
        ['Раздел', typeLabel(r.entityType)],
        ['Запись', href ? h('a', { href }, recordTitle(r) + ' →') : r.title],
        ...(href && restored(r) && session.canEdit ? [['Действия', 'Чтобы вернуть запись в корзину, откройте её и выберите «Удалить» в меню «⋯», если пункт доступен.']] : []),
      ];
    },
    extra: (r) => changesOf(r),
  },

  searchRow: (r) => ({ title: r.title || typeLabel(r.entityType), sub: actLabel(r), side: '' }),
  open: (id) => go('history', { open: id }),
};
