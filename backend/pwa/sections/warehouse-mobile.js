import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { icon } from '../ui/icons.js';
import { openStockOp } from './stock-ops.js';
import { dayLabel, moveLabel } from './movements.js';
import { badge, STOCK_STATUS } from '../ui/badges.js';

const isMobile = () => window.innerWidth <= 720;

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

  const recentBox = h('div', { class: 'mob-recent' });
  loadRecent(recentBox);

  const alertsBox = h('div', { class: 'mob-alerts' });
  loadAlerts(alertsBox);

  return h('div', { class: 'mob-dash' }, grid, alertsBox, recentBox);
}

async function loadAlerts(box) {
  try {
    const r = await api('/stock/items', { query: { status: 'low,none', limit: 5, sort: 'name' } });
    const items = r.items || [];
    if (!items.length) { box.replaceChildren(); return; }
    box.replaceChildren(
      h('div', { class: 'mob-section-title' }, `Требуют внимания (${r.counts?.low + r.counts?.none || items.length})`),
      h('div', { class: 'mob-alert-list' },
        ...items.map((it) =>
          h('a', { class: 'mob-alert-row', href: `#stock?open=${it.id}` },
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
