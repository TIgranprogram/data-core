import { h } from '../../core/dom.js';
import { qty } from '../../core/format.js';
import { button } from './index.js';
import { toastError } from './toast.js';
import { patch } from '../../core/router.js';

/** Кнопки следующего шага в строке: делают дело на месте, список обновляется без моргания. */
export function rowActions(L, load, onChanged) {
  const one = (row, a) => button({ label: a.label, size: 'S', title: a.title, onClick: async (e) => {
    e.stopPropagation();
    const b = e.currentTarget; b.disabled = true;
    try { if (await a.run(row) !== false) { await load({ keep: true }); onChanged?.(); } } catch (ex) { toastError(ex); } finally { b.disabled = false; }
  } });
  return (row) => {
    const acts = [].concat(L.rowAction(row) || []).filter(Boolean);
    return acts.length ? h('span', { class: 'row-acts' }, acts.map((a) => one(row, a))) : null;
  };
}

/** Долгое нажатие на телефоне — вход в режим выбора (БЗ-9). */
export function longPress(enterBulkMode) {
  return (el, id) => {
    let tmr = null; let suppress = false;
    el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; suppress = false; tmr = setTimeout(() => { tmr = null; suppress = true; enterBulkMode(id); if (navigator.vibrate) navigator.vibrate(15); }, 350); });
    const cancel = () => { clearTimeout(tmr); tmr = null; };
    el.addEventListener('pointerup', cancel); el.addEventListener('pointercancel', () => { cancel(); suppress = false; });
    el.addEventListener('click', (ev) => { if (suppress) { suppress = false; ev.stopImmediatePropagation(); } }, true);
    el.addEventListener('contextmenu', (ev) => { if (suppress || tmr) ev.preventDefault(); }); // долгое нажатие — не меню выделения текста
  };
}

/** Галерея: карточки с фото по группам (ПС: паспорта по категориям). */
export function paintGallery({ galleryBox, rows, L, P, bindLong, bulkOn, pickBox, openOrPick }) {
  const groups = new Map();
  for (const r of rows) { const g = L.gallery.groupBy ? L.gallery.groupBy(r) : ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  const order = [...groups].sort((a, b) => (a[0] === L.gallery.lastGroup) - (b[0] === L.gallery.lastGroup)); // «Без категории» — в конце
  galleryBox.replaceChildren(...order.map(([g, items]) => h('section', { class: 'gal-group' },
    g ? h('h3', { class: 'gal-head' }, g, h('span', { class: 'gal-n' }, qty(items.length))) : null,
    h('div', { class: 'gal' }, ...items.map((row) => {
      const v = L.gallery.card(row);
      const card = h('button', { type: 'button', class: 'gcard' + (row.id === P.open ? ' selected' : ''), dataset: { id: row.id },
        onclick: () => openOrPick(row), title: v.title },
        v.pic ? h('img', { class: 'gc-pic', src: v.pic, alt: '', loading: 'lazy', decoding: 'async', onerror: (e) => e.target.replaceWith(h('div', { class: 'gc-pic gc-none' }, 'нет фото')) }) : h('div', { class: 'gc-pic gc-none' }, 'нет фото'),
        h('div', { class: 'gc-title' }, v.title), v.meta ? h('div', { class: 'gc-meta' }, v.meta) : null, v.price ? h('div', { class: 'gc-price' }, v.price) : null, v.badge || null);
      if (bindLong) bindLong(card, row.id);
      return bulkOn ? h('div', { class: 'gcard-wrap' }, card, h('label', { class: 'gc-pick', title: 'Отметить' }, pickBox(row))) : card;
    })))));
}

/** Обычные строки: таблица (с заголовками групп) и карточки на телефоне. */
export function paintRows({ rows, L, canAct, bulkOn, tbody, cards, pickBox, rowClick, openOrPick, bindLong, actionButton }) {
  const trs = [];
  let group = null;
  const span = L.columns.length + (L.rowAction ? 1 : 0) + (bulkOn ? 1 : 0);
  rows.forEach((row, i) => {
    if (L.groupBy) {
      const g = L.groupBy(row);
      if (g !== group) {
        group = g;
        const same = rows.filter((r) => L.groupBy(r) === g);
        trs.push(h('tr', { class: 'group-row' }, h('td', { colspan: span }, h('span', null, g), L.groupTotal ? L.groupTotal(same) : null)));
      }
    }
    const trCls = L.rowClass ? L.rowClass(row) : '';
    const tr = h('tr', { class: trCls || undefined, onclick: (e) => rowClick(row, e), dataset: { i: String(i) } },
      bulkOn ? h('td', { class: 'pick' }, pickBox(row)) : null,
      L.columns.map((c) => h('td', { class: c.cls || '' }, c.render ? c.render(row) : row[c.key] ?? '')));
    if (canAct) tr.append(h('td', { class: 'act' }, actionButton(row)));
    trs.push(tr);
  });
  tbody.replaceChildren(...trs);
  cards.replaceChildren(...rows.map((row) => {
    const li = h('li', { onclick: () => openOrPick(row) },
      bulkOn ? h('label', { class: 'pick-hit', title: 'Отметить', onclick: (e) => e.stopPropagation() }, pickBox(row)) : null,
      L.card.thumb ? L.card.thumb(row) : null,
      h('div', { class: 'c-main' }, h('div', { class: 'c-title' }, L.card.title(row)), h('div', { class: 'c-sub' }, L.card.sub(row))),
      h('div', { class: 'c-side' }, L.card.side ? L.card.side(row) : null));
    if (bindLong) bindLong(li, row.id);
    return li;
  }));
}

/** Пустой список: «ничего не найдено» при фильтрах или подсказка «записей пока нет» с кнопкой создания. */
export function emptyBlock({ L, P, active, sb, resetFilters, canCreate, onCreate }) {
  return active
    ? h('div', { class: 'state' }, h('div', null, P.q ? `По «${P.q}» ничего не найдено.` : 'Ничего не найдено.'),
      P.q ? h('button', { class: 'btn', type: 'button', onclick: () => { sb.set('', true); patch({ q: undefined, page: undefined }); } }, 'Сбросить поиск') : null,
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: resetFilters }, 'Сбросить всё'))
    : h('div', { class: 'state' }, h('div', null, L.emptyText || 'Записей пока нет.'), L.emptyHint ? h('p', { class: 'state-hint' }, L.emptyHint) : null,
      canCreate ? h('button', { class: 'btn btn-primary', type: 'button', onclick: onCreate }, '+ ' + (L.createLabel || 'Создать')) : null);
}
