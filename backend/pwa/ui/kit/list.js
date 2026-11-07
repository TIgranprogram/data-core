import { exportList } from '../list-export.js';
import { makeResizable } from '../resizer.js';
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
import { viewStore, listKeys } from './list-view.js';
import { paintTiles } from './list-tiles.js';
import { paintChips } from './list-chips.js';
import { periodState, paintPeriods } from './list-periods.js';
import { rowActions, longPress, paintGallery, paintRows, emptyBlock } from './list-rows.js';

// Контракт section.list (все опции) описан в ./list-view.js
export function mountList(section, params, { onOpen, onCreate, quick, onChanged }) {
  const L = { ...section.list, columns: section.list.columns.filter((c) => !c.money || session.canMoney) };
  let P = { ...params };
  const t0 = performance.now(); // замер первой отрисовки (SPEED-2): > 2 с — запись «Медленно» в ошибки сайта
  let timed = document.hidden; // скрытая вкладка — не «медленно»: браузер её тормозит нарочно
  const stopTiming = () => { timed = true; };
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
  const viewSwitch = L.board || L.gallery || L.gantt ? h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Вид' }, btnTable, L.board ? btnBoard : null, L.gallery ? btnGallery : null, btnGantt) : null;
  const canCreate = section.form && canEditSection(section) && L.createLabel !== false;
  // «⇩ Excel» (МВ.5): весь список с текущими фильтрами — ui/list-export.js; L.export === false — без кнопки; 'admin' — только для роли admin
  const canExport = !(L.export === false || (L.export === 'admin' && session.role !== 'admin'));
  const doExport = (btn) => { const { sort } = st(); exportList({ title: section.title, path: L.path, columns: L.columns, query: currentQuery(), sort }, btn); };
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
  const head = h('div', { class: 'page-head' },
    h('h1', null, section.title, ' ', countEl),
    h('span', { class: 'spacer' }),
    viewSwitch,
    selBtn,
    ...(L.headActions && canEditSection(section) ? L.headActions(() => load()) : []),
    exportBtn,
    canCreate ? h('button', { class: 'btn btn-primary', type: 'button', onclick: onCreate, title: 'Клавиша N' }, '+ ' + (L.createLabel || 'Создать')) : null);

  // ---------- Поиск и фильтры (создаются один раз) ----------
  // общий поиск (ПО.3): пусто = весь список — q убирается из адреса и запроса, страница — на первую
  const sb = searchBox({ value: P.q || '', placeholder: L.searchPlaceholder || 'Поиск…', onSearch: (q) => patch({ q: q || undefined, page: undefined }) });
  // L.sidebar (NAV F1): поиск, категории, признаки и «Сбросить всё» — в левой панели; на телефоне она выезжает листом по кнопке «Фильтры · N»
  const side = L.sidebar ? h('aside', { class: 'list-side', 'aria-label': 'Фильтры' }) : null;
  if (side) makeResizable(side, { prefKey: 'filterW', edge: 'right', label: 'Ширина панели фильтров' });
  const toolbar = h('div', { class: 'toolbar' }, side ? null : h('div', { class: 'search' }, sb.el));
  const chipFilters = (L.filters || []).filter((f) => f.type === 'chips');
  const sideChips = side && !L.chipsTop; // СКФ.2: chipsTop — чипы строкой над таблицей и при левой панели
  const otherFilters = (L.filters || []).filter((f) => f.type !== 'chips' && f.type !== 'hidden');
  const controls = {};
  const sideParts = []; // выпадающие списки/даты левой панели
  const put = (n) => (side ? sideParts.push(n) : toolbar.append(n));
  const filtersToggle = otherFilters.length && !side ? h('button', { class: 'btn filters-toggle', type: 'button', onclick: () => toolbar.classList.toggle('open') }, 'Фильтры') : null;
  if (filtersToggle) toolbar.append(filtersToggle);
  for (const f of otherFilters) {
    if (f.type === 'date') {
      const inp = h('input', { type: 'date', 'aria-label': f.label, onchange: (e) => patch({ [f.key]: e.target.value, page: undefined }) });
      controls[f.key] = inp;
      put(h('label', { class: 'date-f opt' }, h('span', null, f.short || f.label), inp));
      continue;
    }
    const sel = h('select', { class: 'opt', 'aria-label': f.label, onchange: (e) => patch({ [f.key]: e.target.value, page: undefined }) }, h('option', { value: '' }, side ? f.allLabel || f.label : f.label));
    controls[f.key] = sel;
    put(side ? h('div', { class: 'ls-group' }, h('div', { class: 'ls-h' }, f.label), sel) : sel);
    Promise.resolve(f.options()).then((opts) => {
      for (const o of opts) sel.append(h('option', { value: String(o.value) }, o.label));
      sel.value = P[f.key] || '';
      enhanceSelect(sel); // длинные названия (поставщики, категории) — общий список без обрезки (ВС.6)
    }).catch(() => { /* фильтр без вариантов — не критично */ });
  }
  const extra = L.toolbarExtra ? L.toolbarExtra() : null;
  if (extra) { put(extra.el); extra.update(P); }
  const resetBtn = h('button', { class: 'btn btn-ghost' + (side ? ' ls-reset' : ''), type: 'button', onclick: () => resetFilters() }, side ? 'Сбросить всё' : 'Сбросить');
  if (!side) toolbar.append(resetBtn);
  /** Сколько фильтров выбрано (для кнопки «Фильтры · N» на телефоне). */
  const selCount = () => (L.filters || []).filter((f) => P[f.key]).length
    + (L.extraKeys || []).reduce((n, k) => n + (P[k] ? String(P[k]).split('|').filter(Boolean).length : 0), 0);
  const anyFilter = () => selCount() > 0;
  function resetFilters() {
    const clear = { q: undefined, page: undefined };
    for (const f of L.filters || []) clear[f.key] = undefined;
    for (const k of L.extraKeys || []) clear[k] = undefined;
    sb.set('', true);
    patch(clear);
  }

  // Чипы: варианты загружаются один раз, счётчики — с каждым ответом
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
      ...(picked.size ? (L.bulk.extra || []).map((a) => h('button', { type: 'button', class: 'btn btn-sm', onclick: () => a.run([...picked], pickedRows()) }, a.label)) : []),
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
  topBox?.onParams?.(P); // top может следить за адресом (крошки)
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

  // ---------- Левая панель: сборка, лист на телефоне ----------
  const shade = side ? h('div', { class: 'ls-shade', hidden: true, onclick: () => closeSheet() }) : null;
  const openBtn = side ? button({ label: 'Фильтры', onClick: () => openSheet() }) : null;
  if (openBtn) { openBtn.classList.add('ls-open-btn'); openBtn.setAttribute('aria-expanded', 'false'); }
  if (side) {
    side.append(
      h('div', { class: 'ls-head' }, h('b', null, 'Фильтры'), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Закрыть', onclick: () => closeSheet() }, '×')),
      h('div', { class: 'ls-body' }, h('div', { class: 'ls-search' }, sb.el), tilesGroup, chipFilters.length && sideChips ? chipsBox : null, ...sideParts, resetBtn),
      h('div', { class: 'ls-foot' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => closeSheet() }, 'Показать')));
    head.insertBefore(openBtn, head.querySelector('.spacer').nextSibling);
  }
  function openSheet() { side.classList.add('open'); shade.hidden = false; openBtn.setAttribute('aria-expanded', 'true'); }
  function closeSheet() { side.classList.remove('open'); shade.hidden = true; openBtn.setAttribute('aria-expanded', 'false'); }
  const el = mark(side
    ? h('div', { class: 'list-screen has-side' }, head, h('div', { class: 'ls-grid' }, side, h('div', { class: 'ls-main' }, panel, boardBox, ganttBox)), shade)
    : h('div', { class: 'list-screen' }, head, tilesBox, panel, boardBox, ganttBox), 'list');

  // ---------- Синхронизация элементов с адресом ----------
  function syncControls() {
    const { board: isBoard, gallery: isGallery, gantt: isGantt } = st();
    sb.set(P.q || '');
    for (const [k, c] of Object.entries(controls)) c.value = P[k] || '';
    const nOpt = otherFilters.filter((f) => P[f.key]).length;
    if (filtersToggle) filtersToggle.textContent = 'Фильтры' + (nOpt ? ' · ' + nOpt : '');
    resetBtn.hidden = !(anyFilter() || P.q);
    if (openBtn) openBtn.textContent = 'Фильтры' + (selCount() ? ' · ' + selCount() : '');
    btnTable.classList.toggle('active', !isBoard);
    btnBoard.classList.toggle('active', isBoard);
    btnGallery.classList.toggle('active', isGallery);
    btnGantt?.classList.toggle('active', isGantt);
    btnTable.classList.toggle('active', !isBoard && !isGallery && !isGantt);
    tableBox.hidden = isBoard || isGallery || isGantt; foot.hidden = isBoard || isGantt; galleryBox.hidden = !isGallery;
    if (quickBox) quickBox.hidden = isBoard || isGantt;
    panel.classList.toggle('compact', isBoard || isGantt);
    boardBox.hidden = !isBoard; ganttBox.hidden = !isGantt;
    renderHead(); renderChips(); renderTiles();
    const hint = L.hints && !isBoard ? L.hints[P[L.hintKey || 'status'] || ''] : '';
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
  let seq = 0;
  let loaded = false;
  /** Параметры запроса из адреса: поиск, свои параметры раздела, фильтры. */
  function currentQuery(isBoard = false) {
    const query = { search: P.q, ...(L.query ? L.query(P) : {}) };
    for (const f of L.filters || []) {
      const v = P[f.key] !== undefined ? P[f.key] : (f.defaultValue || '');
      if (v && v !== 'all' && !(isBoard && f.key === 'status')) query[f.key] = v;
    }
    // доска заказов сама режет по stage колонки; filter=active обнуляет «Отгружен» и тяжелит 5× list
    if (isBoard && L.path === '/production-orders' && query.filter && query.filter !== 'all') delete query.filter;
    return query;
  }
  // ПГ-1: автоподгрузка — строки добавляются при прокрутке к низу; адресный page не используется
  let pagesLoaded = 1, loadingMore = false;
  const moreNote = h('span', { class: 'muted' });
  const canMore = () => !loadingMore && lastResp && rows.length < lastResp.total && !panel.classList.contains('loading');
  // таблица прокручивается в своём окне .table-wrap: подвал вне окна всегда виден и тянул бы страницы подряд → в окне свой наблюдатель, у подвала — только без таблицы (карточки, галерея)
  const watch = moreSentinel({ hasMore: () => canMore() && !tableWrap.offsetParent, onMore: () => load({ append: true }) }), sentinel = watch.el;
  const watchIn = moreSentinel({ hasMore: canMore, onMore: () => load({ append: true }) }); tableWrap.append(watchIn.el);
  const rewatch = () => { watch.rewatch(); watchIn.rewatch(); };
  async function load(opt = {}) {
    let { limit, page, sort, board: isBoard, gallery: isGallery, gantt: isGantt } = st();
    if (isGallery) { limit = Number(P.limit) || L.gallery.limit || 100; sort = P.sort || L.gallery.sort || sort; }
    const query = currentQuery(isBoard);
    const per = L.periods ? L.periods(P) : null;
    if (per && !isBoard) { limit = 2000; page = 1; }
    if (isGantt) {
      countEl.textContent = '';
      if (!gantt) { gantt = L.gantt.mount(L.gantt, L.path, query, { onOpen, onChanged: () => gantt.reload(), onTotal: (n) => { if (st().gantt) countEl.textContent = qty(n); } }); ganttBox.replaceChildren(gantt.el); }
      else gantt.setQuery(query);
      return;
    }
    if (isBoard) {
      countEl.textContent = '';
      if (!board) { board = (L.board.mount || mountBoard)(L.board, L.path, query, { onOpen, onChanged: () => board.reload(), onTotal: (n) => { if (st().board) countEl.textContent = qty(n); } }); boardBox.replaceChildren(board.el); }
      else board.setQuery(query);
      return;
    }
    const my = ++seq;
    const infinite = !per;
    const append = infinite && !!opt.append && !!lastResp;
    if (infinite && !append && !opt.keep) pagesLoaded = 1;
    if (infinite) page = 1;
    if (isGallery && L.landing && !picked.size && L.landing.when(P)) { // галочки видны всегда — стартовые плитки показываем, пока ничего не отмечено
      countEl.textContent = ''; foot.replaceChildren(); panel.classList.remove('loading');
      const node = await L.landing.render({ pick: (v) => patch({ [L.tiles?.key || 'groupId']: v, page: undefined }) });
      if (my !== seq) return;
      loaded = true; rows = []; galleryBox.replaceChildren(node);
      return;
    }
    if (append) { loadingMore = true; moreNote.textContent = 'Загрузка…'; } else if (!loaded) stateRow(() => h('div', { class: 'skel-block' }, ...Array.from({ length: 6 }, () => h('div', { class: 'skel' }))));
    if (!append) panel.classList.add('loading');
    let resp;
    try {
      if (append) {
        resp = await api(L.path, { query: { ...query, page: pagesLoaded + 1, limit, sort } });
        if (my === seq) { resp = { ...resp, items: [...rawRows, ...resp.items] }; pagesLoaded++; }
      } else if (infinite && opt.keep && pagesLoaded > 1) {
        const n = pagesLoaded; resp = await api(L.path, { query: { ...query, page: 1, limit, sort } });
        for (let p = 2; p <= n && resp.items.length < resp.total; p++) { const r = await api(L.path, { query: { ...query, page: p, limit, sort } }); resp.items = [...resp.items, ...r.items]; }
      } else resp = await api(L.path, { query: { ...query, page, limit, sort } });
    } catch (e) {
      loadingMore = false;
      if (my !== seq) return;
      if (append) { moreNote.textContent = ''; foot.replaceChildren(failBlock(e, () => load({ append: true }))); return; }
      panel.classList.remove('loading');
      stateRow(() => failBlock(e, () => load()));
      foot.replaceChildren();
      return;
    }
    if (my !== seq) return;
    loaded = true; loadingMore = false;
    if (!timed) { timed = true; document.removeEventListener('visibilitychange', stopTiming); const ms = performance.now() - t0; if (ms > 2000) reportSlow(ms, t0); }
    panel.classList.remove('loading');
    lastResp = resp; rawRows = resp.items;
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
  const onKey = listKeys({ side: () => side, closeSheet, rows: () => rows, P: () => P, st, onOpen, canCreate, onCreate });
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
    extra?.update(P);
    topBox?.onParams?.(P);
    load();
  }

  return {
    el,
    update,
    // после записи (dc:changed): строки, числа плиток и шаги «Уточнить» обновляются на месте, без мигания
    reload: (row) => { if (tilesBox) loadTiles(true); extra?.update(P); if (st().gantt && gantt) return gantt.reload(); return st().board && board ? (row && board.reloadFor ? board.reloadFor(row) : board.reload()) : load({ keep: true }); },
    focusSearch: () => sb.focus(),
    destroy: () => { document.removeEventListener('keydown', onKey); watch.destroy(); watchIn.destroy(); },
  };
}
