import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { money } from '../core/format.js';
import { attachCombo } from '../ui/combo.js';

/**
 * Каталог поставщиков — позиции из supplieritems (прайсы, загруженные через «Контрагенты → Загрузить прайс»).
 * Только просмотр; редактирование — через повторную загрузку прайса.
 */

let suppliersCache = null;
async function loadSuppliers() {
  if (suppliersCache) return suppliersCache;
  const res = await api('/partners', { query: { limit: 500, kind: 'supplier' } }).catch(() => ({ items: [] }));
  suppliersCache = (res.items || []).map((p) => ({ value: p.id, label: String(p.shortName || p.name) }));
  return suppliersCache;
}

export const supplierCatalog = {
  id: 'suppliercatalog',
  title: 'Каталог поставщиков',

  async mount(el, { params, setTitle }) {
    setTitle('Каталог поставщиков');
    el.innerHTML = '';

    const state = { supplierId: params.supplierId || '', search: params.search || '', page: 1, loading: false };

    // ── шапка ──────────────────────────────────────────────────────────────
    const supplierInput = h('input', { type: 'text', class: 'combo-input', placeholder: 'Все поставщики', autocomplete: 'off' });
    const supplierWrap = h('div', { class: 'combo-wrap' }, supplierInput);
    const searchInput = h('input', { type: 'search', class: 'search-input', placeholder: 'Артикул или название…', value: state.search });

    const toolbar = h('div', { class: 'list-toolbar' }, supplierWrap, searchInput);

    // ── таблица ────────────────────────────────────────────────────────────
    const tbody = h('tbody');
    const countEl = h('span', { class: 'muted' }, '');
    const table = h('table', { class: 'data-table' },
      h('thead', null, h('tr', null,
        h('th', null, 'Поставщик'), h('th', null, 'Артикул'), h('th', null, 'Название'),
        h('th', null, 'Цвет'), h('th', null, 'Группа'), h('th', { class: 'num' }, 'Цена'),
        h('th', null, 'Обновлено'))),
      tbody);
    const wrap = h('div', { class: 'table-wrap' }, table);
    const footer = h('div', { class: 'list-footer' }, countEl);
    el.append(toolbar, wrap, footer);

    // ── combo поставщика ───────────────────────────────────────────────────
    const suppliers = await loadSuppliers();
    attachCombo(supplierInput, {
      items: suppliers,
      value: state.supplierId,
      placeholder: 'Все поставщики',
      onChange(val) {
        state.supplierId = val || '';
        state.page = 1;
        load();
      },
    });

    // ── поиск ─────────────────────────────────────────────────────────────
    let searchTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.search = searchInput.value.trim(); state.page = 1; load(); }, 300);
    });

    // ── загрузка ──────────────────────────────────────────────────────────
    async function load() {
      if (state.loading) return;
      state.loading = true;
      tbody.replaceChildren(h('tr', null, h('td', { colspan: '7', class: 'muted', style: { textAlign: 'center', padding: '16px' } }, 'Загрузка…')));
      try {
        const q = { limit: '200', page: String(state.page) };
        if (state.supplierId) q.supplierId = state.supplierId;
        if (state.search) q.search = state.search;
        const res = await api('/supply/supplier-items', { query: q });
        const rows = res.items || [];
        if (!rows.length) {
          tbody.replaceChildren(h('tr', null, h('td', { colspan: '7', class: 'muted', style: { textAlign: 'center', padding: '24px' } },
            state.search || state.supplierId ? 'Ничего не найдено — уточните фильтр' : 'Прайсы ещё не загружены — откройте «Контрагенты», выберите поставщика → «Загрузить прайс из Excel»')));
          countEl.textContent = '';
          return;
        }
        const fmt = (d) => d ? new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
        tbody.replaceChildren(...rows.map((r) => h('tr', null,
          h('td', null, r.supplierName || '—'),
          h('td', { class: 'muted nowrap' }, r.article || '—'),
          h('td', null, r.name),
          h('td', null, r.color || '—'),
          h('td', { class: 'muted' }, r.optGroup || '—'),
          h('td', { class: 'num' }, r.priceHint != null ? money(r.priceHint) + ' ₽' : '—'),
          h('td', { class: 'muted nowrap' }, fmt(r.updatedAt)))));
        const shown = rows.length;
        countEl.textContent = res.total > shown ? `Показано ${shown} из ${res.total}` : `Позиций: ${res.total}`;
      } catch (e) {
        tbody.replaceChildren(h('tr', null, h('td', { colspan: '7', class: 'form-error' }, e.message || 'Ошибка загрузки')));
      } finally {
        state.loading = false;
      }
    }

    load();
  },
};
