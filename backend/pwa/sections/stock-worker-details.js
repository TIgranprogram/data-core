import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { dateTime, qty } from '../core/format.js';
import { stockPositionCode, stockPositionName } from '../core/stock-display.js';
import { viewAsActive } from '../core/view-as.js';
import { button, section, stack, stats, table, busyBlock, failBlock } from '../ui/kit/index.js';
import { gridField } from './stock-grid-input.js';
import { workerMaterialId, workerUnit, workerWash, workerLength, workerPipeMetres } from './stock-worker-model.js';
import { workerHistory, workerOperationGroups } from './stock-worker-history.js';
import { workerStockContext } from './stock-worker-context.js';
import { workerContextView } from './stock-worker-context-view.js';

let nextId = 0;
const operationNames = { in: 'Приход', out: 'Списание', adjust: 'Корректировка', count: 'Пересчёт', transfer: 'Перемещение', reserve: 'Бронь', unreserve: 'Снятие брони' };
const value = text => text === undefined || text === null || text === '' ? 'Не указано' : String(text);
const variant = (kind, item) => kind === 'pipe'
  ? `${workerWash(item)} · ${workerLength(item) ? qty(workerLength(item) / 1000) + ' м' : 'Длина не указана'}`
  : `${item.dims?.thickness ? qty(item.dims.thickness) + ' мм' : 'Толщина не указана'} · ${item.dims?.width ? qty(item.dims.width) : '?'} × ${item.dims?.length ? qty(item.dims.length) : '?'} мм`;

function operations(response, unit) {
  if (!response.items?.length) return h('p', { class: 'hint' }, 'Операций пока нет.');
  return stack(...workerOperationGroups(response.items).map(group => {
    const noAuthor = group.items.every(operation => !operation.authorName && !operation.createdByName);
    const source = group.items[0].source;
    const commonSource = source && group.items.every(operation => operation.source === source) ? source : null;
    return h('div', { class: 'pg-worker-operation-group' },
      h('h3', { class: 'pg-worker-category' }, operationNames[group.type] || value(group.type)),
      table({ cls: 'pg-worker-operation-matrix', label: operationNames[group.type] || 'Операции', columns: [
        { label: 'Дата / время', cls: 'pg-worker-op-date' }, { label: 'Количество', cls: 'pg-worker-op-qty' }, { label: 'Примечание', wrap: true },
      ], rows: group.items.map(operation => ({ cells: [
        h('small', { class: 'pg-worker-secondary' }, operation.date ? dateTime(operation.date) : 'Дата не указана'),
        h('strong', null, `${qty(operation.qty)} ${unit}`),
        stack(h('span', null, operation.note || '—'),
          operation.issuedTo ? h('small', { class: 'pg-worker-secondary' }, 'Кому: ' + operation.issuedTo) : null,
          !noAuthor ? h('small', { class: 'pg-worker-secondary' }, 'Автор: ' + value(operation.authorName || operation.createdByName)) : null,
          operation.source && !commonSource ? h('small', { class: 'pg-worker-secondary' }, 'Источник: ' + operation.source) : null),
      ] })) }),
      noAuthor || commonSource ? h('small', { class: 'pg-worker-secondary' }, noAuthor ? 'Автор не указан' : '', noAuthor && commonSource ? ' · ' : '', commonSource ? 'Источник: ' + commonSource : '') : null);
  }));
}

