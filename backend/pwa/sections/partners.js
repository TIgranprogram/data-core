import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, money, qty } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { modal } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { STAGE } from './salesorders.js';
import { badge, SUPPLY_STATUS, supplyKey } from '../ui/badges.js';

/**
 * «Контрагенты» (TASKS фаза 4): поставщики (из заявок), заказчики (из заказов), наши компании.
 * Карточка — всё связанное; «Изменить» — реквизиты; «Объединить с…» — убрать дубль написания.
 * Сервер — /api/partners (данные не переносятся: поставщики = organizations, заказчики = текст в заказах).
 */
const KIND = { supplier: 'Поставщик', customer: 'Заказчик', our: 'Наша компания' };
const enc = (id) => encodeURIComponent(id);

async function mergeDialog(r, ctx) {
  const type = r.kind === 'customer' ? 'customer' : 'supplier';
  const all = (await api('/partners', { query: { type } })).items.filter((x) => x.id !== r.id);
  const sel = h('select', null, h('option', { value: '' }, '— выберите —'), ...all.map((x) => h('option', { value: x.id }, x.name)));
  const done = await modal({
    title: 'Объединить «' + r.name + '»',
    okText: 'Объединить',
    body: h('div', null,
      h('p', { class: 'hint' }, r.kind === 'customer'
        ? 'Это то же самое, что другой заказчик (другое написание)? Все его заказы и позиции перейдут к выбранному, это название исчезнет.'
        : 'Это тот же поставщик, что другой (дубль)? Все его заявки перейдут к выбранному, дубль уйдёт в корзину; почта, телефон и ИНН дополнят выбранного.'),
      h('label', { class: 'field' }, h('span', null, 'Оставить'), sel)),
    onOk: async () => {
      if (!sel.value) throw new Error('Выберите, с кем объединить');
      return api(`/partners/${enc(r.id)}/merge`, { method: 'POST', body: { intoId: sel.value } });
    },
  });
  if (done) { toast(`Объединено: перенесено записей — ${done.moved}`); ctx.close(); window.dispatchEvent(new CustomEvent('data-changed')); go('partners', { type: type === 'customer' ? 'customer' : undefined, open: done.id }); }
}

function related(r) {
  const items = r.related || [];
  if (r.kind === 'customer') {
    return h('div', null, h('div', { class: 'section-title' }, `Заказы (${items.length})`),
      items.length ? h('ul', { class: 'timeline' }, ...items.map((o) => h('li', null,
        h('a', { href: '#salesorders?open=' + o.id }, `Заказ № ${o.orderNo || '—'}`),
        h('span', { class: 'muted' }, [STAGE[o.stage]?.label, o.shipDate ? 'отгрузка ' + date(o.shipDate) : '', o.title].filter(Boolean).join(' · ')))))
        : h('p', { class: 'muted' }, 'Заказов нет'));
  }
  return h('div', null, h('div', { class: 'section-title' }, `${r.kind === 'our' ? 'Заявки на эту компанию' : 'Заявки этому поставщику'} (${items.length})`),
    items.length ? h('ul', { class: 'timeline' }, ...items.map((x) => h('li', null,
      h('span', { class: 'when' }, date(x.requestDate)),
      h('a', { href: '#requests?open=' + x.id }, `№${x.num ?? ''} ${x.title}`),
      h('span', { class: 'muted' }, `${qty(x.qty)} ${x.unit || ''}`),
      badge(SUPPLY_STATUS, supplyKey(x)),
      session.canMoney && x.priceHint ? h('span', { class: 'num' }, money(x.priceHint)) : null)))
      : h('p', { class: 'muted' }, 'Заявок нет'));
}

