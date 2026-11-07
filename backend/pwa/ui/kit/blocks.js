import { h } from '../../core/dom.js';
import { mark } from './mark.js';
import { openZoom } from './gallery.js';
import { PREFIX } from '../../core/api.js';

const nodes = (x) => [].concat(x ?? []).filter((n) => n !== null && n !== false && n !== '');
const SVG = 'http://www.w3.org/2000/svg';

/** hint(text, tone?) → p.hint: подпись под полем или заголовком. tone: 'warn' | 'danger' (красный) | 'ok' (зелёный); без tone — приглушённая. */
export function hint(text, tone) {
  const t = tone === 'danger' || tone === 'warn' ? ' ' + tone : tone === 'ok' ? ' ok' : '';
  return mark(h('p', { class: 'hint' + t }, text), 'hint');
}

/** tileGrid(...плитки) → .k-tilegrid: сетка карточек S (2 колонки на телефоне, 3–4 на широком экране).
 *  tileGrid({ compact: true }, ...плитки) → .k-tilegrid-compact: плотная сетка для плиток card S compact (C043, типы в раскрытой категории).
 *  Плитки с expand: панели переносятся в конец сетки (под весь ряд, на всю ширину), открыта одна — открыл другую, прежняя закрылась. */
export const tileGrid = (...args) => {
  const opts = args[0] && typeof args[0] === 'object' && !(typeof Node !== 'undefined' && args[0] instanceof Node) ? args.shift() : {};
  const grid = h('div', { class: 'k-tilegrid' + (opts.compact ? ' k-tilegrid-compact' : '') }, ...nodes(args));
  accordion(grid);
  grid.append(...[...grid.querySelectorAll(':scope > .k-tile-wrap > .k-expand')]);
  return mark(grid, 'tileGrid');
};
/** Аккордеон: на открытие плитки закрыть остальные раскрытые плитки того же уровня (в tileGrid и landing). */
const accordion = (el) => el.addEventListener('k-expand-open', (e) => {
  const mine = e.target.closest('.k-expand');
  el.querySelectorAll('.k-tile-wrap > .tile[aria-expanded="true"]').forEach((t) => { if (t !== e.target && t.closest('.k-expand') === mine) t.click(); });
});

/** landing({ head, action?, body }) → .k-landing: строка «Выберите … · всего N» (muted), кнопка справа, ниже тело (обычно tileGrid). */
export function landing({ head, action, body } = {}) {
  const el = h('div', { class: 'k-landing' }, h('div', { class: 'k-landing-top' }, h('span', { class: 'muted' }, head), action || null), ...nodes(body));
  accordion(el);
  return mark(el, 'landing');
}

/** miniChart({ type: 'bar'|'spark'|'columns', parts?: [{ value, tone }], points?: [число], label? }) — маленький график для слота graph карточки S.
 *  bar — полоса из долей по тонам (info/warn/danger/ok/dim), высота 6 px; spark — линия по точкам с нулевой осью. Оба — aria-hidden.
 *  columns — { groups:[{ label, values:[{ value, tone }] }], legend:[{ label, tone }], empty } — столбики по периодам (месяцам), без кнопок, с подписью role=img; все 0 — подсказка empty. */
export function miniChart({ type = 'bar', parts = [], points = [], label, groups = [], legend = [], empty } = {}) {
  if (type === 'columns') return mark(monthBars({ groups, legend, label, empty }), 'miniChart');
  if (type === 'spark') {
    const el = document.createElementNS(SVG, 'svg');
    el.setAttribute('class', 'k-chart k-spark'); el.setAttribute('viewBox', '0 0 100 24'); el.setAttribute('preserveAspectRatio', 'none'); el.setAttribute('aria-hidden', 'true');
    const axis = document.createElementNS(SVG, 'line');
    axis.setAttribute('class', 'k-spark-axis'); axis.setAttribute('x1', '0'); axis.setAttribute('x2', '100'); axis.setAttribute('y1', '22'); axis.setAttribute('y2', '22');
    el.append(axis);
    const max = Math.max(1, ...points.map(Number));
    if (points.length) {
      const step = points.length > 1 ? 100 / (points.length - 1) : 0;
      const line = document.createElementNS(SVG, 'polyline');
      line.setAttribute('class', 'k-spark-line'); line.setAttribute('fill', 'none');
      line.setAttribute('points', points.map((v, i) => (i * step).toFixed(1) + ',' + (22 - (Number(v) / max) * 20).toFixed(1)).join(' '));
      el.append(line);
    }
    return mark(el, 'miniChart');
  }
  const total = parts.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return mark(h('div', { class: 'k-chart k-bar', 'aria-hidden': 'true' },
    ...parts.filter((p) => Number(p.value) > 0).map((p) => { const part = h('span', { class: 'k-bar-part tone-' + (p.tone || 'dim') }); part.style.flexGrow = String(Number(p.value) / total); return part; })), 'miniChart');
}

