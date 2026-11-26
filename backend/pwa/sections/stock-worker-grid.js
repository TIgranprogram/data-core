import { h } from '../core/dom.js';
import { table, button } from '../ui/kit/index.js';
import { qty } from '../core/format.js';
import { stockPositionName, stockPositionCode } from '../core/stock-display.js';
import { inlineCountAllowed, stockCountCell, stockCountRestriction, sectionValue } from './stock-dimension-columns.js';
import { gridField } from './stock-grid-input.js';
import { workerMaterialId, workerUnit, workerPipeBlocks, workerSheetBlocks, workerCreateContext, workerQuickReady, workerPieceFactor, workerQuantityText } from './stock-worker-model.js';

const dimension = value => Number(value) > 0 ? qty(value) : 'Не указана';
const source = item => [stockPositionName(item), stockPositionCode(item) || item.article].filter(Boolean).join(' · ');
const stateText = item => Number(item.quantity) === 0 ? 'Нет в наличии' : Number(item.reservedQty) >= Number(item.quantity) ? 'Всё в брони' : 'В наличии';
const metalNames = { ordinary: 'Обычная сталь', stainless: 'Нержавеющая сталь', unknown: 'Металл не уточнён' };
const metalTones = { ordinary: 'k-round', stainless: 'k-steel' };

function sheetQuantity(item, { readOnly, confirmation }) {
  const status = h('div', { class: 'pg-worker-state', hidden: stateText(item) !== 'Всё в брони' }, stateText(item));
  const afterSave = () => {
    status.textContent = stateText(item);
    status.hidden = stateText(item) !== 'Всё в брони';
    node.classList.toggle('pg-worker-zero', Number(item.quantity) === 0);
  };
  const locked = readOnly || !inlineCountAllowed(item);
  const confirmed = locked ? null : confirmation.quantityField(item, afterSave);
  const field = confirmed?.input || gridField('pg-in', `Фактически, ${item.name}, ${workerUnit(item)}`, workerQuantityText(item, 'sheet'), null, true);
  field.dataset.workerKey = workerMaterialId(item) + ':count';
  const node = h('div', { class: 'pg-worker-quantity', title: source(item) }, stockCountCell(item, field), status, confirmed?.box);
  node.classList.toggle('pg-worker-zero', Number(item.quantity) === 0);
  if (!(field instanceof HTMLInputElement)) field.classList.add('pg-worker-value');
  return node;
}

function wholePieces(input, placeholder) {
  input.inputMode = 'numeric';
  input.pattern = '[0-9]*';
  input.placeholder = placeholder;
  input.addEventListener('beforeinput', event => {
    if (event.data && /\D/.test(event.data)) event.preventDefault();
  });
  input.addEventListener('paste', event => {
    if (/\D/.test(event.clipboardData?.getData('text') || '')) event.preventDefault();
  });
}

function pipeCell(item, options, context, label) {
  if (!item) {
    if (options.readOnly || !context) return h('td', { class: 'pg-c', 'aria-label': 'Материала нет' }, '—');
    // Контекст строки/столбца известен полностью: просим только количество, без формы.
    if (options.create?.quick && workerQuickReady(context, 'pipe')) {
      const error = h('div', { class: 'pg-worker-new-error', 'data-worker-entry-error': '1', role: 'status', hidden: true });
      const key = context.workerKey || 'new:' + label;
      const input = gridField('pg-in', 'Добавить трубы, шт: ' + label, '', async text => {
        error.hidden = true;
        await options.create.quick(context, input, text);
        input.value = '';
      }, false, { onSaveError(failure) { error.textContent = failure.message; error.hidden = false; } });
      wholePieces(input, '—');
      input.classList.add('pg-worker-new');
      input.title = label;
      input.dataset.workerCreate = 'cell';
      input.dataset.workerKey = key;
      input.addEventListener('input', () => { error.hidden = true; });
      input.addEventListener('keydown', event => {
        if (event.key === 'Escape') { options.create.clear(input); error.hidden = true; }
      });
      return h('td', { class: 'pg-c', 'aria-label': 'Материала нет' }, input, error);
    }
    const create = button({ label: '—', kind: 'ghost', title: 'Добавить трубу: ' + label, onClick: event => options.create.open(context, event.currentTarget) });
    create.dataset.workerCreate = 'cell'; create.setAttribute('aria-label', 'Добавить трубу: ' + label);
    return h('td', { class: 'pg-c', 'aria-label': 'Материала нет' }, create);
  }
  const supported = workerPieceFactor(item) != null;
  const restriction = stockCountRestriction(item) || (!supported ? 'Не указана длина или единица учёта' : '');
  const locked = options.readOnly || Boolean(restriction);
  const name = [item.name, restriction].filter(Boolean).join('. ');
  const field = gridField('pg-in', `Фактически, ${name}, шт`, workerQuantityText(item, 'pipe'), async text => {
    await options.saveCount(item, text);
    field.value = workerQuantityText(item, 'pipe');
    amount.classList.toggle('pg-worker-zero', Number(item.quantity) === 0);
  }, locked);
  if (locked) field.classList.add('pg-worker-value');
  else wholePieces(field, '—');
  field.dataset.workerKey = workerMaterialId(item) + ':count';
  const amount = h('div', { class: 'pg-worker-quantity' }, field);
  amount.classList.toggle('pg-worker-zero', Number(item.quantity) === 0);
  return h('td', { class: 'pg-c', 'data-material-id': workerMaterialId(item), title: [source(item), restriction].filter(Boolean).join('. ') }, amount);
}

