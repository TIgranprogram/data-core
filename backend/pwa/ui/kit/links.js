import { h } from '../../core/dom.js';
import { card, link, table } from './index.js';
import { mark } from './mark.js';

/**
 * links({ items, max = 5 }) — «Связи» в правой панели: сетка карточек связанных разделов (стиль «картотека», DESIGN §2.2).
 * Колонок столько, сколько влезает по ширине контейнера панели (мин. --card-min = 240px; 390 → одна колонка, 1920 → 2–3).
 * item: { key, title, total?, onClick?, columns?, rows?, more?, empty? }
 *   - без columns — карточка S: название + итог числом в шапке (+ onClick = «перейти в раздел»);
 *   - с columns и rows — карточка с таблицей (variant 'table') на всю строку: показано до max строк, остальное — «Ещё N» (more(item));
 *   - total — число или текст в шапке карточки справа; отрицательное число — красным (--danger).
 */
const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('ru-RU') : String(v));
const totalEl = (v) => (v == null || v === '' ? null : h('b', { class: 'num k-link-total' + (typeof v === 'number' && v < 0 ? ' neg' : '') }, fmt(v)));

function linkCard(it, max) {
  const meta = totalEl(it.total);
  if (!it.columns) return card({ size: 'S', title: it.title, meta, onClick: it.onClick });
  const rows = it.rows || [];
  const extra = rows.length - max;
  const body = [table({ columns: it.columns, rows: rows.slice(0, max), empty: it.empty || 'Нет записей' })];
  if (extra > 0) body.push(link({ label: 'Ещё ' + extra, onClick: () => it.more?.(it) }));
  return card({ size: 'M', variant: 'table', title: it.title, meta, body, cls: 'k-link-wide', onClick: it.onClick });
}

export function links({ items = [], max = 5 } = {}) {
  const grid = h('div', { class: 'k-links-grid' }, ...items.map((it) => { const c = linkCard(it, max); c.dataset.link = it.key || ''; return c; }));
  return mark(h('div', { class: 'k-links' }, grid), 'links');
}
