import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { PIPE_KINDS, facetLabel, pipeKey, pipeParts } from '../core/facets.js';
import { qty } from '../core/format.js';
import { go } from '../core/router.js';
import { toast, toastError } from '../ui/toast.js';

/**
 * Экран «Трубы» для роли «Трубарез» (СМ.5): таблица как его Excel, без правой панели.
 * Строка — сечение, столбец — мойка и длина, в ячейке штуки. Вписал число, Enter — остаток сохранён (пересчёт), «Итого, м» считается сразу.
 * Пустая ячейка без позиции — позиция создаётся при первом вводе. Стрелки, Enter и Tab ходят по ячейкам.
 */
const BLACK = [{ washed: true, m: 6 }, { washed: true, m: 12 }, { washed: false, m: 6 }, { washed: false, m: 12 }];
const STEEL = [{ m: 2 }, { m: 3 }, { m: 4 }, { m: 6 }, { m: 0 }]; // 0 — куски, в метрах
const CATEGORY = { rect: 'Профильная труба', round: 'Круглая труба' };

const colsOf = (kind) => (kind === 'steel' ? STEEL : BLACK);
const cellKey = (c) => `${c.washed == null ? '' : c.washed ? 'w' : 'r'}${c.m}`;
const sizes = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(',', '.')));
const bySize = (a, b) => { const x = sizes(a.section), y = sizes(b.section); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };

/** Позиции склада → блоки таблицы: [{ kind, title, rows: [{ section, label, dims, categoryName, cells: { 'w6': item } }] }]. */
export function buildGrid(items) {
  const rows = new Map();
  for (const it of items) {
    if (it.metal !== 'pipe' || !it.assortment || it.offcutOf) continue;
    const { kind, section } = pipeParts(pipeKey(it));
    const key = `${kind}|${section}`;
    const row = rows.get(key) || { kind, section, label: facetLabel('section', section), dims: it.dims || {}, categoryName: it.categoryName, cells: {} };
    row.cells[cellKey({ washed: kind === 'steel' ? undefined : it.washed ?? false, m: (it.dims?.length || 0) / 1000 })] = it;
    rows.set(key, row);
  }
  return PIPE_KINDS.map(([kind, title]) => ({ kind, title, rows: [...rows.values()].filter((r) => r.kind === kind).sort(bySize) })).filter((b) => b.rows.length);
}

const left = (l) => Math.max(0, (l.qty || 0) - (l.issued || 0));
const rowMeters = (row) => Object.values(row.cells).reduce((s, it) => s + (it.quantity || 0), 0);
const pieces = (it, c) => (!it ? '' : c.m ? String(Math.round((it.quantity / c.m) * 100) / 100) : String(it.quantity));

/** Новая позиция для пустой ячейки — название и размеры как у соседних. */
function newItem(row, c) {
  const nerj = row.kind === 'steel';
  const word = row.kind === 'round' || row.dims.diameter ? 'круглая' : 'профильная';
  const wash = c.washed == null ? '' : c.washed ? 'мытая' : 'не мытая';
  const { thickness, diameter } = row.dims;
  return {
    name: [`Труба ${word} ${nerj ? 'нерж. ' : ''}${row.label}`, wash, c.m ? `${c.m} м` : 'куски'].filter(Boolean).join(', '),
    unit: 'м', categoryName: row.categoryName || CATEGORY[row.kind], assortment: row.section, ...(nerj ? { materialGrade: 'Нержавеющая сталь' } : { washed: c.washed }),
    dims: { ...(thickness ? { thickness } : {}), ...(diameter ? { diameter } : {}), ...(c.m ? { length: c.m * 1000 } : {}) },
  };
}

/** Сохранить ячейку: метры = штуки × длина; пересчёт, чтобы старое значение проверялось на сервере. */
async function saveCell(row, c, value) {
  const metres = Math.round(value * (c.m || 1) * 1000) / 1000;
  let it = row.cells[cellKey(c)];
  if (!it) { it = { ...(await api('/stock/items', { method: 'POST', body: newItem(row, c) })), quantity: 0 }; row.cells[cellKey(c)] = it; }
  await api('/stock/batch', { method: 'POST', body: { type: 'count', note: 'Таблица труб', lines: [{ materialId: it.materialId || it.id, qty: metres, expected: it.quantity }] } });
  it.quantity = metres;
}

