import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, money, qty } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { toast } from '../ui/toast.js';
import { pic } from './stock.js';
import { kpAdd, kpCount } from './kp.js';
import { setCompositionTarget } from './composition.js';
import { issuePassport, passports } from './passports.js';

/*
 * «Продукция» (TASKS БЗ-4) — витрина изделий компании: разделы плитками, поиск, фото; карточка — правка (артикул,
 * наименование, раздел → группа, серия, цена, описание, фото); «В КП» в строке — собрать коммерческое предложение;
 * «⇩ Загрузить каталог» — Excel / вставка (колонки как в «Перечне изделий»: Тип · Группа · Артикул · Наименование · Серия · Цена).
 * Сервер — /api/showcase (поверх общей коллекции CRM products).
 */
const thumb = (r) => (r.photo ? h('img', { class: 'thumb', src: PREFIX + (r.photo.thumb || r.photo.url), alt: '', loading: 'lazy' }) : null);
const STATUS = { draft: 'черновик · нет цены', active: 'в продаже', new: 'новое', archived: 'архив' };

// «Состав» (БЗ-5): материалы склада, из которых сделано изделие; правка — в правой панели.
// Себестоимость материалов (тем, кто видит деньги): цена — последняя закупка, иначе справочник материалов
function compositionBlock(r) {
  const items = r.composition || [];
  const cost = session.canMoney ? r.cost : null;
  const price = new Map((cost?.lines || []).map((x) => [x.materialId, x]));
  const priceText = (l) => {
    const p = price.get(l.materialId);
    if (!cost) return '';
    if (!p || p.price == null) return ' · цены нет';
    return ` · ${money(p.price)}/${l.unit} = ${money(p.sum)}${p.source === 'reference' ? ' (справочник)' : p.date ? ` (закупка ${date(p.date)})` : ''}`;
  };
  return h('div', null, h('div', { class: 'section-title' }, `Состав${items.length ? ` (${items.length})` : ''}`),
    items.length ? h('ul', { class: 'timeline' }, ...items.map((l) => h('li', null, l.name, h('span', { class: 'muted' }, ` · ${qty(l.quantity)} ${l.unit}${l.article ? ' · ' + l.article : ''}${priceText(l)}`))))
      : h('p', { class: 'muted' }, 'Состав не заполнен — «Изменить состав» в действиях карточки'),
    cost ? h('p', null, h('b', null, `Себестоимость материалов ≈ ${money(cost.total)}`),
      h('span', { class: 'muted' }, cost.missing ? ` · без цены: ${cost.missing} — в сумму не вошли` : ' · по последним закупкам')) : null);
}

// «Паспорта» (БЗ-5): выпущенные паспорта этого изделия — по ссылке или по названию
function passportsBlock(r) {
  const p = r.passports;
  if (!p?.total) return h('p', { class: 'muted' }, 'Паспортов пока нет — «Выпустить паспорт» в действиях карточки');
  return h('div', null, h('div', { class: 'section-title' }, `Паспорта (${p.total})`),
    h('ul', { class: 'timeline' }, ...p.items.map((x) => h('li', null,
      h('a', { href: '#passports?open=' + x.id }, `№ ${x.passportNumber || '—'}`),
      h('span', { class: 'muted clip' }, [date(x.date), x.customer, x.orderNo ? 'заказ ' + x.orderNo : ''].filter(Boolean).join(' · '))))),
    p.total > p.items.length ? h('p', { class: 'muted' }, `показаны последние ${p.items.length}`) : null);
}

// «Где в заказах» (БЗ-5): позиции заказов с этим изделием (по ссылке или по совпадению названия) — только просмотр
function inOrders(r) {
  const items = r.orderLines || [];
  if (!items.length) return h('p', { class: 'muted' }, 'В заказах не встречается');
  return h('div', null, h('div', { class: 'section-title' }, `В заказах (${items.length})`),
    h('ul', { class: 'timeline' }, ...items.map((l) => h('li', null,
      h('a', { href: '#salesorders?open=' + l.orderId }, `№ ${l.orderNo || '—'}`),
      h('span', { class: 'muted clip' }, [l.customer, l.qty != null ? `${qty(l.qty)} шт.` : '', l.color, l.size, l.shipDate ? 'отгрузка ' + date(l.shipDate) : ''].filter(Boolean).join(' · '))))));
}

