import { h } from '../core/dom.js';
import { table, section } from '../ui/kit/index.js';
import { qty } from '../core/format.js';
import { stockPositionName, stockPositionCode } from '../core/stock-display.js';
import { inlineCountAllowed, stockCountCell, sectionValue } from './stock-dimension-columns.js';
import { gridField } from './stock-grid-input.js';
import { workerMaterialId, workerUnit, workerPipeBlocks, workerSheetBlocks } from './stock-worker-model.js';

const dimension = value => Number(value) > 0 ? qty(value) : 'Не указана';
const source = item => [stockPositionName(item), stockPositionCode(item) || item.article].filter(Boolean).join(' · ');
const stateText = item => Number(item.quantity) === 0 ? 'Нет в наличии' : Number(item.reservedQty) >= Number(item.quantity) ? 'Всё в брони' : 'В наличии';
const identity = item => h('span', { class: 'pg-worker-source', title: source(item) }, source(item));
const metadata = item => h('div', { class: 'pg-worker-meta' }, `Бронь ${qty(item.reservedQty || 0)} · свободно ${qty(item.free ?? Number(item.quantity || 0) - Number(item.reservedQty || 0))}`);

function quantity(item, { readOnly, saveCount }, meta) {
  const unit = workerUnit(item), allowed = inlineCountAllowed(item);
  const status = h('div', { class: 'pg-worker-state', hidden: stateText(item) === 'В наличии' }, stateText(item));
  const field = gridField('pg-in', `Фактически, ${item.name}, ${unit}`, String(item.quantity ?? 0), async text => {
    await saveCount(item, text);
    status.textContent = stateText(item);
    status.hidden = stateText(item) === 'В наличии';
    meta?.replaceChildren(metadata(item));
  }, readOnly || !allowed);
  field.dataset.workerKey = workerMaterialId(item) + ':count';
  const node = h('div', { class: 'pg-worker-quantity', title: source(item) }, allowed ? field : stockCountCell(item, field), status);
  if (!(field instanceof HTMLInputElement)) field.classList.add('pg-worker-value');
  return node;
}

function pipeCell(item, options, collision) {
  if (!item) return h('td', { class: 'pg-c', 'aria-label': 'Материала нет' }, '—');
  const meta = h('div', null, metadata(item));
  meta.hidden = !Number(item.reservedQty);
  const note = gridField('pg-note', `Примечание, ${item.name}`, item.notes || '', value => options.saveNote(item, value), options.readOnly);
  note.dataset.workerKey = workerMaterialId(item) + ':note';
  return h('td', { class: 'pg-c', 'data-material-id': workerMaterialId(item), title: source(item) },
    quantity(item, options, meta), meta,
    collision || item.offcutOf || item.sectionProfile?.state !== 'complete' ? h('div', { class: 'pg-worker-source' }, source(item)) : null,
    item.offcutOf ? h('div', { class: 'pg-worker-state' }, 'Обрезок') : null,
    section({ title: 'Подробнее', plain: true, cls: 'pg-worker-more', body: [identity(item), metadata(item), note] }));
}

/** Сетка pg использует фабрику kit.table; специализированные размеры ограничены .pg-worker. */
function blockTable(title, columns, rows, cls, tone = '') {
  return h('section', { class: 'pg-block' + (tone ? ' ' + tone : '') }, h('h2', { class: 'pg-title' }, title),
    table({ label: title, cls: 'pg-table ' + cls, columns, rows }));
}
export function pipeWorkerGrid(items, options) {
  return workerPipeBlocks(items).map(block => {
    const title = `${block.title} · ${block.grade} · остаток, ${block.unit}`;
    const columns = [{ label: 'Сечение, мм', cls: 'pg-name' }, ...block.columns.map(column => ({
      cls: column.washed === true ? 'k-washed' : column.washed === false ? 'k-raw' : '',
      label: h('div', null, h('div', null, column.label), h('div', null, column.length ? `${qty(column.length / 1000)} м` : 'Длина не указана'), h('small', null, `Остаток, ${block.unit}`)),
    }))];
    const rows = block.rows.map(row => h('tr', null,
      h('th', { class: 'pg-name', scope: 'row' }, sectionValue(row.source), row.collision ? h('div', { class: 'pg-worker-source' }, 'Отдельные материалы') : null),
      ...block.columns.map(column => pipeCell(row.cells.get(column.key), options, row.collision))));
    return blockTable(title, columns, rows, 'pg-worker-pipe', { rect: 'k-rect', round: 'k-round', steel: 'k-steel', unknown: 'k-round' }[block.kind]);
  });
}

export function sheetWorkerGrid(items, options) {
  return workerSheetBlocks(items).map(block => {
    const title = `${block.grade} · ${block.surface} · остаток, ${block.unit}`;
    const columns = ['Толщина, мм', 'Формат, мм', `Фактически, ${block.unit}`, `В брони, ${block.unit}`, `Свободно, ${block.unit}`, 'Примечание'].map(label => ({ label }));
    const rows = block.rows.map(item => {
      const held = h('span', null, qty(item.reservedQty || 0)), free = h('span', null, qty(item.free ?? Number(item.quantity || 0) - Number(item.reservedQty || 0)));
      const values = { ...options, saveCount: async (record, text) => { await options.saveCount(record, text); held.textContent = qty(item.reservedQty || 0); free.textContent = qty(item.free ?? Number(item.quantity || 0) - Number(item.reservedQty || 0)); } };
      const note = gridField('pg-note', `Примечание, ${item.name}`, item.notes || '', value => options.saveNote(item, value), options.readOnly);
      note.dataset.workerKey = workerMaterialId(item) + ':note';
      return h('tr', { 'data-material-id': workerMaterialId(item), 'data-id': workerMaterialId(item) },
        h('th', { class: 'pg-name', scope: 'row' }, dimension(item.dims?.thickness)),
        h('td', { class: 'pg-for' }, h('div', null, `${dimension(item.dims?.width)} × ${dimension(item.dims?.length)}`), item.offcutOf ? h('div', { class: 'pg-worker-state' }, 'Обрезок') : null,
          section({ title: 'Подробнее', plain: true, cls: 'pg-worker-more', body: identity(item) })),
        h('td', { class: 'pg-c' }, quantity(item, values)), h('td', { class: 'pg-sum' }, held), h('td', { class: 'pg-sum' }, free), h('td', { class: 'pg-c' }, note));
    });
    return blockTable(title, columns, rows, 'pg-worker-sheet');
  });
}
