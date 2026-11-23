import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { current, patch, go } from '../core/router.js';
import { button, table, toolbar, searchBox, filter, busyBlock, failBlock, enhanceSelect, select as kitSelect, section } from '../ui/kit/index.js';
import { stockDimensions as columnsOf, stockAvailability, stockZero, inlineCountAllowed, stockCountCell } from './stock-dimension-columns.js';
import { gridField } from './stock-grid-input.js';
import { openStockOp } from './stock-ops.js';

const PAGE_SIZE = 100;
const config = {
  pipe: { title: 'Трубы', zone: 'Трубы', sort: 'sectionSize', columns: ['section', 'material', 'grade', 'wash', 'pipeLength'], sorts: [['sectionSize', 'Сечение'], ['length', 'Длина единицы'], ['quantity', 'Остаток'], ['name', 'Название']] },
  sheet: { title: 'Листовой материал', zone: 'Листовой материал', sort: 'sheetSize', columns: ['material', 'grade', 'surface', 'thickness', 'width', 'length', 'offcut'], sorts: [['sheetSize', 'Толщина, ширина, длина'], ['thickness', 'Толщина'], ['width', 'Ширина'], ['length', 'Длина'], ['quantity', 'Остаток'], ['name', 'Название']] },
};
/** Одна строка — один материал. Сортировку/поиск и страницы выполняет сервер, не текущая страница. */
export function mountStockWorktable(kind, { readOnly = false } = {}) {
  const cfg = config[kind];
  let params = { ...current().params }, page = 1, sequence = 0, destroyed = false, zone, createDefaults = {};
  const body = h('div');
  const search = searchBox({ value: params.q || '', label: 'Найти материал', placeholder: kind === 'pipe' ? '80×60×3' : 'Марка или размер', onSearch: value => { params.q = value; page = 1; load(); } });
  const select = kitSelect({ label: 'Сортировка', value: params.sort || cfg.sort,
    options: cfg.sorts.flatMap(([key, label]) => [[key, label + ' ↑'], ['-' + key, label + ' ↓']]),
    onChange: value => { params.sort = value; page = 1; load(); } });
  enhanceSelect(select);
  const availability = filter({ mode: 'chips', items: [{ key: '', label: 'Все' }, { key: 'in', label: 'В наличии' }, { key: 'none', label: 'Нет в наличии' }], value: params.availability || '', onChange: value => { params.held = undefined; params.availability = value || undefined; page = 1; load(); } }).el;
  const add = !readOnly ? button({ label: 'Добавить материал', onClick: () => patch({ of: undefined, new: '1', open: undefined, ...createDefaults }, { kind: 'card' }) }) : null;
  const receive = !readOnly ? button({ label: 'Принять на склад', kind: 'primary', onClick: () => openStockOp('in') }) : null;
  const el = h('div', null, h('div', { class: 'page-head' }, h('h1', null, cfg.title), receive, add),
    toolbar(search.el, availability, select, button({ label: 'Журнал движений', kind: 'ghost', onClick: () => go('movements') })),
    h('p', { class: 'hint' }, readOnly ? 'Только просмотр. Количества указаны в единице учёта материала.' : 'Пересчёт — в единице учёта. Метраж не пересчитывается в физические штуки.'), body);

  function record(item) {
    const id = item.materialId || item.id, unit = item.unit || '—';
    const canCount = inlineCountAllowed(item);
    const quantity = Number(item.quantity ?? 0), reserved = Number(item.reservedQty || 0);
    const amount = gridField('pg-in', `Фактически, ${item.name}, ${unit}`, String(quantity), async text => {
      const next = text === '' ? NaN : Number(text.replace(',', '.'));
      if (!Number.isFinite(next) || next < 0) throw new Error('Введите неотрицательное количество в единице учёта.');
      await api('/stock/batch', { method: 'POST', body: { type: 'count', note: cfg.title, lines: [{ materialId: id, qty: next, expected: item.quantity }] } });
      item.quantity = next;
      await load();
    }, readOnly || !canCount);
    const note = gridField('pg-note', `Примечание, ${item.name}`, item.notes || '', value => api('/stock/items/' + encodeURIComponent(id), { method: 'PATCH', body: { notes: value } }), readOnly);
    return { data: id, cls: stockZero(item) ? 'muted' : '', cells: [
      ...cfg.columns.map(key => columnsOf[key].render(item)), unit, canCount ? amount : { v: stockCountCell(item, amount), cls: 'k-col-wrap' }, qty(reserved), qty(item.free ?? quantity - reserved), stockAvailability(item), columnsOf.source.render(item), note,
    ] };
  }
  async function load() {
    const own = ++sequence;
    body.replaceChildren(busyBlock('Загружаю материалы'));
    try {
      if (!zone) {
        const result = await api('/stock/zones');
        zone = (result.items || []).find(value => value.name?.trim().toLowerCase() === cfg.zone.toLowerCase());
      }
      if (own !== sequence || destroyed) return;
      if (!zone?.id) throw new Error('Зона «' + cfg.zone + '» недоступна. Проверьте назначение складской зоны.');
      const [result, reserved] = await Promise.all([
        api('/stock/items', { query: { zoneId: zone.id, withParts: '0', search: params.q || undefined, held: params.held, availability: params.availability, sort: params.sort || cfg.sort, limit: PAGE_SIZE, page } }),
        api('/stock/reservations', { query: { zoneId: zone.id } }).catch(() => ({ items: [] })),
      ]);
      if (own !== sequence || destroyed) return;
      if (page > 1 && !result.items.length) { page = Math.max(1, Math.min(page - 1, Math.ceil(result.total / PAGE_SIZE))); return load(); }
      if (result.items[0]) createDefaults = { categoryName: result.items[0].categoryName, unit: result.items[0].unit };
      body.replaceChildren(table({ label: cfg.title, columns: [
        ...cfg.columns.map(key => ({ label: columnsOf[key].label })), { label: 'Ед. учёта' }, { label: 'Фактически, ед. учёта', num: true },
        { label: 'В брони, ед. учёта', num: true }, { label: 'Свободно, ед. учёта', num: true }, { label: 'Наличие' }, { label: 'Название / код', wrap: true }, { label: 'Примечание' },
      ], rows: result.items.map(record), empty: { title: 'Материалы не найдены', hint: 'Очистите поиск или проверьте выбранную зону.' } }));
      const byId = new Map(result.items.map(item => [item.materialId || item.id, item]));
      const reservations = (reserved.items || []).flatMap(group => (group.lines || []).filter(line => byId.has(line.materialId) && Number(line.qty) > Number(line.issued || 0))
        .map(line => ({ cells: [byId.get(line.materialId).name, qty(line.qty - (line.issued || 0)), byId.get(line.materialId).unit || '—', group.salesOrder || group.name || '—', group.createdBy || '—'] })));
      if (reservations.length) body.append(section({ title: 'Брони позиций на этой странице', count: reservations.length,
        body: table({ columns: [{ label: 'Материал', wrap: true }, { label: 'Количество', num: true }, { label: 'Ед.' }, { label: 'Для чего' }, { label: 'Поставил' }], rows: reservations }) }));
      body.append(toolbar(button({ label: 'Назад', disabled: page === 1, onClick: () => { page--; load(); } }),
        h('span', { class: 'muted' }, `${page} из ${Math.max(1, Math.ceil(result.total / PAGE_SIZE))} · ${result.total} позиций`),
        button({ label: 'Далее', disabled: page * PAGE_SIZE >= result.total, onClick: () => { page++; load(); } })));
    } catch (error) { if (own === sequence && !destroyed) body.replaceChildren(failBlock(error, load)); }
  }
  load();
  return { el, reload: load, update(next) { if (JSON.stringify(params) !== JSON.stringify(next)) { params = { ...next }; page = 1; select.value = params.sort || cfg.sort; load(); } }, destroy() { destroyed = true; sequence++; } };
}
