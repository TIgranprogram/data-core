import { mark } from './mark.js';
import { h } from '../../core/dom.js';
import { session } from '../../core/api.js';
import { emptyState } from './empty.js';
import { rowsTable } from '../rows-table.js';

/**
 * table — эталон таблицы. Вид один: шапка-подписи, строка 11/14, числа вправо, выбранная строка — золотая полоса.
 *   table({ columns: [{ key?, label, num?, cls?, hide?, money?, pic?, nowrap? }], rows, mode: 'list' | 'input', empty: { title, hint?, action? }, cls?, label (aria) })
 *   money: true у колонки — колонка и ячейки скрыты без галочки «Деньги» (session.canMoney); у поля panel — то же.
   pic: true — колонка под posPic (ширина по фото); nowrap: true — без переноса строки.
   maxHeight 'S'|'M'|'L' — своя прокрутка по высоте (предпросмотры).
 *   foot — строки <tr> подвала (итого); clickable — строки открывают запись (иначе курсор обычный).
 *   mode 'list' (по умолчанию): rows — массив строк { cells: [узел | текст | { v, cls }], onClick?, selected?, cls?, data? } или готовых <tr>
 *     (разделы, где строку уже собирает своя функция). Пусто → kit.empty. Возвращает <div.table-wrap> (в нём table.list).
 *   mode 'input': табличный ввод в форме (rows-table.js) — table({ mode:'input', columns:[{key,label,width?,num?,placeholder?}], rows, file, example }) → { el, value, focus }.
 * Постраничность, поиск, телефонный вид «карточки» — mountList (ui/list.js), это тот же вид.
 */
export function table({ columns = [], rows = [], mode = 'list', empty, cls, label, file, example, foot, clickable = false, maxHeight } = {}) {
  if (mode === 'input') return mark(rowsTable({ columns, rows, file, example }), 'table');
  // колонка { money: true } — только с галочкой «Деньги» у роли: колонку и её ячейки не рисуем
  const keep = columns.map((c) => !c.money || session.canMoney);
  if (keep.includes(false)) {
    rows = rows.map((r) => (r instanceof Node ? r : { ...r, cells: r.cells.filter((_, i) => keep[i] !== false) }));
    columns = columns.filter((_, i) => keep[i]);
  }
  if (!rows.length && empty) return emptyState(empty);
  const th = (c) => h('th', { class: [c.num ? 'num right' : '', c.hide ? 'md-hide' : '', c.pic ? 'k-col-pic' : '', c.nowrap ? 'k-nowrap' : '', c.cls || ''].filter(Boolean).join(' ') || null }, c.label ?? '');
  const tr = (r) => {
    if (r instanceof Node) return r;
    return h('tr', { class: [r.selected ? 'selected' : '', r.cls || ''].filter(Boolean).join(' ') || null, ...(r.data ? { 'data-id': r.data } : {}), ...(r.onClick ? { onclick: r.onClick } : {}) },
      ...r.cells.map((c, i) => {
        const o = c && typeof c === 'object' && !(c instanceof Node) && 'v' in c ? c : { v: c };
        const col = columns[i] || {};
        const check = o.v instanceof Node && o.v.tagName === 'INPUT' && o.v.getAttribute('type') === 'checkbox';
        const value = check ? h('label', { class: 'k-table-check', title: o.v.getAttribute('aria-label') }, o.v) : o.v;
        return h('td', { class: [col.num ? 'num right' : '', col.hide ? 'md-hide' : '', col.pic ? 'k-col-pic' : '', col.nowrap ? 'k-nowrap' : '', o.cls || col.cls || ''].filter(Boolean).join(' ') || null }, value);
      }));
  };
  return mark(h('div', { class: 'table-wrap k-table-wrap' + (maxHeight ? ' k-scroll-' + String(maxHeight).toLowerCase() : '') }, h('table', { class: 'list' + (clickable ? '' : ' k-static') + (cls ? ' ' + cls : ''), 'aria-label': label || null },
    h('thead', null, h('tr', null, ...columns.map(th))), h('tbody', null, ...rows.map(tr)), foot?.length ? h('tfoot', null, ...foot) : null)), 'table');
}
