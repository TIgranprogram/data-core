import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { stockPositionCode, stockPositionName } from '../core/stock-display.js';
import { current, patch } from '../core/router.js';
import { viewAsActive } from '../core/view-as.js';
import { busyBlock, button, empty, failBlock, searchBox, table, toolbar, filter, enhanceSelect, select as kitSelect } from '../ui/kit/index.js';
import { dimensionValue, stockAvailability, stockZero, inlineCountAllowed, stockCountCell } from './stock-dimension-columns.js';
import { toast } from '../ui/kit/toast.js';
import { lookups, unitList } from './lookups.js';
import { gridField } from './sheet-grid.js';

const PAGE_SIZE = 100;
const zoneName = 'Деревообработка';
const canEdit = () => session.canEdit && !viewAsActive(session.realUser);
const sizeFields = [['length', 'Длина'], ['width', 'Ширина'], ['height', 'Высота'], ['thickness', 'Толщина'], ['depth', 'Глубина']];

async function woodZone() {
  const { items } = await api('/stock/zones');
  return items.find(z => z.name?.trim().toLocaleLowerCase('ru') === zoneName.toLocaleLowerCase('ru'));
}

async function woodCategoryOptions(zone) {
  const response = await api('/categories', { query: { type: 'material' } });
  const categories = Array.isArray(response) ? response : response.items;
  const byId = new Map(categories.map(category => [String(category.id || category._id), category]));
  const roots = new Set((zone.categoryIds || []).map(String));
  return [...byId].filter(([id]) => {
    const seen = new Set();
    for (let current = id; current && !seen.has(current); current = String(byId.get(current)?.parentId || '')) {
      if (roots.has(current)) return true;
      seen.add(current);
    }
    return false;
  }).map(([value, category]) => ({ value, label: category.fullPath || category.name }));
}

export const woodItem = {
  id: 'wooditem',
  newTitle: 'Новый материал деревообработки',
  canEdit,
  form: {
    initial: () => ({ unit: 'шт' }),
    fields: async () => {
      const zone = await woodZone();
      if (!zone?.id) throw new Error('Зона «Деревообработка» недоступна.');
      const [options, lk] = await Promise.all([woodCategoryOptions(zone), lookups().catch(() => ({}))]);
      if (!options.length) throw new Error('Добавьте категории материалов в настройки зоны «Деревообработка».');
      return [
        { section: 'Материал', tone: 'main', fixed: true },
        { key: 'categoryId', label: 'Категория', type: 'select', options, required: true, choose: options.length > 1, span: 3 },
        { key: 'unit', label: 'Ед. изм.', type: 'combo', options: unitList(lk), required: true, max: 30 },
        { key: 'name', label: 'Название', required: true, max: 300, wide: true, placeholder: 'Доска сосновая 3000 × 100 × 25' },
        { key: 'article', label: 'Артикул поставщика', max: 100, wide: true },
        { section: 'Размеры, мм', tone: 'info', fixed: true },
        ...sizeFields.map(([key, label]) => ({ key, label, type: 'number', min: 0 })),
        { key: 'notes', label: 'Примечание', type: 'textarea', wide: true, max: 2000 },
      ];
    },
    toBody: ({ name, categoryId, unit, article, notes, ...values }) => ({
      name, categoryId, unit, ...(article ? { article } : {}), ...(notes ? { notes } : {}),
      dims: Object.fromEntries(sizeFields.filter(([key]) => values[key] > 0).map(([key]) => [key, values[key]])),
    }),
    create: async (body) => {
      const zone = await woodZone();
      if (!zone?.id) throw new Error('Зона «Деревообработка» недоступна.');
      const item = await api('/stock/items', { method: 'POST', query: { zoneId: zone.id }, body });
      toast('Материал добавлен. Остаток можно указать в столбце «Фактически».');
      return item;
    },
    saveLabel: 'Добавить материал',
    closeAfterCreate: true,
  },
};

