import { h } from '../core/dom.js';
import { table, button, textInput } from '../ui/kit/index.js';
import { qty } from '../core/format.js';
import { stockPositionName, stockPositionCode } from '../core/stock-display.js';
import { inlineCountAllowed, stockCountCell, sectionValue } from './stock-dimension-columns.js';
import { gridField } from './stock-grid-input.js';
import { workerMaterialId, workerUnit, workerPipeBlocks, workerSheetBlocks, workerCreateContext, workerQuickReady } from './stock-worker-model.js';

const dimension = value => Number(value) > 0 ? qty(value) : 'Не указана';
const source = item => [stockPositionName(item), stockPositionCode(item) || item.article].filter(Boolean).join(' · ');
const stateText = item => Number(item.quantity) === 0 ? 'Нет в наличии' : Number(item.reservedQty) >= Number(item.quantity) ? 'Всё в брони' : 'В наличии';
const metadata = item => h('div', { class: 'pg-worker-meta' }, `Бронь ${qty(item.reservedQty || 0)} · свободно ${qty(item.free ?? Number(item.quantity || 0) - Number(item.reservedQty || 0))}`);

function quantity(item, { readOnly, saveCount, confirmation }, meta) {
  const unit = workerUnit(item), allowed = inlineCountAllowed(item);
  const status = h('div', { class: 'pg-worker-state', hidden: stateText(item) !== 'Всё в брони' }, stateText(item));
  const afterSave = () => {
    status.textContent = stateText(item);
    status.hidden = stateText(item) !== 'Всё в брони';
    node.classList.toggle('pg-worker-zero', Number(item.quantity) === 0);
    meta?.replaceChildren(metadata(item));
  };
  const confirmed = !readOnly && allowed && confirmation ? confirmation.quantityField(item, afterSave) : null;
  const field = confirmed?.input || gridField('pg-in', `Фактически, ${item.name}, ${unit}`, String(item.quantity ?? 0), async text => { await saveCount(item, text); afterSave(); }, readOnly || !allowed);
  field.dataset.workerKey = workerMaterialId(item) + ':count';
  const node = h('div', { class: 'pg-worker-quantity', title: source(item) }, allowed ? field : stockCountCell(item, field), status, confirmed?.box);
  node.classList.toggle('pg-worker-zero', Number(item.quantity) === 0);
  if (!(field instanceof HTMLInputElement)) field.classList.add('pg-worker-value');
  return node;
}

function pipeCell(item, options, collision, context, label) {
  if (!item) {
    if (options.readOnly) return h('td', { class: 'pg-c', 'aria-label': 'Материала нет' }, '—');
    // Контекст строки/столбца известен полностью: просим только количество, без формы.
    if (context && options.create?.quick && workerQuickReady(context, 'pipe')) {
      const error = h('div', { class: 'pg-worker-new-error', 'data-worker-entry-error': '1', role: 'status', hidden: true });
      const key = context.workerKey || 'new:' + label;
      const field = textInput({ value: options.create.draft(key).value, placeholder: '—', inputmode: 'decimal',
        onInput: () => options.create.remember(field.input),
        onEnter: () => options.create.quick(context, field.input) });
      const input = field.input;
      input.classList.add('pg-in', 'pg-worker-new');
      input.setAttribute('aria-label', 'Добавить трубу: ' + label);
      input.title = label;
      input.dataset.workerCreate = 'cell';
      input.dataset.workerKey = key;
      input.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); options.create.clear(input); error.hidden = true; input.blur(); }
      });
      return h('td', { class: 'pg-c', 'aria-label': 'Материала нет' }, input, error);
    }
    const create = button({ label: '—', kind: 'ghost', title: 'Добавить трубу: ' + label, onClick: event => options.create.open(context, event.currentTarget) });
    create.dataset.workerCreate = 'cell'; create.setAttribute('aria-label', 'Добавить трубу: ' + label);
    return h('td', { class: 'pg-c', 'aria-label': 'Материала нет' }, create);
  }
  const meta = h('div', null, metadata(item));
  meta.hidden = !Number(item.reservedQty);
  return h('td', { class: 'pg-c', 'data-material-id': workerMaterialId(item), title: source(item) },
    quantity(item, options, meta), meta,
    collision || item.offcutOf || item.sectionProfile?.state !== 'complete' ? h('div', { class: 'pg-worker-source' }, source(item)) : null,
    item.offcutOf ? h('div', { class: 'pg-worker-state' }, 'Обрезок') : null);
}