/** Сетка pg использует фабрику kit.table; специализированные размеры ограничены .pg-worker. */
function blockTable(title, columns, rows, cls, tone = '') {
  return h('section', { class: 'pg-block' + (tone ? ' ' + tone : '') }, h('h2', { class: 'pg-title' }, title),
    table({ label: title, cls: 'pg-table ' + cls, columns, rows }));
}
export function pipeWorkerGrid(items, options) {
  return workerPipeBlocks(items).map(block => {
    const title = [metalNames[block.metal], block.title, block.grade !== 'Марка не указана' ? block.grade : '', 'остаток, шт'].filter(Boolean).join(' · ');
    const columns = [{ label: 'Сечение, мм', cls: 'pg-name' }, ...block.columns.map(column => ({
      cls: column.washed === true ? 'k-washed' : column.washed === false ? 'k-raw' : '',
      label: h('div', null, h('div', null, column.label), h('div', null, column.length ? `${qty(column.length / 1000)} м` : 'Длина не указана')),
    }))];
    const rows = block.rows.flatMap(row => {
      const variants = [...row.cells.values()];
      const details = options.details.rowDetail({ ...options, key: 'pipe:' + variants.map(workerMaterialId).sort().join('|'), label: sectionValue(row.source), items: variants, columns: columns.length, kind: 'pipe', distinguish: row.collision });
      const canCreate = !row.collision && !row.source.offcutOf && variants.every(item => item.categoryId === row.source.categoryId);
      return [h('tr', null,
        h('th', { class: 'pg-name', scope: 'row' }, details.toggle, row.source.offcutOf || row.collision
          ? h('div', { class: 'pg-worker-source' }, row.source.offcutOf ? 'Обрезок' : 'Совпадает сечение') : null),
        ...block.columns.map(column => {
          const context = canCreate ? { ...workerCreateContext(row.source, column), workerKey: 'new:' + workerMaterialId(row.source) + ':' + column.key } : null;
          const label = `${row.source.sectionProfile?.label || row.source.name} · ${column.label} · ${column.length ? qty(column.length / 1000) + ' м' : 'длина не указана'}`;
          return pipeCell(row.cells.get(column.key), options, context, label);
        })), details.detail];
    });
    return blockTable(title, columns, rows, 'pg-worker-pipe', metalTones[block.metal]);
  });
}

export function sheetWorkerGrid(items, options) {
  return workerSheetBlocks(items).map(block => {
    const grade = block.grade !== 'Марка не указана' ? block.grade : '';
    const title = [metalNames[block.metal], grade, block.surface, `остаток, ${block.unit}`].filter(Boolean).join(' · ');
    const columns = ['Толщина, мм', 'Формат, мм', `Фактически, ${block.unit}`, `В брони, ${block.unit}`, `Свободно, ${block.unit}`, 'Примечание'].map(label => ({ label }));
    const rows = block.rows.flatMap(item => {
      const held = h('span', null, qty(item.reservedQty || 0)), free = h('span', null, qty(item.free ?? Number(item.quantity || 0) - Number(item.reservedQty || 0)));
      const note = gridField('pg-note', `Примечание, ${item.name}`, item.notes || '', value => options.saveNote(item, value), options.readOnly);
      note.dataset.workerKey = workerMaterialId(item) + ':note';
      const details = options.details.rowDetail({ ...options, key: 'sheet:' + workerMaterialId(item), label: dimension(item.dims?.thickness), items: [item], columns: columns.length, kind: 'sheet' });
      return [h('tr', { 'data-material-id': workerMaterialId(item), 'data-id': workerMaterialId(item) },
        h('th', { class: 'pg-name', scope: 'row' }, details.toggle),
        h('td', { class: 'pg-for', title: source(item) }, h('div', null, `${dimension(item.dims?.width)} × ${dimension(item.dims?.length)}`), item.offcutOf ? h('div', { class: 'pg-worker-state' }, 'Обрезок') : null),
        h('td', { class: 'pg-c' }, sheetQuantity(item, options)), h('td', { class: 'pg-sum' }, held), h('td', { class: 'pg-sum' }, free), h('td', { class: 'pg-c' }, note)), details.detail];
    });
    return blockTable(title, columns, rows, 'pg-worker-sheet', metalTones[block.metal]);
  });
}
