import { h } from '../../core/dom.js';
import { PREFIX } from '../../core/api.js';
import { badge as badgeOf } from '../badges.js';
import { emptyState } from '../empty.js';

/**
 * kit — единая библиотека эталонов. Разделы импортируют ТОЛЬКО отсюда (docs/roles/tz/DESIGN-KIT.md).
 * Фабрики выдают существующие классы (.btn, .tile, .tcard, .db-order, .chips/.chip, .stats/.stat, .board/.col, .badge, .state);
 * модификаторы — k-… в kit.css.
 */

const TONES = ['info', 'warn', 'danger', 'ok'];
const nodes = (x) => [].concat(x ?? []).filter((n) => n !== null && n !== false && n !== '');
const quiet = (node) => { for (const t of ['pointerdown', 'click', 'keydown']) node.addEventListener(t, (e) => e.stopPropagation()); return node; };

/** button({ label, kind: 'primary'|'secondary'|'ghost'|'danger', size: 'M'|'S', icon?, onClick, busy?, disabled?, title?, type? }) → .btn */
export function button({ label, kind = 'secondary', size = 'M', icon, onClick, busy = false, disabled = false, title, type = 'button' } = {}) {
  const cls = ['btn', kind === 'primary' ? 'btn-primary' : kind === 'ghost' ? 'btn-ghost' : kind === 'danger' ? 'btn-danger' : '', size === 'S' ? 'btn-sm' : '', busy ? 'is-busy' : ''].filter(Boolean).join(' ');
  return h('button', { type, class: cls, disabled: disabled || busy, title, onclick: onClick }, icon || null, label);
}

/** badge(map, key) — как badges.js; badge('Текст', 'ok'|'warn'|'danger'|'info'|'dim') — одиночная метка → .badge */
export function badge(a, b) {
  if (a && typeof a === 'object') return badgeOf(a, b);
  return h('span', { class: 'badge ' + (b || 'dim') }, a);
}

export { emptyState as empty };

/** card({ size: 'S'|'M'|'L', tone: 'neutral'|'info'|'warn'|'danger'|'ok', title, meta, badges, actions, onClick, photo, density, cls })
 *  S → .tile, M → .tcard (density 'compact' → .tcard.compact), L → .db-order. tone → .tone-X + .k-toned (полоса слева).
 *  photo — строка-адрес или { thumb, url } (с PREFIX); badges/actions — узлы или массивы; кнопки в actions не открывают карточку. */
export function card({ size = 'M', tone = 'neutral', title, meta, badges, actions, onClick, photo, density, cls } = {}) {
  const toned = TONES.includes(tone) ? ' tone-' + tone + ' k-toned' : '';
  const open = onClick ? { tabindex: '0', role: 'button', onclick: onClick, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } } : {};
  const bs = nodes(badges), as = nodes(actions);
  const pic = photo ? h('img', { class: 't-pic', src: typeof photo === 'string' ? photo : PREFIX + (photo.thumb || photo.url), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }) : null;
  const extra = cls ? ' ' + cls : '';
  if (size === 'S') {
    return h('div', { class: 'tile k-s' + toned + extra, ...open }, h('b', { title }, title), meta ? h('span', { class: 'muted' }, meta) : null,
      bs.length ? h('div', { class: 'k-badges' }, ...bs) : null, as.length ? quiet(h('div', { class: 'k-actions' }, ...as)) : null);
  }
  if (size === 'L') {
    return h('article', { class: 'db-order' + toned + extra, ...open },
      h('div', { class: 'db-oh' }, h('span', { class: 'db-oname' }, h('b', null, title), meta ? h('span', { class: 'db-cust' }, ' · ' + meta) : null)),
      bs.length || as.length ? h('div', { class: 'db-ocnt' }, ...bs, ...as) : null);
  }
  const compact = density === 'compact';
  const text = [h('div', { class: 't-title', title }, title), meta || bs.length ? h('div', { class: 't-meta' }, meta, ...bs) : null];
  return h('article', { class: 'tcard' + (compact ? ' compact' : '') + toned + extra, ...open },
    pic, compact ? h('div', { class: 't-main' }, ...text) : text,
    as.length ? quiet(h('div', { class: 'k-actions' }, ...as)) : null);
}

/** tabs({ items: [{ key, label, count? }], value, onChange(key) }) → { el, set(key) } — .chips/.chip */
export function tabs({ items, value, onChange }) {
  const el = h('div', { class: 'chips', role: 'tablist' });
  const set = (key) => el.querySelectorAll('.chip').forEach((c) => { const on = c.dataset.key === String(key); c.classList.toggle('active', on); c.setAttribute('aria-selected', String(on)); });
  el.append(...items.map((it) => h('button', { type: 'button', role: 'tab', class: 'chip', dataset: { key: String(it.key) }, onclick: () => { set(it.key); onChange?.(it.key); } },
    it.label, it.count != null ? h('b', null, String(it.count)) : null)));
  set(value ?? items[0]?.key);
  return { el, set };
}

/** stat({ value, label }) → .stat; stats([...]) → .stats */
export const stat = ({ value, label }) => h('div', { class: 'stat' }, h('b', { class: 'num' }, String(value ?? '—')), h('span', null, label));
export const stats = (items) => h('div', { class: 'stats' }, ...items.map(stat));

/** toolbar(...узлы) → .toolbar */
export const toolbar = (...children) => h('div', { class: 'toolbar' }, ...nodes(children));

/** Доска с данными с сервера (колонки, DnD, порции) — ui/kit/board.js */
export { mountBoard as board } from './board.js';

/** boardStatic({ columns: [{ key, label, tone, hint?, cards: [узлы], empty? }], density }) → .board без сервера (витрина, малые списки) */
export function boardStatic({ columns, density = 'normal' }) {
  return h('div', { class: 'board' + (density === 'pics' ? ' board-pics' : '') },
    ...columns.map((c) => h('section', { class: 'col tone-' + (c.tone || 'dim'), 'aria-label': c.label },
      h('div', { class: 'col-head' }, h('span', { class: 'dot' }), h('span', null, c.label), h('span', { class: 'n' }, String(c.cards.length))),
      c.hint ? h('div', { class: 'col-hint' }, c.hint) : null,
      h('div', { class: 'col-body' }, ...(c.cards.length ? c.cards : [h('div', { class: 'col-more muted' }, c.empty || 'Пусто')])))));
}

// ---- Реэкспорт существующих эталонов ----
export { modal, confirmDlg } from '../dialog.js';
export { toast, toastError } from '../toast.js';
export { failBlock, busyBlock } from '../busy.js';
export { mountList } from '../list.js';
export { openCard } from '../card.js';
export { enhanceSelect, isLong } from '../select.js';
export { attachCombo } from '../combo.js';
export { tagPick } from '../tag-pick.js';
export { stepFunnel } from '../step-funnel.js';
export { facetFilter, parseFt, ftQuery, ftParams } from '../facet-filter.js';
export { SUPPLY_STATUS, INVOICE_STATUS, STOCK_STATUS, DESIGN_STATUS, ORDER_PRIORITY, PRIORITY, supplyKey } from '../badges.js';