export const partners = {
  id: 'partners',
  title: 'Контрагенты',
  entityType: 'Partner',
  historyLabels: { 'partner.updated': 'Изменён', 'partner.merged': 'Объединён' },
  get: (id) => api(`/partners/${enc(id)}`),

  list: {
    path: '/partners',
    sortDefault: '',
    createLabel: false,
    searchPlaceholder: 'Поиск: название, ИНН, почта, телефон…',
    emptyText: 'Пусто.',
    filters: [
      { key: 'type', label: 'Кто', type: 'chips', noAll: true, defaultValue: 'supplier',
        options: () => [{ value: 'supplier', label: 'Поставщики' }, { value: 'customer', label: 'Заказчики' }, { value: 'our', label: 'Наши компании' }],
        count: (resp, v) => resp.counts?.[v] },
    ],
    hintKey: 'type',
    hints: {
      '': 'Поставщики — из заявок. Клик — все заявки поставщику; «Изменить» — ИНН, почта, телефон; дубль написания — «Объединить с…» в карточке.',
      supplier: 'Поставщики — из заявок. Клик — все заявки поставщику; «Изменить» — ИНН, почта, телефон; дубль написания — «Объединить с…» в карточке.',
      customer: 'Заказчики — из заказов. Одно и то же написано по-разному? Откройте и «Объединить с…» — заказы соберутся под одним названием.',
      our: 'Наши компании: на них оформляются заявки и заказы, по ним делится платёжный календарь.',
    },
    columns: [
      { key: 'name', label: 'Название', cls: 'clip', render: (r) => h('b', { title: r.name }, r.name) },
      { key: 'inn', label: 'ИНН', cls: 'md-hide', render: (r) => r.inn || h('span', { class: 'muted' }, '—') },
      { key: 'n', label: 'Записей', cls: 'num right', render: (r) => (r.kind === 'customer' ? `${qty(r.orders)} заказ.` + (r.activeOrders ? ` · в работе ${r.activeOrders}` : '') : `${qty(r.requests)} заяв.`) },
      { key: 'sum', label: 'Сумма', money: true, cls: 'num right md-hide', render: (r) => (r.sum ? money(r.sum) : '') },
      { key: 'lastDate', label: 'Последняя', cls: 'md-hide', render: (r) => (r.lastDate ? date(r.lastDate) : '') },
      { key: 'contacts', label: 'Контакты', cls: 'clip md-hide muted', render: (r) => [r.phone, r.email].filter(Boolean).join(' · ') },
    ],
    card: {
      title: (r) => r.name,
      sub: (r) => [KIND[r.kind], r.inn ? 'ИНН ' + r.inn : '', r.kind === 'customer' ? `${r.orders} заказ.` : `${r.requests} заяв.`].filter(Boolean).join(' · '),
      side: () => [],
    },
  },

  card: {
    heading: (r) => r.name,
    subheading: (r) => [KIND[r.kind], r.inn ? 'ИНН ' + r.inn : ''].filter(Boolean).join(' · '),
    stats: (r) => [
      r.kind === 'customer' ? ['Заказов', qty(r.orders)] : ['Заявок', qty(r.requests)],
      ...(r.kind === 'customer' ? [['В работе', qty(r.activeOrders)]] : []),
      ...(session.canMoney ? [['Сумма', r.sum ? money(r.sum) : '—']] : []),
      ['Последняя', r.lastDate ? date(r.lastDate) : '—'],
    ],
    view: (r) => [['ИНН', r.inn], ['Почта', r.email], ['Телефон', r.phone], ['Сайт', r.website], ['Примечание', r.notes]],
    actions: (r) => [
      r.kind !== 'our' && { label: 'Объединить с…', run: (row, ctx) => mergeDialog(row, ctx) },
      r.kind === 'supplier' && { label: 'Новая заявка этому поставщику', run: () => patch({ of: 'requests', new: '1', open: undefined }) },
    ],
    extra: related,
  },

  form: {
    fields: async (r) => (r?.kind === 'customer'
      ? [{ key: 'name', label: 'Название (во всех заказах)', required: true, wide: true, max: 300, hint: 'Поменяется во всех заказах и позициях этого заказчика' }]
      : [
        { key: 'name', label: 'Название', required: true, wide: true, max: 300 },
        { key: 'inn', label: 'ИНН', max: 12, hint: '10 цифр — организация, 12 — ИП' },
        { key: 'phone', label: 'Телефон', max: 50 },
        { key: 'email', label: 'Почта', max: 200 },
        { key: 'website', label: 'Сайт', max: 300 },
        { key: 'notes', label: 'Примечание', type: 'textarea', wide: true },
      ]),
    toInitial: (r) => ({ ...r, inn: r.inn || '' }),
    toBody: (v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === null ? '' : String(x)])),
    update: (id, body) => api(`/partners/${enc(id)}`, { method: 'PATCH', body }),
  },

  searchRow: (r) => ({ title: r.name, sub: KIND[r.kind], side: '' }),
  open: (id) => go('partners', { open: id }),
};
