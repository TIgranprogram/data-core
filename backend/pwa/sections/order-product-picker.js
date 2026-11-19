import { api, patchVersioned, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { current, onChange } from '../core/router.js';
import { button, busyBlock, empty, enhanceSelect, failBlock, field, fieldRow, openCard, posPic, row,
  searchBox, section, select, sideNote, sku, stack, table, toast } from '../ui/kit/index.js';

const TITLE = 'Выбрать изделие';
const LIMIT = 20;
const EMPTY_FILTERS = { search: '', section: '', group: '', series: '' };
const CONFLICT = 'Позицию заказа уже изменили. Выбор остаётся в панели. Нажмите «Отмена», чтобы обновить позицию, затем откройте выбор снова.';
const productName = (p) => p.fullName || p.name || 'Изделие без названия';
const categoryName = (p) => p.groupName || [p.type, p.group].filter(Boolean).join(' › ');
const productPhoto = (p) => p.photo || p.photos?.[0];
const searchText = (val) => val.trim().replace(/\s+/g, ' ');
export const linkedProductId = (line) => line.productId || line.product?.id || '';

/** Открывает вложенную форму без смены адреса и возвращает в ту же карточку позиции. */
export function openOrderProductPicker(line, { setRow, reload }, parent) {
  if (!session.canEdit) return;
  const original = { id: line.id, version: line.version };
  return openProductPicker(line, {
    save: (productId) => patchVersioned(`/incomes/${original.id}`, original, { productId }),
    onSaved: (saved) => { setRow(saved); toast('Изделие привязано'); },
    onConflict: reload,
  }, parent);
}

export function openProductPicker(line, { save, onSaved, onConflict, allowCurrent = false }, parent) {
  if (!parent) return;
  const currentId = linkedProductId(line);
  const route = current();
  let form;
  let saved;
  let confirmed = false;
  let conflicted = false;
  const panel = {
    title: TITLE, newTitle: TITLE, card: {},
    form: {
      build: () => (form = buildPicker(line, currentId, allowCurrent, () => conflicted)),
      saveLabel: 'Привязать изделие', closeAfterCreate: true,
      toBody: ({ productId }) => ({ productId }),
      async create({ productId }) {
        if (conflicted) throw new Error(CONFLICT);
        if (form.el.inert) throw new Error('Привязка уже сохраняется.');
        form.el.inert = true;
        try {
          saved = await save(productId);
          confirmed = true;
          return saved;
        } catch (e) {
          if (e?.status !== 409) throw e;
          conflicted = true;
          throw new Error(CONFLICT, { cause: e });
        } finally {
          form.el.inert = false;
        }
      },
    },
  };
  const handle = openCard(panel, { mode: 'create', parent }, {
    changed() {},
    close() {
      stopWatching();
      if (confirmed) onSaved(saved);
      else if (conflicted) onConflict();
    },
  });
  const stopWatching = onChange(({ section, params }) => {
    if (section === route.section && params.of === route.params.of && params.open === route.params.open) return;
    stopWatching();
    handle.close();
  });
}

function filterField(label, allLabel, onChange) {
  const control = select({ label, onChange, options: [['', allLabel]] });
  const el = field(label, control);
  enhanceSelect(control, { force: true });
  const input = el.querySelector('input[role="combobox"]');
  let shown = '';
  return {
    el,
    set(options, value, disabled = false) {
      const key = JSON.stringify(options);
      if (key !== shown) {
        shown = key;
        control.replaceChildren(h('option', { value: '' }, allLabel),
          ...options.map(({ value, label }) => h('option', { value }, label)));
      }
      if (control.value !== value) control.value = value;
      control.disabled = input.disabled = disabled;
    },
  };
}

function presentProduct(p) {
  const category = categoryName(p);
  return h('div', null, h('div', null, productName(p)), sku(p.sku), h('div', { class: 'muted' }, category || 'Без категории'));
}

function productTable(items, label, chosenId, onPick) {
  return table({ label, clickable: true, columns: [{ label: 'Фото', pic: true }, { label: 'Изделие', wrap: true }],
    rows: items.map((p) => ({ data: p.id, selected: p.id === chosenId, onClick: () => onPick(p),
      cells: [posPic(productPhoto(p), 'lg'), presentProduct(p)] })),
  });
}

function productSummary(title, p) {
  return section({ title, fixed: true, tone: 'neutral', body: row({
    lead: posPic(productPhoto(p), 'lg'), title: productName(p), wrap: true,
    meta: [sku(p.sku), p.sku ? ' · ' : null, categoryName(p) || 'Без категории'],
  }) });
}

function groupOptions(groups, parentId) {
  return groups.filter((g) => parentId ? g.parentId === parentId : !g.parentId)
    .map((g) => ({ value: g.id, label: g.name }));
}

function buildPicker(line, currentId, allowCurrent, conflicted) {
  let chosen;
  let saveEnabled = () => {};
  let filters = { ...EMPTY_FILTERS };
  let groups;
  let series = [];
  let page = 0;
  let items = [];
  let total = 0;
  let loading = false;
  let error;
  let seq = 0;
  let groupsSeq = 0;

  const current = h('div', { hidden: !currentId, tabindex: -1 });
  const selected = h('div', { hidden: true, tabindex: -1, 'aria-live': 'polite' });
  const groupState = h('div');
  const suggestions = h('div', { hidden: true });
  const results = h('div', { 'aria-label': 'Результаты поиска изделий' });
  const search = searchBox({ placeholder: 'Название или артикул', label: 'Поиск изделий', onSearch: (value) => apply({ search: value }) });
  const sections = filterField('Раздел', 'Все разделы', (value) => apply({ section: value, group: '', series: '' }));
  const subgroups = filterField('Группа', 'Все группы', (value) => apply({ group: value, series: '' }));
  const seriesField = filterField('Серия', 'Все серии', (value) => apply({ series: value }));
  const reset = button({ label: 'Сбросить фильтры', kind: 'ghost', size: 'S', onClick: resetFilters });
  const refresh = button({ label: 'Обновить каталог', size: 'S', onClick: refreshCatalog });
  const el = stack(sideNote(`Позиция заказа «${line.title || 'Без названия'}»`), current, selected,
    section({ title: 'Поиск по каталогу', fixed: true, body: [search.el, fieldRow(sections.el, subgroups.el, seriesField.el), fieldRow(reset, refresh), groupState] }),
    suggestions, results);

  const pendingSearch = () => searchText(search.input.value) !== filters.search;
  const hasFilters = () => Object.values(filters).some(Boolean);
  search.input.addEventListener('input', paintResults);
  search.input.addEventListener('keydown', (e) => { if (e.key === 'Escape') paintResults(); });
  search.el.addEventListener('click', (e) => { if (e.target.closest('button')) paintResults(); });

  function resetFilters() {
    search.set('', true);
    apply(EMPTY_FILTERS);
    search.focus();
  }

  async function refreshCatalog() {
    const value = searchText(search.input.value);
    if (value !== filters.search) { filters = { ...filters, search: value }; search.set(value, true); }
    await Promise.all([loadPage(1), loadGroups()]);
  }

  function apply(changes) {
    if (!el.isConnected || el.inert) return;
    const next = { ...filters, search: searchText(search.input.value), ...changes };
    if (Object.keys(next).every((key) => next[key] === filters[key])) { paintResults(); return; }
    filters = next;
    search.set(next.search, true);
    void loadPage(1);
  }

  function paintFilters() {
    const sub = filters.section ? groupOptions(groups || [], filters.section) : [];
    sections.set(groupOptions(groups || [], ''), filters.section, !groups?.length);
    subgroups.set(sub, filters.group, !sub.length);
    const opts = series.map(({ value, n }) => ({ value, label: `${value} (${n})` }));
    if (filters.series && !opts.some((o) => o.value === filters.series)) opts.unshift({ value: filters.series, label: filters.series });
    seriesField.set(opts, filters.series, !opts.length);
    reset.disabled = !hasFilters() && !pendingSearch();
  }

  function choose(p) {
    if (!p.id || el.inert || !el.isConnected) return;
    chosen = p.id === currentId && !allowCurrent ? undefined : p;
    selected.hidden = !chosen;
    selected.replaceChildren(chosen ? productSummary('Выбранное изделие', chosen) : null);
    saveEnabled(!!chosen && !conflicted());
    paintResults();
    const summary = chosen ? selected : current;
    summary.focus({ preventScroll: true });
    summary.scrollIntoView({ block: 'nearest' });
  }

  function paintResults() {
    const pending = pendingSearch();
    reset.disabled = !hasFilters() && !pending;
    if (pending || (loading && !page)) {
      results.replaceChildren(busyBlock('изделия'));
      return;
    }
    const retry = () => loadPage(page ? page + 1 : 1);
    const failed = error && (error.status === 403
      ? empty({ title: 'Каталог изделий недоступен', hint: 'Проверьте с администратором доступ к «Продукции».' })
      : failBlock(error, retry, { text: 'Не загрузились изделия' }));
    if (!items.length) {
      results.replaceChildren(failed || (hasFilters()
        ? empty({ kind: 'notFound', title: 'Изделия не найдены', hint: 'Измените поиск или сбросьте фильтры.' })
        : empty({ title: 'В каталоге пока нет изделий' })));
      return;
    }
    const more = page * LIMIT < total && !failed ? button({
      label: loading ? 'Загружаю…' : 'Показать ещё', busy: loading, onClick: retry,
    }) : null;
    results.replaceChildren(stack(h('div', { role: 'status', class: 'muted' }, `Показано ${items.length} из ${total}`),
      productTable(items, 'Изделия', chosen?.id || currentId, (p) => { if (!pendingSearch()) choose(p); }), failed, more));
  }

  async function loadPage(next) {
    if (!el.isConnected || el.inert || (next > 1 && (loading || pendingSearch()))) return;
    const request = ++seq;
    const { search, section, group, series: seriesValue } = filters;
    const known = new Map();
    if (next === 1) { page = 0; items = []; total = 0; series = []; }
    else items.forEach((p) => known.set(p.id, p));
    error = null;
    loading = true;
    paintFilters();
    paintResults();
    try {
      const res = await api('/showcase', { query: { search, groupId: group || section, series: seriesValue,
        page: next, limit: LIMIT, sort: 'name', ...(next === 1 ? { facets: 1 } : {}) } });
      if (request !== seq || !el.isConnected) return;
      res.items.forEach((p) => known.set(p.id, p));
      items = [...known.values()];
      total = res.total;
      page = next;
      if (next === 1) series = res.facets?.series || [];
    } catch (err) {
      if (request !== seq || !el.isConnected) return;
      error = err;
    }
    loading = false;
    paintFilters();
    paintResults();
  }

  async function loadGroups() {
    const request = ++groupsSeq;
    groupState.replaceChildren(busyBlock('разделы и группы'));
    try {
      const res = await api('/showcase/groups');
      if (request !== groupsSeq || !el.isConnected) return;
      groups = res;
      groupState.replaceChildren();
      paintFilters();
    } catch (e) {
      if (request === groupsSeq && el.isConnected) groupState.replaceChildren(failBlock(e, loadGroups, { text: 'Не загрузились разделы и группы' }));
    }
  }

  function loadCurrent() {
    if (!currentId) return;
    current.replaceChildren(productSummary('Текущее изделие', { name: 'Описание недоступно', ...line.product }));
    api(`/showcase/${currentId}`).then((p) => {
      if (el.isConnected) current.replaceChildren(productSummary('Текущее изделие', p));
    }).catch(() => {}); // название и артикул позиции уже показаны, даже если карточка каталога недоступна
  }

  function loadSuggestions() {
    const name = String(line.title || '').trim().slice(0, 200);
    if (name.length < 3 || currentId) return;
    api('/showcase/similar', { query: { name }, quiet: true }).then((res) => {
      if (!el.isConnected || !res.length) return;
      suggestions.replaceChildren(section({ title: 'Похожие по названию позиции', count: Math.min(res.length, 3),
        body: productTable(res.slice(0, 3), 'Похожие изделия', null, (p) => {
          choose(p);
          api(`/showcase/${p.id}`, { quiet: true }).then((detail) => {
            if (chosen === p && el.isConnected && !el.inert) selected.replaceChildren(productSummary('Выбранное изделие', detail));
          }).catch(() => {});
        }) }));
      suggestions.hidden = false;
    }).catch(() => {}); // каталог и фильтры работают даже без подсказок
  }

  paintFilters();
  setTimeout(() => {
    if (!el.isConnected) return;
    search.focus();
    void refreshCatalog();
    loadCurrent();
    loadSuggestions();
  }, 0);
  return {
    el,
    dirty: () => false, // предварительный выбор хранится только в открытой панели
    get conflicted() { return conflicted(); },
    bindSave(fn) { saveEnabled = fn; fn(false); },
    read: () => chosen && !conflicted()
      ? { values: { productId: chosen.id } } : { errors: true },
  };
}