/** GET /stock/zones задаёт область роли. Без совпадения запрос остатков не выполняется. */
export function mountWoodGrid() {
  let search = '', page = 1, request = 0, destroyed = false, sort = current().params.sort || 'woodSize', availability;
  const body = h('div');
  const searchControl = searchBox({ label: 'Найти материал', placeholder: 'Название или артикул', onSearch(value) {
    search = value.trim(); page = 1; load();
  } });
  const add = canEdit() ? button({ label: 'Добавить материал', kind: 'primary', onClick: () => {
    patch({ of: 'wooditem', new: '1', open: undefined }, { kind: 'card' });
  } }) : null;
  if (add) add.hidden = true;
  const sortControl = kitSelect({ label: 'Сортировка', value: sort,
    options: [['woodSize', 'Ширина, высота, длина'], ['width', 'Ширина'], ['height', 'Высота'], ['thickness', 'Толщина'], ['length', 'Длина'], ['quantity', 'Остаток'], ['name', 'Название']]
      .flatMap(([key, label]) => [[key, label + ' ↑'], ['-' + key, label + ' ↓']]),
    onChange: value => { sort = value; page = 1; load(); } });
  enhanceSelect(sortControl);
  const presence = filter({ mode: 'chips', items: [{ key: '', label: 'Все' }, { key: 'in', label: 'В наличии' }, { key: 'none', label: 'Нет в наличии' }], onChange: value => { availability = value || undefined; page = 1; load(); } }).el;
  const el = h('div', null, h('div', { class: 'page-head' }, h('h1', null, zoneName), add), toolbar(searchControl.el, presence, sortControl), body);

  const onCreated = (event) => {
    const { path, method, result } = event.detail || {};
    if (current().params.of !== 'wooditem' || path !== '/stock/items' || method !== 'POST' || !result?.name) return;
    search = result.name;
    searchControl.set(search, true);
    page = 1;
  };
  if (add) document.addEventListener('dc:changed', onCreated);

  function row(item) {
    const id = item.materialId || item.id, editable = canEdit();
    const code = stockPositionCode(item) || item.article;
    const title = stockPositionName(item);
    const name = title && title !== code ? title : item.categoryName || 'Без наименования';
    const quantity = Number(item.quantity), reserved = Number(item.reservedQty || 0);
    const count = gridField('pg-in', 'Фактически, ' + name, String(quantity).replace('.', ','), async value => {
      const next = Number(value.replace(',', '.'));
      if (!value || !Number.isFinite(next) || next < 0) throw new Error('Введите неотрицательное количество.');
      await api('/stock/batch', { method: 'POST', body: { type: 'count', note: zoneName,
        lines: [{ materialId: id, qty: next, expected: quantity }] } });
      await load();
    }, !editable || !inlineCountAllowed(item));
    const note = editable ? gridField('pg-note', 'Примечание, ' + name, item.notes || '', async value => {
      await api('/stock/items/' + encodeURIComponent(id), { method: 'PATCH', body: { notes: value } });
    }) : item.notes || '—';
    return { cls: stockZero(item) ? 'muted' : '', data: id, cells: [name, code || '—', item.categoryName || '—',
      ...['width', 'height', 'thickness', 'length'].map(key => dimensionValue(item.dims?.[key])),
      item.unit || '—', inlineCountAllowed(item) ? count : { v: stockCountCell(item, count), cls: 'k-col-wrap' }, qty(reserved), qty(item.free ?? quantity - reserved), stockAvailability(item), note] };
  }

  async function load() {
    if (destroyed) return;
    const current = ++request;
    body.replaceChildren(busyBlock('Загружаю остатки'));
    try {
      const zone = await woodZone();
      if (current !== request) return;
      if (add) add.hidden = !zone?.categoryIds?.length;
      if (!zone?.id) {
        body.replaceChildren(empty({ title: 'Зона «Деревообработка» недоступна', hint: 'Проверьте зону склада в настройках роли.' }));
        return;
      }
      const result = await api('/stock/items', { query: { zoneId: zone.id, withParts: '0', search, sort, availability, limit: PAGE_SIZE, page } });
      if (current !== request) return;
      if (page > 1 && !result.items.length) { page--; return load(); }
      const rows = result.items.map(row);
      const grid = table({ label: 'Материалы деревообработки', columns: [
        { label: 'Материал', wrap: true }, { label: 'Артикул / код' }, { label: 'Категория' },
        ...['Ширина, мм', 'Высота, мм', 'Толщина, мм', 'Длина, мм'].map(label => ({ label, num: true })),
        { label: 'Ед. учёта' }, { label: 'Фактически, ед. учёта', num: true }, { label: 'В брони, ед. учёта', num: true },
        { label: 'Свободно, ед. учёта', num: true }, { label: 'Наличие' }, { label: 'Примечание' },
      ], rows, empty: { title: search ? 'Материалы не найдены' : 'В зоне пока нет материалов',
        hint: !search && add?.hidden ? 'Проверьте, какие категории материалов назначены этой зоне.' : undefined } });
      body.replaceChildren(grid);
      if (page > 1 || page * PAGE_SIZE < result.total) {
        const change = delta => { page += delta; load(); };
        body.append(h('div', { class: 'toolbar' },
          button({ label: 'Назад', disabled: page === 1, onClick: () => change(-1) }),
          h('span', { class: 'muted' }, page + ' из ' + Math.ceil(result.total / PAGE_SIZE)),
          button({ label: 'Далее', disabled: page * PAGE_SIZE >= result.total, onClick: () => change(1) })));
      }
    } catch (err) {
      if (current === request) body.replaceChildren(failBlock(err, load));
    }
  }
  load();
  return { el, reload: load, update() {}, destroy() {
    document.removeEventListener('dc:changed', onCreated);
    destroyed = true;
    request++;
  } };
}
