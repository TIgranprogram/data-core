import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { heldStockQuery } from '../core/stock-list.js';
import { viewAsActive } from '../core/view-as.js';
import { busyBlock, button, empty, failBlock, searchBox, table } from '../ui/kit/index.js';
import { gridField } from './sheet-grid.js';

const PAGE_SIZE = 100;
const zoneName = 'Деревообработка';

function dimensions(item) {
  const d = item.dims || {};
  return [['Д', d.length], ['Ш', d.width], ['Т', d.thickness], ['В', d.height]]
    .filter(([, value]) => Number(value) > 0).map(([label, value]) => label + ' ' + qty(value)).join(' · ') || '—';
}

/** GET /stock/zones задаёт область роли. Без совпадения запрос остатков не выполняется. */
export function mountWoodGrid() {
  let search = '', page = 1, request = 0, destroyed = false;
  const body = h('div');
  const searchControl = searchBox({ label: 'Найти материал', placeholder: 'Название или артикул', onSearch(value) {
    search = value.trim(); page = 1; load();
  } });
  const el = h('div', null, h('div', { class: 'page-head' }, h('h1', null, zoneName)), searchControl.el, body);

  function row(item) {
    const id = item.materialId || item.id, editable = session.canEdit && !viewAsActive(session.realUser);
    const quantity = Number(item.quantity), reserved = Number(item.reservedQty || 0);
    const count = editable ? gridField('pg-in', 'Фактически, ' + item.name, String(quantity).replace('.', ','), async value => {
      const next = Number(value.replace(',', '.'));
      if (!value || !Number.isFinite(next) || next < 0) throw new Error('Введите неотрицательное количество.');
      await api('/stock/batch', { method: 'POST', body: { type: 'count', note: zoneName,
        lines: [{ materialId: id, qty: next, expected: quantity }] } });
      await load();
    }) : qty(quantity);
    const note = editable ? gridField('pg-note', 'Примечание, ' + item.name, item.notes || '', async value => {
      await api('/stock/items/' + encodeURIComponent(id), { method: 'PATCH', body: { notes: value } });
    }) : item.notes || '—';
    return { cells: [item.name, item.article || '—', item.categoryName || '—', dimensions(item),
      item.unit || '—', count, qty(reserved), qty(item.free ?? quantity - reserved), note] };
  }

  async function load() {
    if (destroyed) return;
    const current = ++request;
    body.replaceChildren(busyBlock('Загружаю остатки'));
    try {
      const zones = await api('/stock/zones');
      if (current !== request) return;
      const zone = zones.items.find(z => z.name?.trim().toLocaleLowerCase('ru') === zoneName.toLocaleLowerCase('ru'));
      if (!zone?.id) {
        body.replaceChildren(empty({ title: 'Зона «Деревообработка» недоступна', hint: 'Проверьте зону склада в настройках роли.' }));
        return;
      }
      const result = await api('/stock/items', { query: { ...heldStockQuery(zone.id), search, sort: 'name', limit: PAGE_SIZE, page } });
      if (current !== request) return;
      if (page > 1 && !result.items.length) { page--; return load(); }
      const rows = result.items.filter(item => Number(item.quantity) > 0).map(row);
      const grid = table({ label: 'Материалы деревообработки', columns: [
        { label: 'Материал', wrap: true }, { label: 'Артикул' }, { label: 'Категория' }, { label: 'Размеры, мм' },
        { label: 'Ед.' }, { label: 'Фактически', num: true }, { label: 'В брони', num: true },
        { label: 'Свободно', num: true }, { label: 'Примечание' },
      ], rows, empty: { title: search ? 'Материалы не найдены' : 'В зоне нет физических остатков' } });
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
  return { el, reload: load, update() {}, destroy() { destroyed = true; request++; } };
}
