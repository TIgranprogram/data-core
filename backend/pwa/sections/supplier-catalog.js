import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, money, qty } from '../core/format.js';
import { toast, toastError } from '../ui/toast.js';

/** Кэш позиций: id → item. Заполняется через list.footer при каждой загрузке списка. */
const _cache = new Map();
/** Кэш имён поставщиков: supplierId → name. Заполняется при загрузке tiles. */
const _supplierNames = new Map();

export const supplierCatalog = {
  id: 'supplier-catalog',
  title: 'Каталог поставщиков',

  /** Получить позицию по id: из кэша + дополнить именем поставщика при необходимости. */
  get: async (id) => {
    const item = _cache.get(id);
    if (!item) throw new Error('Позиция не найдена — обновите список');
    if (item.supplierId && !item._supplierName) {
      try {
        const partner = await api(`/partners/${item.supplierId}`);
        item._supplierName = partner.name || '';
        _cache.set(id, item);
      } catch { /* некритично, имя поставщика необязательно */ }
    }
    return item;
  },

  list: {
    path: '/supplier-catalog',
    sidebar: true,
    sortDefault: 'name',
    searchPlaceholder: 'Поиск: наименование, артикул…',
    emptyText: 'Нет позиций — выберите поставщика и нажмите «Синхронизировать прайс» в его карточке.',

    /** Левая панель: список поставщиков. Клик — фильтр по supplierId (hidden filter ниже). */
    tiles: {
      key: 'supplierId',
      title: 'Поставщики',
      load: async () => {
        const resp = await api('/supplier-catalog/suppliers');
        for (const s of resp.items || []) _supplierNames.set(String(s.id), s.name);
        return (resp.items || []).map((s) => ({ value: s.id, label: s.name }));
      },
    },

    filters: [
      { key: 'supplierId', type: 'hidden' }, // управляется через tiles
      {
        key: 'inStock',
        label: 'Наличие',
        type: 'chips',
        options: () => [
          { value: '1', label: 'В наличии' },
          { value: '0', label: 'Нет в наличии' },
        ],
      },
    ],

    columns: [
      { key: 'vendorArticle', label: 'Артикул', cls: 'num md-hide', render: (r) => r.vendorArticle || '' },
      { key: 'name', label: 'Наименование', cls: 'clip', render: (r) => h('b', { title: r.name }, r.name) },
      { key: '_supplierName', label: 'Поставщик', cls: 'clip md-hide', render: (r) => r._supplierName || '' },
      { key: 'priceRetail', label: 'Цена', cls: 'num right', money: true, render: (r) => (r.priceRetail ? money(r.priceRetail) : '') },
      { key: 'syncedAt', label: 'Синхронизировано', cls: 'num md-hide', render: (r) => (r.syncedAt ? date(r.syncedAt) : '') },
    ],

    /** Вид на телефоне. */
    card: {
      title: (r) => r.name,
      sub: (r) => [r.vendorArticle, r._supplierName, r.category].filter(Boolean).join(' · '),
      side: (r) => (r.priceRetail ? h('span', { class: 'num small' }, money(r.priceRetail)) : null),
    },

    /** Кэшируем позиции и обогащаем именем поставщика. */
    footer: (resp) => {
      for (const item of resp.items || []) {
        if (item.supplierId) item._supplierName = _supplierNames.get(String(item.supplierId)) || '';
        if (item.id) _cache.set(item.id, item);
      }
      return null;
    },
  },

  card: {
    heading: (r) => r.name,
    subheading: (r) => [r.vendorArticle && `Арт. ${r.vendorArticle}`, r._supplierName].filter(Boolean).join(' · '),
    noHistory: true,

    view: (r) => [
      ['Категория', r.category],
      ['Поставщик', r._supplierName],
      ['Цена розничная', r.priceRetail ? money(r.priceRetail) : ''],
      ['Единица', r.unit],
      ['В наличии', r.inStock != null ? (r.inStock ? (r.stockQty != null ? `${qty(r.stockQty)} ${r.unit || ''}`.trim() : 'Да') : 'Нет') : ''],
      ['Синхронизировано', r.syncedAt ? date(r.syncedAt) : ''],
      ['Источник', r.sourceUrl ? h('a', { href: r.sourceUrl, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' }, 'открыть') : ''],
    ],

    /** Фото, таблица цен, характеристики, кнопка «Создать заявку». */
    extra: (r) => {
      const parts = [];

      if (r.photoUrls && r.photoUrls.length) {
        const imgSrc = /^https?:\/\//.test(r.photoUrls[0]) ? r.photoUrls[0] : PREFIX + r.photoUrls[0];
        const stub = h('span', { class: 'muted', hidden: true }, '— фото недоступно');
        const img = h('img', {
          src: imgSrc,
          alt: r.name,
          referrerpolicy: 'no-referrer',
          loading: 'lazy',
          style: 'max-width:100%;max-height:220px;object-fit:contain;display:block;margin-bottom:var(--s3)',
        });
        img.onerror = () => { img.hidden = true; stub.hidden = false; };
        parts.push(h('div', null, img, stub));
      }

      if (r.prices && r.prices.length) {
        parts.push(h('div', { class: 'section-title' }, 'Цены по порогам'));
        parts.push(h('table', { class: 'list', style: 'margin-bottom:var(--s3)' },
          h('thead', null, h('tr', null, h('th', null, 'От'), h('th', { class: 'right' }, 'Цена'))),
          h('tbody', null, ...r.prices.map((p) => h('tr', null,
            h('td', null, qty(p.minQty) + (r.unit ? ' ' + r.unit : '')),
            h('td', { class: 'num right' }, money(p.price)))))));
      }

      const specsEntries = r.specs ? Object.entries(r.specs) : [];
      if (specsEntries.length) {
        parts.push(h('div', { class: 'section-title' }, 'Характеристики'));
        parts.push(h('dl', { class: 'fields' },
          ...specsEntries.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])));
      }

      if (session.canEdit) {
        const btn = h('button', {
          class: 'btn btn-primary',
          type: 'button',
          onclick: async (e) => {
            const b = e.currentTarget;
            if (b.disabled) return;
            b.disabled = true; // двойной клик — не две заявки
            try {
              await api('/supply/requests', { method: 'POST', body: {
                title: r.name,
                qty: 1,
                ...(r.unit && { unit: r.unit }),
                ...(r.vendorArticle && { article: r.vendorArticle }),
                ...(r._supplierName && { supplierName: r._supplierName }),
                ...(r.priceRetail && { priceHint: r.priceRetail }),
                ...(r.sourceUrl && { productUrl: r.sourceUrl }),
              } });
              toast('Заявка создана — количество и срок поправьте в «Заявках»');
            } catch (err) { toastError(err); } finally { b.disabled = false; }
          },
        }, '+ В заявку');
        parts.push(h('div', { style: 'margin-top:var(--s4)' }, btn));
      }

      return parts.length ? h('div', null, ...parts) : null;
    },
  },
};