export const products = {
  id: 'products',
  title: 'Продукция',
  newTitle: 'Новое изделие',
  entityType: 'Product',
  get: (id) => api(`/showcase/${id}`),

  list: {
    path: '/showcase',
    sortDefault: 'name',
    createLabel: 'Изделие',
    searchPlaceholder: 'Поиск: наименование, артикул, серия…',
    emptyText: 'Изделий пока нет. «⇩ Загрузить каталог» — Excel с колонками Тип, Группа, Артикул, Наименование, Серия, Цена.',
    filters: [{ key: 'groupId', label: 'Раздел', type: 'hidden' }],
    tiles: {
      key: 'groupId',
      load: async () => (await api('/showcase/groups')).map((g) => ({ value: g.id, label: g.name, n: g.count, sub: g.parentId ? 'группа' : 'раздел' })),
    },
    headActions: () => [
      h('button', { class: 'btn', type: 'button', title: 'Excel или вставка из таблицы', onclick: () => patch({ of: 'catalogimport', new: '1', open: undefined }) }, '⇩ Загрузить каталог'),
      session.canEdit ? h('button', { class: 'btn', type: 'button', title: 'Создать изделия из позиций заказов', onclick: () => patch({ of: 'fromorders', new: '1', open: undefined }) }, 'Из заказов') : null,
      h('button', { class: 'btn kp-open', type: 'button', title: 'Собранное коммерческое предложение', onclick: () => patch({ of: 'kp', new: '1', open: undefined }) }, `КП (${kpCount()})`),
    ],
    hints: { '': 'Изделия компании. «В КП» в строке — добавить в коммерческое предложение; кнопка «КП» сверху — открыть и напечатать.' },
    rowAction: (r) => ({ label: 'В КП', title: 'Добавить в коммерческое предложение', run: (row) => { kpAdd(row); toast(`«${row.name}» в КП — всего ${kpCount()}`); document.querySelectorAll('.kp-open').forEach((b) => { b.textContent = `КП (${kpCount()})`; }); return false; } }),
    columns: [
      { key: 'pic', label: '', cls: 'pic-cell', export: false, render: (r) => pic(r.photo) },
      { key: 'sku', label: 'Артикул', sort: 'sku', cls: 'nowrap', render: (r) => r.sku },
      { key: 'name', label: 'Наименование', sort: 'name', cls: 'clip', render: (r) => h('span', { title: r.name }, r.name) },
      { key: 'group', label: 'Группа', cls: 'md-hide', render: (r) => [r.type, r.group].filter(Boolean).join(' → ') },
      { key: 'series', label: 'Серия', sort: 'series', cls: 'md-hide', render: (r) => r.series || '' },
      { key: 'price', label: 'Цена', sort: 'price', cls: 'num right', render: (r) => (r.price ? money(r.price) : h('span', { class: 'muted' }, 'нет цены')) },
    ],
    card: {
      thumb,
      title: (r) => r.name,
      sub: (r) => [r.sku && `арт. ${r.sku}`, r.group, r.series].filter(Boolean).join(' · '),
      side: (r) => [h('b', { class: 'num' }, r.price ? money(r.price) : '—')],
    },
  },

  card: {
    heading: (r) => r.name,
    subheading: (r) => [r.sku && `арт. ${r.sku}`, STATUS[r.status] || r.status].filter(Boolean).join(' · '),
    editTop: true,
    extra: (r) => h('div', null, compositionBlock(r), inOrders(r), passportsBlock(r)),
    gallery: (r) => r.photos || [],
    photoAdd: (r, photoId) => api(`/showcase/${r.id}`, { method: 'PATCH', body: { photoIds: [...(r.photos || []).map((p) => p.id), photoId] } }),
    photoRemove: (r, photoId) => api(`/showcase/${r.id}`, { method: 'PATCH', body: { photoIds: (r.photos || []).map((p) => p.id).filter((x) => x !== photoId) } }),
    view: (r) => [
      ['Артикул', r.sku], ['Раздел', r.type], ['Группа', r.group], ['Серия', r.series],
      ['Цена', r.price ? money(r.price) : h('span', { class: 'muted' }, 'не указана — изделие в черновиках')],
      ['Цвета', (r.colors || []).join(', ')], ['Размеры', (r.sizes || []).join(', ')],
      ['Описание', r.description],
    ],
    actions: (r) => [...(session.canEdit ? [{ label: 'Изменить состав', run: (row) => { setCompositionTarget(row); patch({ of: 'composition', new: '1', open: undefined }); } }] : []),
      ...(passports.canEdit() ? [{ label: 'Выпустить паспорт', run: async (row) => {
        if (!(await issuePassport({ productId: row.id, name: row.name, article: row.sku }))) toast('Паспортов этой модели ещё не было — заполните габариты, описание и картинки');
      } }] : []),
      { label: 'В коммерческое предложение', run: (row) => { kpAdd(row); toast(`В КП — всего ${kpCount()}`); } },
      { label: 'Заказы с этим изделием', run: (row) => go('salesorders', { q: row.name }) }],
  },

  form: {
    fields: async () => [
      { section: 'Изделие', tone: 'main', fixed: true },
      { key: 'sku', label: 'Артикул', required: true, max: 64, span: 1 },
      { key: 'name', label: 'Наименование', required: true, max: 256, span: 3 },
      { key: 'type', label: 'Раздел', max: 100, hint: 'Например: Детское игровое оборудование' },
      { key: 'group', label: 'Группа', max: 100, hint: 'Например: Качели' },
      { key: 'series', label: 'Серия', max: 100 },
      { key: 'price', label: 'Цена, ₽', type: 'money', min: 0, hint: 'Без цены изделие — черновик' },
      { key: 'colors', label: 'Цвета (варианты)', max: 500, hint: 'Через запятую: графит, зелёный' },
      { key: 'sizes', label: 'Размеры (варианты)', max: 500, hint: 'Через запятую: 3×2 м, 4×2 м' },
      { key: 'description', label: 'Описание', type: 'textarea', wide: true },
    ],
    toInitial: (r) => ({ ...r, colors: (r.colors || []).join(', '), sizes: (r.sizes || []).join(', ') }),
    toBody: (v) => ({ sku: v.sku, name: v.name, type: v.type || '', group: v.group || '', series: v.series || '', price: v.price ?? null, colors: v.colors || '', sizes: v.sizes || '', description: v.description || '' }),
    create: (b) => api('/showcase', { method: 'POST', body: b }),
    update: (id, b) => api(`/showcase/${id}`, { method: 'PATCH', body: b }),
  },

  remove: {
    text: (r) => `Удалить изделие «${r.name}»?`,
    run: (r) => api(`/showcase/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/showcase/${r.id}/restore`, { method: 'POST' }),
  },

  searchRow: (r) => ({ title: r.name, sub: [r.sku && `арт. ${r.sku}`, r.group].filter(Boolean).join(' · '), side: r.price ? money(r.price) : '' }),
  open: (id) => go('products', { open: id }),
  canEdit: () => session.canEdit,
};