/** Столбики по периодам: monthBars → .k-mbars. groups: [{ label, values:[{ value, tone }] }], legend: [{ label, tone }]; пусто (все 0) — подсказка empty.
 *  Под столбиками — строка значений (C044-T2): число видно без наведения (title на телефоне не работает); цвета чисел — по тонам legend. Только чтение. */
function monthBars({ groups, legend, label, empty }) {
  const max = Math.max(0, ...groups.flatMap((g) => g.values.map((v) => Number(v.value) || 0)));
  if (!max) return h('p', { class: 'k-mbars-empty muted small' }, empty || 'Данных пока нет.');
  const text = groups.map((g) => g.label + ': ' + g.values.map((v, i) => (legend[i]?.label || '') + ' ' + (Number(v.value) || 0)).join(', ')).join('; ');
  const cols = groups.map((g) => {
    const bars = g.values.map((v, i) => {
      const b = h('i', { class: 'k-mb-b tone-' + (v.tone || 'dim'), title: g.label + ' · ' + (legend[i]?.label || '') + ': ' + (Number(v.value) || 0) });
      b.style.setProperty('--h', ((Number(v.value) || 0) / max * 100).toFixed(1) + '%');
      return b;
    });
    return h('div', { class: 'k-mb-g' }, h('div', { class: 'k-mb-plot' }, ...bars), h('span', { class: 'k-mb-l' }, g.label));
  });
  // строка значений: «янв 4 3 2» — подпись периода и числа по тонам; дублирует title для телефона
  const vals = groups.map((g) => h('span', { class: 'k-mb-v', title: g.label },
    h('span', { class: 'k-mb-vl' }, g.label),
    ...g.values.map((v) => h('em', { class: 'tone-' + (v.tone || 'dim') }, String(Number(v.value) || 0)))));
  return h('div', { class: 'k-chart k-mbars', role: 'img', 'aria-label': (label ? label + '. ' : '') + text },
    h('div', { class: 'k-mb-cols', 'aria-hidden': 'true' }, ...cols),
    h('div', { class: 'k-mb-vals', 'aria-hidden': 'true' }, ...vals),
    legend.length ? h('div', { class: 'k-mb-legend', 'aria-hidden': 'true' }, ...legend.map((l) => h('span', { class: 'k-mb-lg tone-' + (l.tone || 'dim') }, l.label))) : null);
}

/** navList({ groups: [{ title, fold?, open?, items: [{ key, label, count?, href? }] }], value, onPick(key), label }) → { el, set(key) }
 *  Колонка навигации в panel: заголовок группы, у fold — кнопка со стрелкой; пункт — подпись и число; активный — полоса. href → ссылка «→». */
export function navList({ groups = [], value, onPick, label = 'Разделы' } = {}) {
  const items = new Map();
  const set = (key) => items.forEach((el, k) => { const on = String(k) === String(key); el.classList.toggle('on', on); on ? el.setAttribute('aria-current', 'true') : el.removeAttribute('aria-current'); });
  const itemEl = (it) => {
    const kids = [h('span', { class: 'k-nav-t' }, it.label), it.count != null ? h('span', { class: 'k-nav-n num' }, String(it.count)) : null, it.href ? h('span', { class: 'k-nav-go', 'aria-hidden': 'true' }, '→') : null];
    const el = it.href ? h('a', { class: 'k-nav-item', href: it.href }, ...kids)
      : h('button', { type: 'button', class: 'k-nav-item', onclick: () => { set(it.key); onPick?.(it.key); } }, ...kids);
    items.set(it.key, el);
    return el;
  };
  const group = (g) => {
    const list = h('div', { class: 'k-nav-list' }, ...(g.items || []).map(itemEl));
    if (!g.fold) return h('div', { class: 'k-nav-group' }, g.title ? h('div', { class: 'k-nav-h' }, g.title) : null, list);
    const open = g.open !== false;
    const btn = h('button', { type: 'button', class: 'k-nav-h k-nav-fold', 'aria-expanded': String(open), onclick: () => { const o = btn.getAttribute('aria-expanded') !== 'true'; btn.setAttribute('aria-expanded', String(o)); list.hidden = !o; } },
      h('span', { class: 'form-sec-chev', 'aria-hidden': 'true' }, '›'), g.title);
    list.hidden = !open;
    return h('div', { class: 'k-nav-group' }, btn, list);
  };
  const el = mark(h('nav', { class: 'k-nav', 'aria-label': label }, ...groups.map(group)), 'navList');
  set(value);
  return { el, set };
}

/** photoStrip(list) → .k-photostrip: ряд квадратов 56 px из [{ url, thumb }]; клик — крупно (как posPic). Пусто → null. */
export function photoStrip(list = []) {
  const pics = list.filter((p) => p && (p.url || p.thumb));
  if (!pics.length) return null;
  return mark(h('div', { class: 'k-photostrip' }, ...pics.map((p, i) => h('button', { type: 'button', class: 'k-photostrip-item', title: 'Открыть фото крупно', 'aria-label': 'Открыть фото крупно', onclick: (e) => { e.stopPropagation(); openZoom(pics.map((x) => ({ url: x.url || x.thumb })), i); } },
    h('img', { src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' })))), 'photoStrip');
}
