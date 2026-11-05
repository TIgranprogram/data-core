import { h } from '../../core/dom.js';
import { qty } from '../../core/format.js';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

/** Какие месяцы/годы раскрыты (запоминается в localStorage по разделу). */
export function periodState(sectionId, rerender) {
  const openKey = 'dc-open-' + sectionId;
  const opened = new Set((() => { try { return JSON.parse(localStorage.getItem(openKey) || '[]'); } catch { return []; } })());
  const toggle = (k) => { opened.has(k) ? opened.delete(k) : opened.add(k); try { localStorage.setItem(openKey, JSON.stringify([...opened].slice(-60))); } catch { /* */ } rerender(); };
  return { opened, toggle };
}

/** Месяцы и годы (фаза М): завершённое сворачивается строками «Сентябрь 2026 · 34». */
export function paintPeriods({ per, rows, P, L, canAct, onOpen, actionButton, tbody, cards, state, markSelected }) {
  const { opened, toggle } = state;
  const now = new Date();
  const curYM = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const all = !!P.q; // при поиске всё раскрыто
  const months = new Map();
  for (const r of rows) {
    const d = per.date(r) ? new Date(per.date(r)) : null;
    const ym = d && !Number.isNaN(d.getTime()) ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') : 'none';
    if (!months.has(ym)) months.set(ym, []);
    months.get(ym).push(r);
  }
  const keys = [...months.keys()].sort().reverse();
  const cols = L.columns.length + (canAct ? 1 : 0);
  const trs = []; const lis = [];
  const head = (k, label, n, items, level, isOpen) => {
    const tot = per.total ? per.total(items) : null;
    trs.push(h('tr', { class: 'period-row lvl' + level + (isOpen ? ' open' : ''), onclick: () => toggle(k) },
      h('td', { colspan: cols }, h('span', { class: 'p-caret', 'aria-hidden': 'true' }, isOpen ? '▾' : '▸'), h('b', null, label), h('span', { class: 'p-n' }, qty(n)), tot ? h('span', { class: 'p-tot' }, tot) : null)));
    lis.push(h('li', { class: 'period-li lvl' + level, onclick: () => toggle(k) }, h('span', null, (isOpen ? '▾ ' : '▸ ') + label), h('span', { class: 'p-n' }, qty(n)), tot ? h('span', { class: 'p-tot' }, tot) : null));
  };
  const rowsOf = (items) => items.forEach((row) => {
    const i = rows.indexOf(row);
    const trClsP = L.rowClass ? L.rowClass(row) : '';
    const tr = h('tr', { class: trClsP || undefined, onclick: () => onOpen(row), dataset: { i: String(i) } }, L.columns.map((c) => h('td', { class: c.cls || '' }, c.render ? c.render(row) : row[c.key] ?? '')));
    if (canAct) tr.append(h('td', { class: 'act' }, actionButton(row)));
    trs.push(tr);
    lis.push(h('li', { onclick: () => onOpen(row) }, L.card.thumb ? L.card.thumb(row) : null,
      h('div', { class: 'c-main' }, h('div', { class: 'c-title' }, L.card.title(row)), h('div', { class: 'c-sub' }, L.card.sub(row))),
      h('div', { class: 'c-side' }, L.card.side ? L.card.side(row) : null)));
  });
  const monthName = (ym) => { if (ym === 'none') return 'Без даты'; const [y, m] = ym.split('-').map(Number); return MONTHS[m - 1] + ' ' + y; };
  const year = String(now.getFullYear());
  // этот год — месяцами; прошлые годы — строкой года, внутри месяцы
  const byYear = new Map();
  for (const k of keys) { const y = k === 'none' ? 'none' : k.slice(0, 4); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(k); }
  for (const [y, ks] of byYear) {
    const nested = y !== year && y !== 'none' && byYear.size > 1;
    let show = true;
    if (nested) {
      const items = ks.flatMap((k) => months.get(k));
      const yk = 'y' + y; const isOpen = all || opened.has(yk);
      head(yk, y + ' год', items.length, items, 0, isOpen);
      show = isOpen;
    }
    if (!show) continue;
    for (const k of ks) {
      const items = months.get(k);
      const isOpen = all || k === curYM || opened.has(k) || (keys.length === 1);
      head(k, monthName(k), items.length, items, nested ? 1 : 0, isOpen);
      if (isOpen) rowsOf(items);
    }
  }
  tbody.replaceChildren(...trs);
  cards.replaceChildren(...lis);
  markSelected();
}