/** Сетка pg использует фабрику kit.table; специализированные размеры ограничены .pg-worker. */
function blockTable(title, columns, rows, cls, tone = '') {
  return h('section', { class: 'pg-block' + (tone ? ' ' + tone : '') }, h('h2', { class: 'pg-title' }, title),
    table({ label: title, cls: 'pg-table ' + cls, columns, rows }));
}
export function pipeWorkerGrid(items, options) {
  return workerPipeBlocks(items).map(block => {
    const title = [block.title, block.grade !== 'Марка не указана' ? block.grade : '', `остаток, ${block.unit}`].filter(Boolean).join(' · ');
    const columns = [{ label: 'Сечение, мм', cls: 'pg-name' }, ...block.columns.map(column => ({
      cls: column.washed === true ? 'k-washed' : column.washed === false ? 'k-raw' : '',
      label: h('div', null, h('div', null, column.label), h('div', null, column.length ? `${qty(column.length / 1000)} м` : 'Длина не указана')),
    }))];
    const rows = block.rows.flatMap(row => {
      const variants = [...row.cells.values()];
      const details = options.details.rowDetail({ ...options, key: 'pipe:' + variants.map(workerMaterialId).sort().join('|'), label: sectionValue(row.source), items: variants, columns: columns.length, kind: 'pipe' });
      return [h('tr', null,
        h('th', { class: 'pg-name', scope: 'row' }, details.toggle, row.collision ? h('div', { class: 'pg-worker-source' }, 'Отдельные материалы') : null),
        ...block.columns.map(column => {
          const context = { ...workerCreateContext(row.source, column), workerKey: 'new:' + workerMaterialId(row.source) + ':' + column.key };
          const label = `${row.source.sectionProfile?.label || row.source.name} · ${column.label} · ${column.length ? qty(column.length / 1000) + ' м' : 'длина не указана'}`;
          return pipeCell(row.cells.get(column.key), options, row.collision, context, label);
        })), details.detail];
    });
    return blockTable(title, columns, rows, 'pg-worker-pipe', { rect: 'k-rect', round: 'k-round', steel: 'k-steel', unknown: 'k-round' }[block.kind]);
  });
}

export function sheetWorkerGrid(items, options) {
  return workerSheetBlocks(items).map(block => {
    const title = `${block.grade} · ${block.surface} · остаток, ${block.unit}`;
    const columns = ['Толщина, мм', 'Формат, мм', `Фактически, ${block.unit}`, `В брони, ${block.unit}`, `Свободно, ${block.unit}`, 'Примечание'].map(label => ({ label }));
    const rows = block.rows.flatMap(item => {
      const held = h('span', null, qty(item.reservedQty || 0)), free = h('span', null, qty(item.free ?? Number(item.quantity || 0) - Number(item.reservedQty || 0)));
      const values = { ...options, saveCount: async (record, text) => { await options.saveCount(record, text); held.textContent = qty(item.reservedQty || 0); free.textContent = qty(item.free ?? Number(item.quantity || 0) - Number(item.reservedQty || 0)); } };
      const note = gridField('pg-note', `Примечание, ${item.name}`, item.notes || '', value => options.saveNote(item, value), options.readOnly);
      note.dataset.workerKey = workerMaterialId(item) + ':note';
      const details = options.details.rowDetail({ ...options, key: 'sheet:' + workerMaterialId(item), label: dimension(item.dims?.thickness), items: [item], columns: columns.length, kind: 'sheet' });
      return [h('tr', { 'data-material-id': workerMaterialId(item), 'data-id': workerMaterialId(item) },
        h('th', { class: 'pg-name', scope: 'row' }, details.toggle),
        h('td', { class: 'pg-for', title: source(item) }, h('div', null, `${dimension(item.dims?.width)} × ${dimension(item.dims?.length)}`), item.offcutOf ? h('div', { class: 'pg-worker-state' }, 'Обрезок') : null),
        h('td', { class: 'pg-c' }, quantity(item, values)), h('td', { class: 'pg-sum' }, held), h('td', { class: 'pg-sum' }, free), h('td', { class: 'pg-c' }, note)), details.detail];
    });
    return blockTable(title, columns, rows, 'pg-worker-sheet');
  });
}
