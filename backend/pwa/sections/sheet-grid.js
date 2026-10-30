import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { go } from '../core/router.js';
import { toast, toastError } from '../ui/toast.js';
import { moveCell, reservedTable } from './pipe-grid.js';

/**
 * Экран «Листы» для роли «Лазер лист» (СМ.10): таблица как его Excel, без правой панели.
 * Блок — марка, строка — толщина и формат. Листы и примечание правятся прямо в ячейке, Enter сохраняет.
 */
const NOTE_PREFIX = /^Таблица учёта на [\d.]+:\s*/;
const ORDER = ['Ст3', 'AISI 304', 'AISI 430', 'АМг2', 'Оцинкованная сталь'];
const TONE = { 'Ст3': 'k-rect', 'AISI 304': 'k-steel', 'AISI 430': 'k-steel', 'АМг2': 'k-round' };
const sizeOf = (it) => (it.dims?.length && it.dims?.width ? `${it.dims.width}×${it.dims.length}` : '—');
const noteOf = (it) => String(it.notes || '').replace(NOTE_PREFIX, '');
const offcutsOf = (it) => (it.offcuts || []).map((o) => String(o.name || '').split(' — обрезок ')[1]).filter(Boolean).join(', ');

/** Позиции склада → блоки по марке: [{ title, grade, ribbed, rows: [item] }]. */
export function buildSheets(items) {
  const blocks = new Map();
  for (const it of items) {
    if (it.metal !== 'sheet' || it.offcutOf) continue;
    const grade = it.materialGrade || 'Без марки';
    const ribbed = /рифл/i.test(it.assortment || it.name || '');
    const key = `${grade}|${ribbed}`;
    const b = blocks.get(key) || { title: ribbed ? `${grade}, рифлёный` : grade, grade, ribbed, rows: [] };
    b.rows.push(it);
    blocks.set(key, b);
  }
  const rank = (b) => { const i = ORDER.indexOf(b.grade); return (i < 0 ? ORDER.length : i) * 2 + (b.ribbed ? 1 : 0); };
  const list = [...blocks.values()].sort((a, b) => rank(a) - rank(b));
  for (const b of list) b.rows.sort((x, y) => (x.dims?.thickness || 0) - (y.dims?.thickness || 0) || (x.dims?.length || 0) - (y.dims?.length || 0));
  return list;
}

/** Поле-ячейка: Enter и стрелки ходят по таблице, сохраняет при выходе из ячейки. */
function field(cls, label, start, save) {
  const input = h('input', { class: cls, value: start, 'aria-label': label, ...(cls === 'pg-in' ? { inputmode: 'decimal' } : {}) });
  let was = start;
  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', async () => {
    if (input.value.trim() === was) return;
    input.classList.add('saving');
    try {
      await save(input.value.trim());
      was = input.value = input.value.trim();
      input.classList.add('saved'); setTimeout(() => input.classList.remove('saved'), 900);
    } catch (e) { input.value = was; toastError(e, 'сохранить'); } finally { input.classList.remove('saving'); }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); moveCell(input, 0, 1); }
    else if (e.key === 'Escape') { input.value = was; input.blur(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); input.blur(); moveCell(input, 0, e.key === 'ArrowDown' ? 1 : -1); }
  });
  return input;
}

async function saveSheets(it, text) {
  const value = text === '' ? 0 : Number(text.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) { toast('Введите число', { error: true }); throw new Error('Введите число'); }
  await api('/stock/batch', { method: 'POST', body: { type: 'count', note: 'Таблица листов', lines: [{ materialId: it.materialId || it.id, qty: value, expected: it.quantity }] } });
  it.quantity = value;
}

