import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { current, patch, go } from '../core/router.js';
import { button, table, toolbar, searchBox, filter, busyBlock, failBlock, enhanceSelect, select as kitSelect, section } from '../ui/kit/index.js';
import { pipeWorkerGrid, sheetWorkerGrid } from './stock-worker-grid.js';
import { workerCountBody, workerMaterialId } from './stock-worker-model.js';
import { workerDetails } from './stock-worker-details.js';
import { openStockOp } from './stock-ops.js';

const PAGE_SIZE = 100;
const config = {
  pipe: { title: 'Трубы', zone: 'Трубы', sort: 'sectionSize', columns: ['section', 'material', 'grade', 'wash', 'pipeLength'], sorts: [['sectionSize', 'Сечение'], ['length', 'Длина единицы'], ['quantity', 'Остаток'], ['name', 'Название']] },
  sheet: { title: 'Листовой материал', zone: 'Листовой материал', sort: 'sheetSize', columns: ['material', 'grade', 'surface', 'thickness', 'width', 'length', 'offcut'], sorts: [['sheetSize', 'Толщина, ширина, длина'], ['thickness', 'Толщина'], ['width', 'Ширина'], ['length', 'Длина'], ['quantity', 'Остаток'], ['name', 'Название']] },
};
/** Рабочие сетки используют те же scope/сортировку/страницы C242; каждый ввод относится к materialId. */
export function mountStockWorktable(kind, { readOnly = false } = {}) {
  const cfg = config[kind];
  let params = { ...current().params }, page = 1, sequence = 0, destroyed = false, zone, createDefaults = {};
  const body = h('div');
  const details = workerDetails();
  const search = searchBox({ value: params.q || '', label: 'Найти материал', placeholder: kind === 'pipe' ? '80×60×3' : 'Марка или размер', onSearch: value => { params.q = value; page = 1; load(); } });
  const select = kitSelect({ label: 'Сортировка', value: params.sort || cfg.sort,
    options: cfg.sorts.flatMap(([key, label]) => [[key, label + ' ↑'], ['-' + key, label + ' ↓']]),
    onChange: value => { params.sort = value; page = 1; load(); } });
  enhanceSelect(select);
  const availability = filter({ mode: 'chips', items: [{ key: '', label: 'Все' }, { key: 'in', label: 'В наличии' }, { key: 'none', label: 'Нет в наличии' }], value: params.availability || '', onChange: value => { params.held = undefined; params.availability = value || undefined; page = 1; load(); } }).el;
  const add = !readOnly ? button({ label: 'Добавить материал', onClick: () => patch({ of: undefined, new: '1', open: undefined, ...createDefaults }, { kind: 'card' }) }) : null;
  const receive = !readOnly ? button({ label: 'Принять на склад', kind: 'primary', onClick: () => openStockOp('in') }) : null;
  const el = h('div', { class: 'pg-worker' }, h('div', { class: 'page-head' }, h('h1', null, cfg.title), receive, add),
    toolbar(search.el, availability, select, button({ label: 'Журнал движений', kind: 'ghost', onClick: () => go('movements') })),
    h('p', { class: 'hint' }, readOnly ? 'Только просмотр. Количества указаны в единице учёта материала.' : kind === 'pipe'
      ? 'Количество в ячейках — в единице учёта. Длина трубы указана в шапке.' : 'Количество листов и обрезков — в единице учёта материала.'), body);
  const closeMenu = event => {
    if (event.key !== 'Escape' || !el.isConnected || !matchMedia('(max-width: 1500px)').matches) return;
    const shell = el.closest('.shell');
    if (!shell?.classList.contains('nav-open')) return;
    shell.classList.remove('nav-open'); shell.querySelector('.burger')?.focus();
    event.preventDefault(); event.stopPropagation();
  };
  document.addEventListener('keydown', closeMenu);

  const gridOptions = { readOnly, details,
    async saveCount(item, text) {
      const body = workerCountBody(item, text, cfg.title);
      await api('/stock/batch', { method: 'POST', body });
      item.quantity = body.lines[0].qty;
      item.free = item.quantity - Number(item.reservedQty || 0);
      details.invalidate(workerMaterialId(item));
    },
    async saveNote(item, value) {
      await api('/stock/items/' + encodeURIComponent(workerMaterialId(item)), { method: 'PATCH', body: { notes: value } });
      item.notes = value;
      details.invalidate(workerMaterialId(item));
    },
  };
  async function load({ keep = false } = {}) {
    const own = ++sequence;
    if (!keep) body.replaceChildren(busyBlock('Загружаю материалы'));
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
      // dc:changed перечитывает view после записи. Берём текущий фокус/черновик перед заменой, а не при старте запроса.
      const active = document.activeElement;
      const focus = keep && body.contains(active) && active.dataset.workerKey && /^(INPUT|BUTTON)$/.test(active.tagName)
        ? { key: active.dataset.workerKey, value: active.value, start: active.selectionStart, end: active.selectionEnd, input: active.tagName === 'INPUT' } : null;
      if (focus) active.dataset.gridReplacing = '1';
      const scroll = keep ? [...body.querySelectorAll('.table-wrap')].map(node => ({ top: node.scrollTop, left: node.scrollLeft })) : [];
      const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
      details.begin();
      body.replaceChildren(h('p', { class: 'hint', role: 'status' }, pages > 1
        ? `Страница ${page} из ${pages} · показано ${result.items.length} из ${result.total} материалов. Сетка содержит только эту страницу.`
        : `Все материалы выбранного отбора · ${result.total}`),
        ...(kind === 'pipe' ? pipeWorkerGrid(result.items, gridOptions) : sheetWorkerGrid(result.items, gridOptions)));
      if (!result.items.length) body.append(h('p', { class: 'hint' }, 'Материалы не найдены. Очистите поиск или проверьте выбранную зону.'));
      body.append(h('p', { class: 'hint' }, '0 — остатка нет. «—» — материала в ячейке нет.'));
      const byId = new Map(result.items.map(item => [item.materialId || item.id, item]));
      const reservations = (reserved.items || []).flatMap(group => (group.lines || []).filter(line => byId.has(line.materialId) && Number(line.qty) > Number(line.issued || 0))
        .map(line => ({ cells: [byId.get(line.materialId).name, qty(line.qty - (line.issued || 0)), byId.get(line.materialId).unit || '—', group.salesOrder || group.name || '—', group.createdBy || '—'] })));
      if (reservations.length) body.append(section({ title: 'Брони позиций на этой странице', count: reservations.length,
        body: table({ columns: [{ label: 'Материал', wrap: true }, { label: 'Количество', num: true }, { label: 'Ед.' }, { label: 'Для чего' }, { label: 'Поставил' }], rows: reservations }) }));
      if (pages > 1) body.append(toolbar(button({ label: 'Назад', disabled: page === 1, onClick: () => { page--; load(); } }),
        h('span', { class: 'muted' }, `Страница ${page} из ${pages} · ${result.total} материалов`),
        button({ label: 'Далее', disabled: page * PAGE_SIZE >= result.total, onClick: () => { page++; load(); } })));
      if (focus) {
        const target = [...body.querySelectorAll('[data-worker-key]')].find(node => node.dataset.workerKey === focus.key);
        if (target) { if (focus.input) target.value = focus.value; target.focus({ preventScroll: true }); if (focus.input) target.setSelectionRange(focus.start, focus.end); }
      }
      if (keep) [...body.querySelectorAll('.table-wrap')].forEach((node, index) => { if (scroll[index]) { node.scrollTop = scroll[index].top; node.scrollLeft = scroll[index].left; } });
    } catch (error) { if (own === sequence && !destroyed) body.replaceChildren(failBlock(error, load)); }
  }
  load();
  return { el, reload: () => load({ keep: true }), update(next) { if (JSON.stringify(params) !== JSON.stringify(next)) { params = { ...next }; page = 1; select.value = params.sort || cfg.sort; load(); } }, destroy() { destroyed = true; sequence++; details.destroy(); document.removeEventListener('keydown', closeMenu); } };
}
