import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { plural, qty } from '../core/format.js';
import { icon } from '../ui/icons.js';
import { openStockOp } from './stock-ops.js';
import { dayLabel, moveLabel } from './movements.js';
import { badge, STOCK_STATUS } from '../ui/badges.js';

const isMobile = () => window.innerWidth <= 720;
const thumb = (photo) => photo ? h('img', { class: 'mob-thumb', src: PREFIX + (photo.thumb || photo.url), alt: '', loading: 'lazy' }) : null;

/** Панель быстрых действий склада для мобильного устройства. */
export function mobileStockDashboard() {
  if (!isMobile()) return null;

  const actions = [
    { key: 'in', label: 'Принять', sub: 'Приход товара', cls: 'ma-in', ico: 'stock' },
    { key: 'out', label: 'Выдать', sub: 'Со склада', cls: 'ma-out', ico: 'moves' },
    { key: 'writeoff', label: 'Списать', sub: 'Брак / потеря', cls: 'ma-writeoff', ico: 'trash' },
    { key: 'count', label: 'Пересчёт', sub: 'Сверить остатки', cls: 'ma-count', ico: 'ops' },
  ];

  const grid = h('div', { class: 'mob-acts' },
    ...actions.map((a) =>
      h('button', { type: 'button', class: `mob-act ${a.cls}`, onclick: () => openStockOp(a.key) },
        h('span', { class: 'mob-act-ico' }, icon(a.ico, 'ico mob-ico')),
        h('span', { class: 'mob-act-text' },
          h('b', null, a.label),
          h('small', null, a.sub)))));

  const arrivalsBox = h('div', { class: 'mob-arrivals' });
  loadArrivals(arrivalsBox);

  const alertsBox = h('div', { class: 'mob-alerts' });
  loadAlerts(alertsBox);

  const recentBox = h('div', { class: 'mob-recent' });
  loadRecent(recentBox);

  return h('div', { class: 'mob-dash' }, grid, arrivalsBox, alertsBox, recentBox);
}

/** «Ждём поставку» — заявки ordered/paid, с фото позиции склада и количеством. */
async function loadArrivals(box) {
  try {
    const r = await api('/supply/requests', { query: { status: 'ordered,paid', limit: 50, sort: '-requestDate' } });
    const items = r.items || [];
    if (!items.length) { box.replaceChildren(); return; }

    // фото берём из позиций склада (по materialId — один запрос на все уникальные id)
    const matIds = [...new Set(items.map((x) => x.materialId).filter(Boolean))];
    const photoMap = new Map();
    if (matIds.length) {
      try {
        const sr = await api('/stock/items', { query: { ids: matIds.join(','), limit: matIds.length, fields: 'id,photos' } });
        for (const si of sr.items || []) {
          if (si.photos?.length) photoMap.set(si.id, si.photos[0]);
        }
      } catch { /* фото не критично */ }
    }

    // группируем по счёту + поставщику (как в ops.js)
    const groups = new Map();
    for (const req of items) {
      const inv = String(req.invoiceNo || '').replace(/^\s*сч[её]т\s*№?\s*/i, '').trim();
      const key = inv ? `Счёт ${inv}` : 'Без счёта';
      const gKey = key + '|' + (req.supplierName || '');
      if (!groups.has(gKey)) groups.set(gKey, { label: key, supplier: req.supplierName || '', items: [] });
      groups.get(gKey).items.push(req);
    }

    box.replaceChildren(
      h('div', { class: 'mob-section-title' }, `Ждём поставку (${items.length})`),
      h('div', { class: 'mob-arr-groups' },
        ...[...groups.values()].map((g) =>
          h('div', { class: 'mob-arr-group' },
            h('div', { class: 'mob-arr-head' },
              h('b', null, g.label),
              h('small', { class: 'muted' }, g.supplier)),
            h('div', { class: 'mob-arr-items' },
              ...g.items.map((req) => {
                const photo = photoMap.get(req.materialId);
                return h('div', { class: 'mob-arr-item', onclick: () => openStockOp('in', req.materialId || undefined) },
                  thumb(photo) || h('span', { class: 'mob-arr-no-pic' }, '▢'),
                  h('div', { class: 'mob-arr-info' },
                    h('div', { class: 'mob-arr-name clip' }, req.title),
                    h('div', { class: 'mob-arr-meta' },
                      h('b', { class: 'num' }, `${qty(req.qty)} ${req.unit || ''}`),
                      req.paid ? h('span', { class: 'mob-arr-paid' }, 'оплачено') : null,
                      req.deliveryNote ? h('span', { class: 'muted' }, req.deliveryNote) : null)));
              })),
            h('button', { class: 'btn btn-sm mob-arr-accept', type: 'button', onclick: () => openStockOp('in') },
              `Принять ${g.items.length} ${plural(g.items.length, 'позицию', 'позиции', 'позиций')}`)))));
  } catch { box.replaceChildren(); }
}

async function loadAlerts(box) {
  try {
    const r = await api('/stock/items', { query: { status: 'low,none', limit: 5, sort: 'name' } });
    const items = r.items || [];
    if (!items.length) { box.replaceChildren(); return; }
    box.replaceChildren(
      h('div', { class: 'mob-section-title' }, `Требуют внимания (${(r.counts?.low || 0) + (r.counts?.none || 0) || items.length})`),
      h('div', { class: 'mob-alert-list' },
        ...items.map((it) =>
          h('a', { class: 'mob-alert-row', href: `#stock?open=${it.id}` },
            thumb(it.photos?.[0]),
            h('span', { class: 'mob-alert-name clip' }, it.name),
            h('span', { class: 'mob-alert-qty num' }, `${qty(it.quantity)} ${it.unit || ''}`),
            badge(STOCK_STATUS, it.status)))));
  } catch { box.replaceChildren(); }
}

async function loadRecent(box) {
  try {
    const r = await api('/stock/movements', { query: { limit: 8, sort: '-date' } });
    const items = r.items || [];
    if (!items.length) { box.replaceChildren(h('div', { class: 'mob-section-title' }, 'Движений пока нет')); return; }
    box.replaceChildren(
      h('div', { class: 'mob-section-title' }, 'Последние движения'),
      h('ul', { class: 'mob-moves' },
        ...items.map((m) =>
          h('li', { class: 'mob-move' },
            h('span', { class: `mob-move-type ${m.type === 'in' ? 'pos' : m.type === 'out' ? 'neg' : ''}` }, moveLabel(m)),
            h('span', { class: 'mob-move-name clip' }, m.materialName),
            h('span', { class: `mob-move-qty num ${m.delta > 0 ? 'pos' : m.delta < 0 ? 'neg' : ''}` },
              `${m.delta > 0 ? '+' : ''}${qty(m.delta)} ${m.unit || ''}`),
            h('span', { class: 'mob-move-date muted' }, dayLabel(m.date))))));
  } catch { box.replaceChildren(); }
}