function table(block, match) {
  const rows = block.rows.filter(match);
  if (!rows.length) return null;
  return h('section', { class: 'pg-block ' + (TONE[block.grade] || 'k-round') }, h('h2', { class: 'pg-title' }, block.title),
    h('table', { class: 'pg-table' },
      h('thead', null, h('tr', null, h('th', { class: 'pg-name' }, 'Толщина, мм'), h('th', { class: 'pg-for' }, 'Формат, мм'), h('th', null, 'Листов'), h('th', null, 'В брони'), h('th', { class: 'pg-for' }, 'Обрезки'), h('th', { class: 'pg-for' }, 'Примечание'))),
      h('tbody', null, ...rows.map((it) => h('tr', null,
        h('th', { class: 'pg-name', scope: 'row' }, qty(it.dims?.thickness ?? 0)), h('td', { class: 'pg-for' }, sizeOf(it)),
        h('td', { class: 'pg-c' }, field('pg-in', `Листов, ${it.name}`, String(it.quantity ?? 0), (v) => saveSheets(it, v))),
        h('td', { class: 'pg-held' }, it.reservedQty ? qty(it.reservedQty) : ''), h('td', { class: 'pg-for' }, offcutsOf(it)),
        h('td', { class: 'pg-c' }, field('pg-note', `Примечание, ${it.name}`, noteOf(it), (v) => api(`/stock/items/${it.materialId || it.id}`, { method: 'PATCH', body: { notes: v } }))))))));
}

export function mountSheetGrid() {
  let blocks = [], groups = [], byId = new Map(), q = '', only = '';
  const body = h('div', { class: 'pg-body' }, h('p', { class: 'muted' }, 'Загружаю листы…'));
  const paint = () => {
    const words = q.toLowerCase().replace(/[xх*]/g, '×').replace(',', '.').split(/\s+/).filter(Boolean);
    const text = (it) => `${it.materialGrade || ''} ${it.dims?.thickness ?? ''} ${sizeOf(it)}`.toLowerCase();
    const match = (it) => words.every((w) => text(it).includes(w)) && (!only || (only === 'in' ? it.quantity > 0 : !it.quantity));
    const list = [!q && !only ? reservedTable(groups, byId, (it) => `${it.materialGrade || ''} ${qty(it.dims?.thickness ?? 0)} мм, ${sizeOf(it)}`, 'листов') : null, ...blocks.map((b) => table(b, match))].filter(Boolean);
    body.replaceChildren(...(list.length ? list : [h('p', { class: 'muted' }, blocks.length ? 'Ничего не найдено. Очистите поиск или фильтр.' : 'Листов на складе пока нет.')]));
  };
  const chip = (value, label) => h('button', { type: 'button', class: 'chip' + (only === value ? ' active' : ''), onclick: () => { only = value; chips.replaceChildren(...chipList()); paint(); } }, label);
  const chipList = () => [chip('', 'Все'), chip('in', 'В наличии'), chip('none', 'Нет на складе')];
  const chips = h('div', { class: 'pg-chips' }, ...chipList());
  const search = h('input', { type: 'search', class: 'pg-search', placeholder: 'Ст3 3 или 304 1500', 'aria-label': 'Найти лист', oninput: (e) => { q = e.target.value.trim(); paint(); } });
  const load = async () => {
    const [r, res] = await Promise.all([api('/stock/items', { query: { limit: 10000, sort: 'name' } }), api('/stock/reservations').catch(() => ({ items: [] }))]);
    blocks = buildSheets(r.items || []);
    byId = new Map(blocks.flatMap((b) => b.rows).map((it) => [it.materialId || it.id, it]));
    groups = res.items || [];
    paint();
  };
  const el = h('div', { class: 'pg' },
    h('div', { class: 'pg-top' }, h('h1', null, 'Листы'), search, chips, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => go('movements') }, 'Журнал движений')),
    h('p', { class: 'hint' }, 'Впишите количество листов и нажмите Enter. Сохраняется сразу.'), body);
  load().catch((e) => toastError(e, 'загрузить листы'));
  return { el, reload: () => load().catch(() => {}), update: () => {} };
}
