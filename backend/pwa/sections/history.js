import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { busyBlock, failBlock } from '../ui/busy.js';
import { dateTime } from '../core/format.js';
import { go } from '../core/router.js';
import { actionLabel, changeList } from '../ui/history.js';

/*
 * «История» (TASKS И.2) — все изменения в приложении: кто, что, когда; фильтры — кто / раздел / даты.
 * Только директор и администратор (сервер: GET /audit-logs/app). Строка → карточка: «было → стало» и ссылка на саму запись.
 */
const TYPES = [
  { value: 'SupplyRequest', label: 'Заявки', of: 'requests' }, { value: 'Material', label: 'Склад', of: 'stock' },
  { value: 'StockMovement', label: 'Движения', of: 'movements' }, { value: 'SalesOrder', label: 'Заказы', of: 'salesorders' },
  { value: 'Income', label: 'Позиции заказов', of: 'orders' }, { value: 'Partner', label: 'Контрагенты', of: 'partners' },
  { value: 'DictItem', label: 'Справочники', of: null },
];
const T = Object.fromEntries(TYPES.map((t) => [t.value, t]));
const typeLabel = (t) => T[t]?.label || t;
const openRecord = (r) => { const of = T[r.entityType]?.of; if (of && r.entityId) go(of, { open: r.entityId }); };

/** Изменения этой записи журнала — из истории самой записи (там посчитано «было → стало»). */
function changesOf(r) {
  const box = h('div', null, busyBlock('подробности', { tag: 'p', cls: 'muted' }));
  if (!r.entityId) { box.replaceChildren(); return box; }
  api('/audit-logs/record', { query: { entityType: r.entityType, entityId: r.entityId } }).then((res) => {
    const x = res.items.find((i) => i.createdAt === r.createdAt);
    box.replaceChildren(h('div', { class: 'section-title' }, 'Что изменилось'),
      x?.changes?.length ? h('ul', { class: 'timeline' }, h('li', null, changeList(x.changes, {}, x.first))) : h('p', { class: 'muted' }, 'Подробностей по полям нет (действие без изменения полей или запись старше журнала).'));
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
    searchPlaceholder: 'Поиск не нужен — фильтры справа',
    emptyText: 'Изменений за выбранное время нет.',
    filters: [
      { key: 'entityType', label: 'Раздел', type: 'chips', options: async () => TYPES.map(({ value, label }) => ({ value, label })) },
      { key: 'userId', label: 'Кто', type: 'select', options: async () => api('/audit-logs/app/users') },
      { key: 'from', label: 'С даты', short: 'с', type: 'date' },
      { key: 'to', label: 'По дату', short: 'по', type: 'date' },
    ],
    hints: { '': 'Все изменения в приложении: кто, что и когда. Откройте строку — увидите, какие поля как изменились, и саму запись.' },
    groupBy: (r) => new Date(r.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
    rowAction: (r) => (T[r.entityType]?.of && r.entityId ? { label: 'Открыть', title: 'Открыть саму запись', run: (row) => openRecord(row) } : null),
    columns: [
      { key: 'createdAt', label: 'Когда', cls: 'num nowrap', render: (r) => new Date(r.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) },
      { key: 'userName', label: 'Кто', cls: 'nowrap', render: (r) => r.userName || '—' },
      { key: 'entityType', label: 'Раздел', cls: 'nowrap md-hide', render: (r) => typeLabel(r.entityType) },
      { key: 'action', label: 'Что', cls: 'nowrap', render: (r) => actionLabel(r.action) },
      { key: 'title', label: 'Запись', cls: 'clip', render: (r) => h('span', { title: r.title || '' }, r.title || h('span', { class: 'muted' }, '—')) },
    ],
    card: {
      title: (r) => `${actionLabel(r.action)}: ${r.title || typeLabel(r.entityType)}`,
      sub: (r) => [dateTime(r.createdAt), r.userName, typeLabel(r.entityType)].filter(Boolean).join(' · '),
      side: () => [],
    },
  },

  card: {
    heading: (r) => `${actionLabel(r.action)}: ${r.title || typeLabel(r.entityType)}`,
    subheading: (r) => dateTime(r.createdAt),
    view: (r) => [
      ['Кто', r.userName || '—'],
      ['Раздел', typeLabel(r.entityType)],
      ['Запись', T[r.entityType]?.of && r.entityId ? h('a', { href: `#${T[r.entityType].of}?open=${encodeURIComponent(r.entityId)}` }, (r.title || 'открыть') + ' →') : r.title],
    ],
    extra: (r) => changesOf(r),
  },

  searchRow: (r) => ({ title: r.title || typeLabel(r.entityType), sub: actionLabel(r.action), side: '' }),
  open: (id) => go('history', { open: id }),
};