function move(input, dx, dy) {
  const td = input.closest('td'), tr = td.parentElement;
  const rows = [...tr.closest('.pg').querySelectorAll('tbody tr')];
  const next = rows[rows.indexOf(tr) + dy]?.children[td.cellIndex + dx] || (dy ? null : tr.children[td.cellIndex + dx]);
  const el = next?.querySelector('input');
  if (el) { el.focus(); el.select(); }
}

function cell(row, c, onSaved) {
  const it = row.cells[cellKey(c)];
  const input = h('input', { class: 'pg-in', inputmode: 'decimal', value: pieces(it, c), 'aria-label': `${row.label}, ${c.washed == null ? '' : c.washed ? 'мытая, ' : 'не мытая, '}${c.m ? c.m + ' м' : 'куски'}` });
  let was = input.value;
  const commit = async () => {
    const text = input.value.trim().replace(',', '.');
    if (text === was.replace(',', '.')) return;
    const value = text === '' ? 0 : Number(text);
    if (!Number.isFinite(value) || value < 0) { input.value = was; toast('Введите число', { error: true }); return; }
    input.classList.add('saving');
    try {
      await saveCell(row, c, value);
      was = input.value = value || !row.cells[cellKey(c)] ? String(value || '') : '0';
      onSaved();
      input.classList.add('saved'); setTimeout(() => input.classList.remove('saved'), 900);
    } catch (e) { input.value = was; toastError(e, 'сохранить'); } finally { input.classList.remove('saving'); }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('focus', () => input.select());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); move(input, 0, 1); }
    else if (e.key === 'Escape') { input.value = was; input.blur(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); input.blur(); move(input, 0, e.key === 'ArrowDown' ? 1 : -1); }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && input.selectionStart === (e.key === 'ArrowRight' ? input.value.length : 0)) { e.preventDefault(); input.blur(); move(input, e.key === 'ArrowRight' ? 1 : -1, 0); }
  });
  const held = it?.reservedQty > 0 ? h('div', { class: 'pg-held', title: 'Отложено под бронь' }, `бронь ${qty(it.reservedQty)} м`) : null;
  return h('td', { class: 'pg-c ' + (c.washed == null ? '' : c.washed ? 'k-washed' : 'k-raw') }, input, held);
}

function table(block, match) {
  const cols = colsOf(block.kind);
  const rows = block.rows.filter(match);
  if (!rows.length) return null;
  const foot = h('td', { class: 'pg-sum' });
  const sumAll = () => { foot.textContent = qty(rows.reduce((s, r) => s + rowMeters(r), 0)); };
  const head = block.kind === 'steel'
    ? [h('tr', null, h('th', { class: 'pg-name' }, 'Сечение'), ...cols.map((c) => h('th', null, c.m ? `${c.m} м, шт` : 'Куски, м')), h('th', null, 'Итого, м'))]
    : [h('tr', null, h('th', { class: 'pg-name', rowspan: 2 }, 'Сечение'), h('th', { colspan: 2, class: 'k-washed' }, 'Мытая'), h('th', { colspan: 2, class: 'k-raw' }, 'Не мытая'), h('th', { rowspan: 2 }, 'Итого, м')),
      h('tr', null, ...cols.map((c) => h('th', { class: c.washed ? 'k-washed' : 'k-raw' }, `${c.m} м, шт`)))];
  sumAll();
  return h('section', { class: 'pg-block k-' + block.kind }, h('h2', { class: 'pg-title' }, block.title),
    h('table', { class: 'pg-table' }, h('thead', null, ...head),
      h('tbody', null, ...rows.map((row) => {
        const sum = h('td', { class: 'pg-sum' }, qty(rowMeters(row)));
        return h('tr', null, h('th', { class: 'pg-name', scope: 'row' }, row.label), ...cols.map((c) => cell(row, c, () => { sum.textContent = qty(rowMeters(row)); sumAll(); })), sum);
      })),
      h('tfoot', null, h('tr', null, h('th', { class: 'pg-name', colspan: cols.length + 1 }, 'Всего, м'), foot))));
}

