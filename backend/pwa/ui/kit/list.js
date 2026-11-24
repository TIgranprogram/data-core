import { exportList } from '../list-export.js';
import { filterPanel } from './filter-panel.js';
import { searchBox } from './searchbox.js';
import { enhanceSelect } from './index.js';
import { api, canEditSection, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { failBlock } from './busy.js';
import { moreSentinel } from './auto-more.js';
import { qty, plural } from '../../core/format.js';
import { patch, current } from '../../core/router.js';
import { mountBoard } from '../board.js';
import { icon } from '../icons.js';
import { openPopMenu } from './pop-menu.js';
import { button } from './index.js';
import { reportSlow } from '../../core/errors.js';
import { mark } from './mark.js';
import { viewStore, listKeys, listQuery } from './list-view.js';
import { paintTiles } from './list-tiles.js';
import { paintChips } from './list-chips.js';
import { listFilterState } from '../../core/list-filter-state.js';
import { periodState, paintPeriods } from './list-periods.js';
import { rowActions, longPress, paintGallery, paintRows, emptyBlock } from './list-rows.js';
// Контракт section.list (все опции) описан в ./list-view.js
export function mountList(section, params, { onOpen, onCreate, quick, onChanged }) {
  const L = { ...section.list, columns: section.list.columns.filter((c) => !c.money || session.canMoney) };
  let P = { ...params };
  const t0 = performance.now(); // замер первой отрисовки (SPEED-2): > 2 с — запись «Медленно» в ошибки сайта
  let timed = document.hidden; // скрытая вкладка — не «медленно»: браузер её тормозит нарочно
  const stopTiming = () => { timed = true; }; const firstDrawn = () => { if (!timed) { timed = true; document.removeEventListener('visibilitychange', stopTiming); } }; // доска, диаграмма, стартовые плитки — уже нарисовано: дальше ждём человека, а не сервер
  document.addEventListener('visibilitychange', stopTiming, { once: true });
  // L.defaults: фильтры по умолчанию — только при входе в раздел без параметров в адресе; «Все» их снимает и они не возвращаются
  if (L.defaults && !Object.keys(params).length) {
    P = { ...L.defaults };
    setTimeout(() => { const c = current(); if (c.section === section.id && !Object.keys(c.params).length) patch(L.defaults); }, 0);
  }
  const { savedView, saveView, st } = viewStore(L, () => P);
  let rows = [];
  // ---------- Шапка ----------
  const countEl = h('span', { class: 'count' });
  const btnTable = h('button', { type: 'button', onclick: () => { saveView(L.board?.default || L.gallery?.default ? 'table' : ''); patch({ view: 'table', page: undefined }); } }, icon('table'), L.gantt ? 'Список' : 'Таблица'); // явный view: иначе адрес не меняется и go() не перерисовывает
  // доска заказов: сбрасываем filter=active — иначе колонки «Отгружен» пустые (active ∩ shipped = ∅) и кажется, что доска «не работает»
  const btnBoard = h('button', { type: 'button', onclick: () => { saveView('board'); patch({ view: 'board', page: undefined, status: undefined, filter: L.path === '/production-orders' ? 'all' : undefined }); } }, icon('board'), 'Доска');
  const btnGallery = h('button', { type: 'button', onclick: () => { saveView('gallery'); patch({ view: 'gallery', page: undefined }); } }, icon('gallery'), 'Галерея');
  const btnGantt = L.gantt ? h('button', { type: 'button', onclick: () => { saveView('gantt'); patch({ view: 'gantt', page: undefined }); } }, 'Гант') : null;
  const viewSwitch = L.board || L.gallery || L.gantt ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Вид' }, btnTable, L.board ? btnBoard : null, L.gallery ? btnGallery : null, btnGantt) : null;
  const canCreate = section.form && canEditSection(section) && L.createLabel !== false;
  // «⇩ Excel» (МВ.5): весь список с текущими фильтрами — ui/list-export.js; L.export === false — без кнопки; 'admin' — только для роли admin
  const canExport = !(L.export === false || (L.export === 'admin' && session.role !== 'admin'));
  let tableSnapshot = null;
  const doExport = (btn) => {
    const snapshot = L.columnsFor || L.sortFor ? tableSnapshot : { columns: L.columns, query: currentQuery(), sort: st().sort };
    if (snapshot) exportList({ title: section.title, path: L.path, ...snapshot, maxRows: L.exportLimit }, btn);
  };
  // «Ещё ▾» (аудит П2): второстепенные действия и «⇩ Excel» — одним меню, в шапке одна главная кнопка
  const moreBtn = h('button', { class: 'btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Остальные действия' }, 'Ещё ▾');
  const moreGroups = () => {
    const own = L.moreActions && canEditSection(section) ? L.moreActions(() => load()).filter(Boolean) : [];
    const groups = own.length && own.every((x) => x.items) ? own : own.length ? [{ items: own }] : [];
    if (canExport) groups.push({ sep: groups.length > 0, items: [{ label: '⇩ Excel', onSelect: () => doExport(moreBtn) }] });
    return groups;
  };
  moreBtn.onclick = () => openPopMenu({ anchor: moreBtn, side: 'down', groups: moreGroups() });
  moreBtn.hidden = !canExport && !(L.moreActions && canEditSection(section));
  const exportBtn = moreBtn;
  // «Выбрать» — явный вход в выбор нескольких строк (на ПК без Ctrl+клик, на телефоне без долгого нажатия)
  const selBtn = false ? h('button', { class: 'btn btn-ghost', type: 'button', title: 'Отметить несколько строк и изменить их разом (на ПК — Ctrl+клик, на телефоне — долгое нажатие)',
    onclick: () => (bulkMode ? exitBulkMode() : enterBulkMode()) }, 'Выбрать') : null;
  // ---------- Поиск и фильтры (создаются один раз) ----------
  // общий поиск (ПО.3): пусто = весь список — q убирается из адреса и запроса, страница — на первую
  const defaultSearch = L.searchPlaceholder || 'Поиск…';
  const sb = searchBox({ value: P.q || '', placeholder: defaultSearch, onSearch: (q) => patch({ q: q || undefined, page: undefined }) });
  const chipFilters = (L.filters || []).filter((f) => f.type === 'chips');
  const otherFilters = (L.filters || []).filter((f) => f.type !== 'chips' && f.type !== 'hidden');
  const side = !!(L.sidebar || otherFilters.length || L.toolbarExtra);
  const sideChips = L.sidebar && !L.chipsTop;
  // C266 §3.0: число один раз — в чипе «Все N», не ещё в h1. На доске и Ганте чипы скрыты — число остаётся в h1.
  const countInChips = chipFilters.some((f) => f.count);
  const head = h('div', { class: 'page-head' },
    h('h1', null, section.title, ' ', countEl),
    h('span', { class: 'spacer' }),
    viewSwitch,
    selBtn,
    ...(L.headActions && canEditSection(section) ? L.headActions(() => load()) : []),
    exportBtn,
    canCreate ? h('button', { class: 'btn btn-primary', type: 'button', onclick: onCreate, title: 'Клавиша N' }, '+ ' + (L.createLabel || 'Создать')) : null);
  const toolbar = h('div', { class: 'toolbar' }, side ? null : h('div', { class: 'search' }, sb.el));
  const controls = {};
  const sideParts = []; // выпадающие списки/даты левой панели
  for (const f of otherFilters) {
    if (f.type === 'date') {
      const inp = h('input', { type: 'date', 'aria-label': f.label, onchange: (e) => patch({ [f.key]: e.target.value, page: undefined }) });
      controls[f.key] = inp;
      sideParts.push(h('label', { class: 'date-f opt' }, h('span', null, f.short || f.label), inp));
      continue;
    }
    const sel = h('select', { class: 'opt', 'aria-label': f.label, onchange: (e) => patch({ [f.key]: e.target.value, page: undefined }) }, h('option', { value: '' }, f.allLabel || f.label));
    controls[f.key] = sel;
    sideParts.push(h('div', { class: 'ls-group' }, h('div', { class: 'ls-h' }, f.label), sel));
    Promise.resolve(f.options()).then((opts) => {
      for (const o of opts) sel.append(h('option', { value: String(o.value) }, o.label));
      sel.value = P[f.key] || '';
      enhanceSelect(sel); // длинные названия (поставщики, категории) — общий список без обрезки (ВС.6)
    }).catch(() => { /* фильтр без вариантов — не критично */ });
  }
  const extra = L.toolbarExtra ? L.toolbarExtra() : null;
  if (extra) { sideParts.push(extra.el); extra.update(P, st()); }
  const resetBtn = h('button', { class: 'btn btn-sm ls-reset', type: 'button', onclick: () => resetFilters() }, side ? 'Сбросить всё' : 'Сбросить');
  if (!side) toolbar.append(resetBtn);
  let ganttCount = 0;
  const filterState = () => listFilterState(L, P, st());
  const activeFilters = () => filterState().filters;
  const selCount = () => filterState().count;
  const anyFilter = () => selCount() > 0 || (st().gantt && ganttCount > 0);
  function resetFilters() {
    const { clear } = filterState();
    if (st().gantt && ganttCount) gantt?.resetFilters?.();
    sb.set('', true); patch(clear);
  }
  const chipsBox = h('div', { class: sideChips ? 'ls-chips' : 'chips' });
  const hintBox = h('div', { class: 'list-hint', hidden: true });
  let chipOpts = null;
  let lastResp = null;
  let rawRows = [];
  Promise.all(chipFilters.map((f) => Promise.resolve(f.options()))).then((o) => { chipOpts = o; renderChips(); });
  function renderChips() { paintChips({ chipsBox, chipFilters, chipOpts, sideChips, P, isBoard: st().board, lastResp }); }

  // ---------- Таблица и карточки ----------
  const theadRow = h('tr');
  function renderHead() {
    const { sort } = st();
    if (bulkOn) headCb = h('input', { type: 'checkbox', class: 'pick-all', 'aria-label': 'Отметить все на странице', onchange: (e) => { for (const r of rows) { if (!canPick(r)) continue; if (e.target.checked) picked.add(r.id); else picked.delete(r.id); } if (!bulkMode) enterBulkMode(); syncPicks(); paintBulk(); leaveIfEmpty(); } }); // ПРД.1: «все» включает режим выбора — иначе отмеченного не видно
    theadRow.replaceChildren(...[bulkOn ? h('th', { class: 'pick' }, headCb) : null, ...L.columns.map((c) => {
      const field = c.sort;
      const isSorted = field && sort.replace(/^-/, '') === field;
      const desc = sort.startsWith('-');
      return h('th', {
        class: (field ? 'sortable ' : '') + (c.cls || ''),
        title: field ? 'Сортировать' : undefined,
        onclick: field ? () => patch({ sort: isSorted && !desc ? '-' + field : field, page: undefined }) : undefined,
      }, c.label, isSorted ? h('span', { class: 'arrow' }, desc ? '↓' : '↑') : null);
    }), L.rowAction && canEditSection(section) ? h('th', { class: 'act' }) : null].filter(Boolean));
  }
  const tbody = h('tbody');
  const cards = h('ul', { class: 'cards' });
  const galleryBox = h('div', { class: 'gal-box', hidden: true });
  const tableWrap = h('div', { class: 'table-wrap' }, h('table', { class: 'list' }, h('thead', null, theadRow), tbody));
  const tableBox = h('div', null, tableWrap, cards);
  const foot = h('div', { class: 'list-foot' });
  const quickBox = quick && canCreate ? quick : null;
  // БЗ-9: отметка записей и «Изменить выбранные» — только где раздел объявил L.bulk и есть право правки
  const bulkOn = !!L.bulk && canEditSection(section);
  const picked = new Set(); const canPick = (r) => !L.bulk?.can || L.bulk.can(r); const always = !!L.bulk; /* bulk.can — какие строки отмечать; bulk.always — флажки сразу, без «Выбрать» */
  let bulkMode = false;
  const bulkBar = bulkOn ? h('div', { class: 'bulk-bar', hidden: true, role: 'region', 'aria-label': 'Выбранные записи' }) : null;
  const paintBulk = () => {
    if (!bulkBar) return;
    // полоса видна весь режим выбора (и при 0 отмеченных): иначе из режима не выйти
    bulkBar.hidden = always ? !picked.size : (!bulkMode && !picked.size);
    if (selBtn) selBtn.classList.toggle('active', bulkMode);
    const pickedRows = () => rows.filter((r) => picked.has(r.id));
    bulkBar.replaceChildren(h('b', null, picked.size ? `Выбрано: ${qty(picked.size)}` : 'Отметьте строки — клик по строке или галочке'),
      picked.size && L.bulk.open ? h('button', { type: 'button', class: 'btn btn-sm', disabled: !!L.bulk.disabled?.(pickedRows()), onclick: () => L.bulk.open([...picked], { done: () => { exitBulkMode(); load({ keep: true }); }, rows: pickedRows() }) }, (typeof L.bulk.label === 'function' ? L.bulk.label(pickedRows()) : L.bulk.label) || 'Изменить выбранные') : null,
      ...(picked.size ? (L.bulk.extra || []).filter((a) => !a.when || a.when(pickedRows())).map((a) => h('button', { type: 'button', class: 'btn btn-sm', onclick: () => a.run([...picked], pickedRows()) }, a.label)) : []),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => exitBulkMode() }, always ? 'Снять выбор' : 'Готово'));
    const all = headPick(); if (all) { const ids = rows.filter(canPick).map((r) => r.id); all.checked = ids.length > 0 && ids.every((id) => picked.has(id)); all.indeterminate = !all.checked && ids.some((id) => picked.has(id)); }
  };
  const pickBox = (row) => !canPick(row) ? h('span', { class: 'pick-cb pick-none' }) : h('input', { type: 'checkbox', class: 'pick-cb', checked: picked.has(row.id), dataset: { id: row.id }, 'aria-label': 'Отметить запись',
    onclick: (e) => e.stopPropagation(), onchange: (e) => { if (e.target.checked) picked.add(row.id); else picked.delete(row.id); if (!bulkMode) enterBulkMode(); syncPicks(); paintBulk(); leaveIfEmpty(); } });
  const syncPicks = () => panel.querySelectorAll('.pick-cb').forEach((cb) => { cb.checked = picked.has(cb.dataset.id); });
  let headCb = null;
  const headPick = () => headCb;
  // L.top(reload) — свой блок над списком (полоса состояния загрузки и т. п.), создаётся один раз
  const topBox = L.top ? L.top(() => load()) : null;
  topBox?.onParams?.(P, st()); // top может следить за адресом (крошки)
  const panel = h('div', { class: 'panel list-panel' }, chipFilters.length && !sideChips ? chipsBox : null, topBox, hintBox, side ? null : toolbar, bulkBar, quickBox, tableBox, galleryBox, foot);
  const boardBox = h('div');
  const ganttBox = h('div', { hidden: true });
  let board = null; let gantt = null;
  const enterBulkMode = (id) => { if (!bulkOn) return; bulkMode = true; panel.classList.add('bulk-mode'); if (id) picked.add(id); syncPicks(); paintBulk(); };
  const leaveIfEmpty = () => { if (!always && bulkMode && !picked.size) exitBulkMode(); }; // сняли все галочки — режим выбора выключается сам
  const togglePick = (id) => { if (picked.has(id)) picked.delete(id); else picked.add(id); syncPicks(); paintBulk(); leaveIfEmpty(); };
  const exitBulkMode = () => { bulkMode = always; if (!always) panel.classList.remove('bulk-mode'); picked.clear(); syncPicks(); paintBulk(); };
  if (always && bulkOn) { bulkMode = true; panel.classList.add("bulk-mode"); }
  const bindLong = bulkOn ? longPress(enterBulkMode) : null;

  // Плитки (категории склада)
  const tilesBox = L.tiles ? h('div', { class: side ? 'ls-list' : 'tiles' }) : null;
  const tileTagBox = tilesBox && side ? h('div', { class: 'ls-tile-tag', hidden: true }) : null;
  const tilesGroup = tilesBox && side ? h('div', { class: 'ls-group' }, h('div', { class: 'ls-h' }, L.tiles.title || 'Категории'), tileTagBox, tilesBox) : null;
  let tiles = [];
  const loadTiles = (again) => Promise.resolve(L.tiles.load()).then((t) => { tiles = t; renderTiles(); }).catch(() => { if (!again) (tilesGroup || tilesBox).remove(); });
  if (tilesBox) loadTiles(false);
  function renderTiles() { paintTiles({ L, P, tiles, tilesBox, tileTagBox, side }); }
  const ganttFields = L.gantt ? h('div', { hidden: true }) : null;
  const filters = side ? filterPanel({ key: section.id, search: sb.el, reset: resetBtn,
    fields: [tilesGroup, chipFilters.length && sideChips ? chipsBox : null, ...sideParts, ganttFields],
    content: [panel, boardBox, ganttBox] }) : null;
  const inlineChipTools = L.board?.inlineChips && chipFilters.length && !sideChips ? filters?.el.querySelector(':scope > .filter-tools') : null;
  const el = mark(h('div', { class: 'list-screen' + (side ? ' has-side' : '') }, head,
    filters ? filters.el : [tilesBox, panel, boardBox, ganttBox]), 'list');
  function syncControls() {
    const { board: isBoard, gallery: isGallery, gantt: isGantt } = st();
    const chipHost = inlineChipTools && (isBoard ? inlineChipTools : panel);
    if (chipHost && chipsBox.parentElement !== chipHost) chipHost.insertBefore(chipsBox, isBoard ? null : panel.firstChild);
    sb.set(P.q || '');
    sb.input.placeholder = (isGantt && L.gantt.searchPlaceholder) || defaultSearch;
    for (const [k, c] of Object.entries(controls)) c.value = P[k] || '';
    const filtered = anyFilter() || !!P.q;
    resetBtn.hidden = !filtered;
    resetBtn.classList.toggle('is-on', filtered);
    if (ganttFields) ganttFields.hidden = !isGantt;
    filters?.setCount(selCount() + (isGantt ? ganttCount : 0));
    btnBoard.classList.toggle('active', isBoard);
    btnGallery.classList.toggle('active', isGallery);
    btnGantt?.classList.toggle('active', isGantt);
    btnTable.classList.toggle('active', !isBoard && !isGallery && !isGantt);
    tableBox.hidden = isBoard || isGallery || isGantt; foot.hidden = isBoard || isGantt; galleryBox.hidden = !isGallery;
    countEl.hidden = countInChips && !isBoard && !isGantt;
    if (quickBox) quickBox.hidden = isBoard || isGantt;
    panel.classList.toggle('compact', isBoard || isGantt);
    boardBox.hidden = !isBoard; ganttBox.hidden = !isGantt;
    chipsBox.hidden = isGantt; renderHead(); renderChips(); renderTiles();
    // C266 §3.0: серая подсказка над таблицей выключена. L.hintsOn — только если без текста нельзя работать.
    const hint = L.hintsOn && L.hints && !isBoard ? L.hints[P[L.hintKey || 'status'] || ''] : '';
    // banner(P) → { text, keys } — особая выборка (пришли по ссылке «Все →»): пометка + «Показать все» (снимает keys)
    const bn = L.banner ? L.banner(P) : null;
    if (bn) { hintBox.replaceChildren(h('b', null, bn.text), ' ', h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => patch(Object.fromEntries([...bn.keys, 'page'].map((k) => [k, undefined]))) }, 'Показать все')); hintBox.hidden = false; hintBox.classList.add('banner'); }
    else { hintBox.classList.remove('banner'); hintBox.textContent = hint || ''; hintBox.hidden = !hint; }
  }

  function markSelected() {
    [...tbody.children].forEach((tr) => { const r = rows[Number(tr.dataset.i)]; tr.classList.toggle('selected', !!r && r.id === P.open); });
    [...cards.children].forEach((li, i) => li.classList.toggle('selected', !!rows[i] && rows[i].id === P.open));
    galleryBox.querySelectorAll('.gcard').forEach((b) => b.classList.toggle('selected', b.dataset.id === P.open));
    const sel = tbody.querySelector('tr.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function stateRow(make) {
    tbody.replaceChildren(h('tr', { class: 'state-row' }, h('td', { colspan: L.columns.length + (L.rowAction ? 1 : 0) + (bulkOn ? 1 : 0) }, make())));
    cards.replaceChildren(h('li', { class: 'state-row' }, make()));
    // галерея («Продукция», «Паспорта»): таблица скрыта — то же состояние («ничего не найдено», загрузка, ошибка) здесь
    galleryBox.replaceChildren(make());
  }

  // ---------- Загрузка ----------
  let seq = 0; let destroyed = false;
  let loaded = false;
  const currentQuery = (isBoard = false) => listQuery(L, P, activeFilters(), isBoard);
  // ПГ-1: автоподгрузка — строки добавляются при прокрутке к низу; адресный page не используется
  let pagesLoaded = 1, loadingMore = false;
  const moreNote = h('span', { class: 'muted' });
  const canMore = () => !destroyed && !loadingMore && lastResp && rows.length < lastResp.total && !panel.classList.contains('loading') && !st().board && !st().gantt && !L.periods?.(P);
  // таблица прокручивается в своём окне .table-wrap: подвал вне окна всегда виден и тянул бы страницы подряд → в окне свой наблюдатель, у подвала — только без таблицы (карточки, галерея)
  const watch = moreSentinel({ hasMore: () => canMore() && !tableWrap.offsetParent, onMore: () => load({ append: true }) }), sentinel = watch.el;
  const watchIn = moreSentinel({ root: tableWrap, hasMore: canMore, onMore: () => load({ append: true }) }); tableWrap.append(watchIn.el);
  const rewatch = () => { watch.rewatch(); watchIn.rewatch(); };
  async function load(opt = {}) {
    if (destroyed || (opt.append && !canMore())) return;
    const my = ++seq, loadT0 = performance.now();
    loadingMore = !!opt.append;
    let { limit, page, sort, board: isBoard, gallery: isGallery, gantt: isGantt } = st();
    if (isGallery) { limit = Number(P.limit) || L.gallery.limit || 100; sort = P.sort || L.gallery.sort || sort; }
    let query;
    try { query = await currentQuery(isBoard); } catch (e) {
      if (my !== seq || destroyed) return;
      panel.classList.remove('loading'); loadingMore = false;
      stateRow(() => failBlock(e, () => load()));
      return;
    }
    if (my !== seq || destroyed) return;
    // query может загрузить контекст зоны. Его чистые колонки/default нужны до запроса и заголовка.
    L.columns = (L.columnsFor?.(P) || section.list.columns).filter(c => !c.money || session.canMoney).map(c => ({ ...c }));
    if (!P.sort && !isGallery) sort = st().sort;
    const snapshot = { columns: L.columns.map(c => ({ ...c })), query: { ...query }, sort };
    renderHead();
    if (L.columnsFor || L.sortFor) extra?.update(P, st());
    const per = L.periods ? L.periods(P) : null;
    if (per && !isBoard) { limit = 2000; page = 1; }
    if (isGantt) {
      firstDrawn(); countEl.textContent = '';
      if (!gantt) { gantt = L.gantt.mount(L.gantt, L.path, query, { filterFields: ganttFields, onFilterCount: (n) => { ganttCount = n; if (st().gantt) { filters?.setCount(selCount() + n); const on = anyFilter() || !!P.q; resetBtn.hidden = !on; resetBtn.classList.toggle('is-on', on); } }, onOpen, onChanged: () => gantt.reload(), onTotal: (n) => { if (st().gantt) countEl.textContent = qty(n); } }); ganttBox.replaceChildren(gantt.el); }
      else gantt.setQuery(query);
      return;
    }
    if (isBoard) {
      firstDrawn(); countEl.textContent = '';
      if (!board) { board = (L.board.mount || mountBoard)(L.board, L.path, query, { onOpen, onChanged: () => board.reload(), onTotal: (n) => { if (st().board) countEl.textContent = qty(n); } }); boardBox.replaceChildren(board.el); }
      else board.setQuery(query);
      return;
    }
    const infinite = !per;
    const append = infinite && !!opt.append && !!lastResp;
    if (infinite && !append && !opt.keep) pagesLoaded = 1;
    if (infinite) page = 1;
    if (isGallery && L.landing && !picked.size && L.landing.when(P)) { // галочки видны всегда — стартовые плитки показываем, пока ничего не отмечено
      countEl.textContent = ''; foot.replaceChildren(); panel.classList.remove('loading');
      let node;
      try { node = await L.landing.render({ pick: (v) => patch({ [L.tiles?.key || 'groupId']: v, page: undefined }) }); }
      catch (e) { node = failBlock(e, () => load()); }
      if (my !== seq) return;
      loaded = true; rows = []; galleryBox.replaceChildren(node); firstDrawn();
      return;
    }
    if (append) { loadingMore = true; moreNote.textContent = 'Загрузка…'; } else if (!loaded) stateRow(() => h('div', { class: 'skel-block' }, ...Array.from({ length: 6 }, () => h('div', { class: 'skel' }))));
    if (!append) panel.classList.add('loading');
    const pull = (pageNo) => api(L.path, { query: { ...query, page: pageNo, limit, sort } }).then((raw) => (L.normalize ? L.normalize(raw, { ...query, page: pageNo, limit, sort }) : raw));
    let resp;
    try {
      if (append) {
        resp = await pull(pagesLoaded + 1);
        if (my === seq) { resp = { ...resp, items: [...rawRows, ...resp.items] }; pagesLoaded++; }
      } else if (infinite && opt.keep && pagesLoaded > 1) {
        const n = pagesLoaded; resp = await pull(1);
        for (let p = 2; my === seq && p <= n && resp.items.length < resp.total; p++) { const r = await pull(p); if (my !== seq) return; resp.items = [...resp.items, ...r.items]; }
      } else resp = await pull(page);
    } catch (e) {
      if (my !== seq) return;
      loadingMore = false;
      if (append) { moreNote.textContent = ''; foot.replaceChildren(failBlock(e, () => load({ append: true }))); return; }
      panel.classList.remove('loading');
      stateRow(() => failBlock(e, () => load()));
      foot.replaceChildren();
      return;
    }
    if (my !== seq) return;
    loaded = true; loadingMore = false;
    if (!timed) { timed = true; document.removeEventListener('visibilitychange', stopTiming); const ms = performance.now() - Math.max(t0, loadT0); if (ms > 2000) reportSlow(ms, Math.max(t0, loadT0)); }
    panel.classList.remove('loading');
    lastResp = resp; rawRows = resp.items;
    tableSnapshot = snapshot;
    countEl.textContent = qty(resp.total);
    renderChips();
    rows = L.map ? resp.items.map(L.map) : resp.items; // L.map — привести строку ответа к виду { id, … } (список «Заказов»: key → id)
    if (bulkOn) queueMicrotask(paintBulk); // «все на странице» — по новой странице
    const active = anyFilter() || P.q;
    if (!rows.length) {
      stateRow(() => emptyBlock({ L, P, active, sb, resetFilters, canCreate, onCreate }));
    } else if (isGallery) {
      renderGallery();
    } else if (per) {
      renderPeriods(per);
    } else {
      paintRows({ rows, L, canAct: !!L.rowAction && canEditSection(section), bulkOn, tbody, cards, pickBox, rowClick, openOrPick, bindLong, actionButton });
      markSelected();
    }
    if (per) { foot.replaceChildren(...[h('span', null, resp.total ? `${qty(resp.total)} ${plural(resp.total, 'запись', 'записи', 'записей')} по месяцам` : ''), L.footer ? L.footer(resp) : null].filter(Boolean)); return; }
    moreNote.textContent = '';
    foot.replaceChildren(...[
      h('span', null, resp.total ? `Показано ${qty(rows.length)} из ${qty(resp.total)}` : ''),
      L.footer ? L.footer(resp) : null,
      rows.length < resp.total ? moreNote : null,
      rows.length < resp.total ? button({ label: 'Показать ещё', size: 'S', onClick: () => load({ append: true }) }) : null,
      sentinel].filter(Boolean));
    rewatch();
  }

  /* ---------- Галерея: карточки с фото по группам (ПС: паспорта по категориям) ---------- */
  const openOrPick = (row) => { if (bulkMode && !always) { togglePick(row.id); return; } onOpen(row); };
  const rowClick = (row, e) => { if (bulkMode && !always) { if (canPick(row)) togglePick(row.id); return; } if (bulkOn && (e.ctrlKey || e.metaKey)) { enterBulkMode(row.id); return; } onOpen(row); };
  function renderGallery() { paintGallery({ galleryBox, rows, L, P, bindLong, bulkOn, pickBox, openOrPick }); }

  const pstate = periodState(section.id, () => renderPeriods(L.periods(P)));
  function renderPeriods(per) {
    paintPeriods({ per, rows, P, L, canAct: !!L.rowAction && canEditSection(section), onOpen, actionButton, tbody, cards, state: pstate, markSelected });
  }

  const actionButton = rowActions(L, (o) => load(o), onChanged);

  // ---------- Клавиатура: ↑/↓ — соседняя запись, N — новая ----------
  const onKey = listKeys({ side: () => filters?.side, closeSheet: () => filters?.close(), rows: () => rows, P: () => P, st, onOpen, canCreate, onCreate });
  document.addEventListener('keydown', onKey);

  syncControls();
  load();

  /** Новые параметры адреса. Только смена открытой записи — без запроса к серверу. */
  function update(next) {
    const prev = P;
    P = { ...next };
    const same = (k) => (prev[k] || '') === (P[k] || '');
    const dataKeys = new Set([...Object.keys(prev), ...Object.keys(P)].filter((k) => !['open', 'new', 'title', 'unit', 'categoryName'].includes(k)));
    const onlyOpen = [...dataKeys].every(same);
    if (onlyOpen) { markSelected(); return; }
    syncControls();
    extra?.update(P, st());
    topBox?.onParams?.(P, st());
    load();
  }

  return {
    el,
    update,
    // после записи (dc:changed): строки, числа плиток и шаги «Уточнить» обновляются на месте, без мигания
    reload: (row) => { if (tilesBox) loadTiles(true); extra?.update(P, st()); if (st().gantt && gantt) return gantt.reload(); return st().board && board ? (row && board.reloadFor ? board.reloadFor(row) : board.reload()) : load({ keep: true }); },
    focusSearch: () => sb.focus(),
    destroy: () => { destroyed = true; seq++; gantt?.destroy?.(); document.removeEventListener('keydown', onKey); watch.destroy(); watchIn.destroy(); },
  };
}