/** Состояние подробностей принадлежит экземпляру рабочего экрана, не модулю/браузеру. */
export function workerDetails() {
  const rows = new Map(), drafts = new Map();
  const history = workerHistory(id => api('/stock/items/' + encodeURIComponent(id) + '/history', { query: { limit: 5 } }));
  let storage;
  try { storage = window.sessionStorage; } catch { /* Хранилище может быть запрещено браузером. */ }
  const context = workerStockContext(api, { storage, actorId: session.realUser?.id });
  let epoch = 0, destroyed = false, openKey = null;
  function preserveActiveNote() {
    const active = document.activeElement;
    const previous = rows.get(openKey);
    previous?.capture();
    if (active?.tagName === 'INPUT' && active.dataset.workerKey?.endsWith(':detail-note') && previous?.detail.contains(active)) {
      // Скрытие аккордеоном не является командой сохранения. Blur на время подавлен штатным флагом ввода.
      active.dataset.gridReplacing = '1'; active.blur(); delete active.dataset.gridReplacing;
    }
  }
  function closeCurrent() {
    preserveActiveNote();
    const previous = rows.get(openKey);
    if (previous) { previous.detail.hidden = true; previous.toggle.setAttribute('aria-expanded', 'false'); }
    openKey = null;
    context.cancelQueued();
  }
  return {
    begin() { rows.forEach(entry => entry.capture()); epoch++; rows.clear(); context.begin(); },
    invalidate(id) { history.invalidate(id); context.invalidate(id); },
    destroy() { destroyed = true; epoch++; rows.clear(); drafts.clear(); openKey = null; history.destroy(); context.destroy(); },
    rowDetail({ key, label, items, columns, kind, readOnly, saveNote, distinguish = false }) {
      const own = epoch, id = 'pg-worker-detail-' + ++nextId;
      const content = h('div', { class: 'pg-worker-detail-content' });
      const detail = h('tr', { class: 'pg-worker-detail', id, hidden: openKey !== key, 'data-worker-detail-row': key }, h('td', { colspan: columns }, content));
      let built = false;
      const paints = [], notes = [];
      const capture = () => notes.forEach(({ item, note }) => {
        const materialId = workerMaterialId(item);
        if (note.value !== String(item.notes || '')) drafts.set(materialId, note.value); else drafts.delete(materialId);
      });
      const current = () => !destroyed && own === epoch && !detail.hidden && detail.isConnected;
      function build() {
        if (built) return;
        built = true;
        if (kind === 'pipe' && items.length > 1) {
          const lengths = items.map(workerPipeMetres);
          const total = lengths.every(length => length != null) ? `${qty(lengths.reduce((sum, length) => sum + length, 0))} м` : 'Метраж известен не для всех труб';
          content.append(h('h3', { class: 'pg-worker-category pg-worker-row-total' }, 'Всего по строке: ' + total));
        }
        for (const item of items) {
          const materialId = workerMaterialId(item), unit = workerUnit(item);
          const note = gridField('pg-note', `Примечание, ${item.name}`, item.notes || '', async text => { await saveNote(item, text); drafts.delete(materialId); }, readOnly || kind === 'sheet');
          note.dataset.workerKey = materialId + ':detail-note';
          if (note.tagName === 'INPUT') {
            if (drafts.has(materialId)) note.value = drafts.get(materialId);
            notes.push({ item, note });
          }
          const list = h('div', { class: 'pg-worker-history', role: 'status' });
          const paint = (retry = false) => {
            list.replaceChildren(busyBlock('Последние операции'));
            history.get(materialId, retry).then(response => {
              if (!current()) return;
              list.replaceChildren(operations(response, unit));
            }).catch(error => { if (current()) list.replaceChildren(failBlock(error, () => paint(true), { text: 'Операции не загрузились' })); });
          };
          paints.push(paint);
          const extra = workerContextView(context.material(item), item, {
            readOnly: readOnly || !session.canEdit || viewAsActive(session.realUser),
            current,
          });
          paints.push(extra.paint);
          const metres = kind === 'pipe' ? workerPipeMetres(item) : null;
          const figures = stats([{ value: metres == null ? `${qty(item.quantity ?? 0)} ${unit}` : `${qty(metres)} м`, label: metres == null ? 'Фактически' : 'Всего метров' },
            { value: `${qty(item.reservedQty || 0)} ${unit}`, label: 'В брони' },
            { value: `${qty(item.free ?? Number(item.quantity || 0) - Number(item.reservedQty || 0))} ${unit}`, label: 'Свободно' }]);
          figures.classList.add('pg-worker-figures');
          const panel = section({ fixed: true, title: variant(kind, item), tone: 'neutral', body: [
            distinguish ? h('p', { class: 'pg-worker-secondary' }, [stockPositionName(item), stockPositionCode(item) || item.article].filter(Boolean).join(' · ')) : null,
            figures,
            h('div', { class: 'pg-worker-secondary' }, Number(item.quantity) === 0 ? 'Нет в наличии' : Number(item.reservedQty) >= Number(item.quantity) ? 'Всё в брони' : 'В наличии'),
            h('div', { class: 'pg-worker-detail-note' }, h('h3', { class: 'pg-worker-category' }, 'Примечание'), note),
            h('h3', { class: 'pg-worker-category' }, 'Последние операции'), list, extra.el,
          ] });
          // Вложенный вариант — третий уровень заголовка внутри рабочей подстроки.
          panel.querySelector('.k-sec-fhead h2').replaceWith(h('h3', null, variant(kind, item)));
          content.append(h('div', { 'data-detail-material-id': materialId }, panel));
        }
      }
      const toggle = button({ label, cls: 'pg-worker-row-button', onClick: () => {
        const expanded = openKey !== key;
        closeCurrent();
        if (expanded) { openKey = key; detail.hidden = false; toggle.setAttribute('aria-expanded', 'true'); build(); paints.forEach(paint => paint()); }
      } });
      toggle.addEventListener('pointerdown', preserveActiveNote);
      toggle.dataset.workerRow = key;
      toggle.dataset.workerKey = 'row:' + key;
      toggle.setAttribute('aria-expanded', String(!detail.hidden)); toggle.setAttribute('aria-controls', id);
      rows.set(key, { detail, toggle, capture });
      if (!detail.hidden) { build(); paints.forEach(paint => paint()); }
      return { toggle, detail };
    },
  };
}