/** Брони труб одной таблицей: что, сколько, для чего, кто поставил. */
function reservedTable(groups, byId) {
  const rows = groups.flatMap((g) => g.lines.filter((l) => byId.has(l.materialId) && left(l) > 0).map((l) => ({ l, g, it: byId.get(l.materialId) })));
  if (!rows.length) return null;
  const pipe = (it) => [facetLabel('pipe', pipeKey(it)), it.washed == null ? '' : it.washed ? 'мытая' : 'не мытая'].filter(Boolean).join(' · ');
  return h('section', { class: 'pg-block pg-reserved' }, h('h2', { class: 'pg-title' }, `В брони: ${rows.length}`),
    h('table', { class: 'pg-table' }, h('thead', null, h('tr', null, h('th', { class: 'pg-name' }, 'Труба'), h('th', null, 'Сколько, м'), h('th', { class: 'pg-for' }, 'Для чего'), h('th', { class: 'pg-for' }, 'Поставил'))),
      h('tbody', null, ...rows.map(({ l, g, it }) => h('tr', null, h('th', { class: 'pg-name', scope: 'row' }, pipe(it)), h('td', { class: 'pg-sum' }, qty(left(l))), h('td', { class: 'pg-for' }, g.salesOrder || g.name), h('td', { class: 'pg-for' }, g.createdBy || ''))))));
}

export function mountPipeGrid() {
  let blocks = [], groups = [], byId = new Map(), q = '', only = '';
  const body = h('div', { class: 'pg-body' }, h('p', { class: 'muted' }, 'Загружаю трубы…'));
  const paint = () => {
    const words = q.toLowerCase().replace(/[xх*]/g, '×').split(/\s+/).filter(Boolean);
    const match = (r) => words.every((w) => r.label.toLowerCase().includes(w)) && (!only || (only === 'in' ? rowMeters(r) > 0 : rowMeters(r) === 0));
    const list = [!q && !only ? reservedTable(groups, byId) : null, ...blocks.map((b) => table(b, match))].filter(Boolean);
    body.replaceChildren(...(list.length ? list : [h('p', { class: 'muted' }, blocks.length ? 'Ничего не найдено. Очистите поиск или фильтр.' : 'Труб на складе пока нет.')]));
  };
  const chip = (value, label) => h('button', { type: 'button', class: 'chip' + (only === value ? ' active' : ''), onclick: () => { only = value; chips.replaceChildren(...chipList()); paint(); } }, label);
  const chipList = () => [chip('', 'Все'), chip('in', 'В наличии'), chip('none', 'Нет на складе')];
  const chips = h('div', { class: 'pg-chips' }, ...chipList());
  const search = h('input', { type: 'search', class: 'pg-search', placeholder: '80×80×3', 'aria-label': 'Найти сечение', oninput: (e) => { q = e.target.value.trim(); paint(); } });
  const load = async () => {
    const [r, res] = await Promise.all([api('/stock/items', { query: { limit: 10000, sort: 'name' } }), api('/stock/reservations').catch(() => ({ items: [] }))]);
    blocks = buildGrid(r.items || []);
    byId = new Map(blocks.flatMap((b) => b.rows.flatMap((row) => Object.values(row.cells))).map((it) => [it.materialId || it.id, it]));
    groups = res.items || [];
    paint();
  };
  const el = h('div', { class: 'pg' },
    h('div', { class: 'pg-top' }, h('h1', null, 'Трубы'), search, chips, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => go('movements') }, 'Журнал движений')),
    h('p', { class: 'hint' }, 'Впишите штуки в ячейку и нажмите Enter. Сохраняется сразу.'), body);
  load().catch((e) => toastError(e, 'загрузить трубы'));
  return { el, reload: () => load().catch(() => {}), update: () => {} };
}
