import { exportList } from './list-export.js';
import { searchBox } from './searchbox.js';
import { enhanceSelect } from './select.js';
import { api, canEditSection, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty, plural } from '../core/format.js';
import { patch } from '../core/router.js';
import { mountBoard } from './board.js';
import { icon } from './icons.js';
import { pager } from './pager.js';
import { toastError } from './toast.js';
import { errText } from './errors.js';

/**
 * Экран-список (CANON §2) — один на все разделы. Состояние — в адресе: page, limit, q, sort, фильтры, view, open.
 * Экран строится ОДИН раз; смена фильтра/страницы/сортировки — update(params): элементы управления не пересоздаются,
 * строки заменяются, когда пришли новые данные (старые остаются видны, без моргания).
 * section.list = {
 *   toolbarExtra?() → { el, update(P) } — свой элемент в панели инструментов (фильтры по признакам у «Остатков»), extraKeys — его ключи в адресе;
 *   path, sortDefault, searchPlaceholder, createLabel, headActions?() → [кнопки рядом с «+ Создать»],
 *   columns: [{ key, label, sort?, cls?, render(row) }],
 *   card: { title(row), sub(row), side(row), thumb?(row) },        // вид на телефоне
 *   filters: [{ key, label, type: 'chips'|'select'|'date'|'hidden', options: async () => [{ value, label }], count?(resp, value) }],
 *   footer?(resp), query?(params),
 *   board?: см. ui/board.js — вид «Доска», ?view=board,
 *   gallery?: { default?, limit, sort, lastGroup?, groupBy(row) → подпись группы, card(row) → { pic, title, meta, badge } } — вид «Галерея» (?view=gallery): карточки с фото по группам,
 *   bulk?: { label?, open(ids, { done }) } — отметка записей галочками (таблица, карточки, галерея; «все на странице») и
 *     полоса «Выбрано: N · Изменить выбранные · Снять выбор» (БЗ-9); open — панель массового изменения справа, done() — снять отметки и обновить.
 *   tiles?: { key, load: async () => [{ value, label, n, sub }] } — плитки-фильтр над списком,
 *   quick?: { placeholder, fields, create(values) } — быстрое добавление одной строкой (ui/quick.js),
 *   hints?: { [значение фильтра status]: 'что делать с этими записями' } — подсказка под вкладками,
 *   rowAction?(row) → { label, title, run(row) } | null — кнопка следующего шага в строке (как на «Сегодня»),
 *   groupBy?(row) → подпись группы (строка-заголовок при смене значения: дни в «Движениях»), groupTotal?(rows) → узел,
 *   колонка { money: true } — только тем, кто видит деньги (session.canMoney);
 *   periods?(P) → null | { date(row) → дата, total?(rows) → узел } — завершённое сворачивается по месяцам/годам
 *     (TASKS фаза М): список грузится целиком (до 2000), текущий месяц раскрыт, прошлые — строкой «Сентябрь 2026 · 34»,
 *     прошлые годы — строкой года; раскрытое запоминается. При поиске — всё раскрыто.
 * }
 * Возвращает { el, update(params), reload(), focusSearch(), destroy() }.
 */
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export function mountList(section, params, { onOpen, onCreate, quick, onChanged }) {
  const L = { ...section.list, columns: section.list.columns.filter((c) => !c.money || session.canMoney) };
  let P = { ...params };
  const st = () => ({
    limit: Number(P.limit) || 25,
    page: Math.max(1, Number(P.page) || 1),
    sort: P.sort || L.sortDefault,
    board: !!L.board && P.view === 'board',
    gallery: !!L.gallery && (P.view === 'gallery' || (!!L.gallery.default && !P.view)),
  });
  let rows = [];

  // ---------- Шапка ----------
  const countEl = h('span', { class: 'count' });
  const btnTable = h('button', { type: 'button', onclick: () => patch({ view: L.gallery?.default ? 'table' : undefined, page: undefined }) }, icon('table'), 'Таблица');
  const btnBoard = h('button', { type: 'button', onclick: () => patch({ view: 'board', page: undefined, status: undefined }) }, icon('board'), 'Доска');
  const btnGallery = h('button', { type: 'button', onclick: () => patch({ view: L.gallery?.default ? undefined : 'gallery', page: undefined }) }, icon('gallery'), 'Галерея');
  const viewSwitch = L.board || L.gallery ? h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Вид' }, btnTable, L.board ? btnBoard : null, L.gallery ? btnGallery : null) : null;
  const canCreate = section.form && canEditSection(section) && L.createLabel !== false;
  // «⇩ Excel» (МВ.5): весь список с текущими фильтрами — ui/list-export.js; L.export === false — без кнопки
  const exportBtn = L.export === false ? null : h('button', { class: 'btn btn-ghost', type: 'button', title: 'Скачать весь список с текущими фильтрами в Excel',
    onclick: (e) => { const { sort } = st(); exportList({ title: section.title, path: L.path, columns: L.columns, query: currentQuery(), sort }, e.currentTarget); } }, '⇩ Excel');
  const head = h('div', { class: 'page-head' },
    h('h1', null, section.title, ' ', countEl),
    h('span', { class: 'spacer' }),
    viewSwitch,
    exportBtn,
    ...(L.headActions && canEditSection(section) ? L.headActions(() => load()) : []),
    canCreate ? h('button', { class: 'btn btn-primary', type: 'button', onclick: onCreate, title: 'Клавиша N' }, '+ ' + (L.createLabel || 'Создать')) : null);

  // ---------- Поиск и фильтры (создаются один раз) ----------
  // общий поиск (ПО.3): пусто = весь список — q убирается из адреса и запроса, страница — на первую
  const sb = searchBox({ value: P.q || '', placeholder: L.searchPlaceholder || 'Поиск…', onSearch: (q) => patch({ q: q || undefined, page: undefined }) });
  const toolbar = h('div', { class: 'toolbar' }, h('div', { class: 'search' }, sb.el));
  const chipFilters = (L.filters || []).filter((f) => f.type === 'chips');
  const otherFilters = (L.filters || []).filter((f) => f.type !== 'chips' && f.type !== 'hidden');
  const controls = {};
  const filtersToggle = otherFilters.length ? h('button', { class: 'btn filters-toggle', type: 'button', onclick: () => toolbar.classList.toggle('open') }, 'Фильтры') : null;
  if (filtersToggle) toolbar.append(filtersToggle);
  for (const f of otherFilters) {
    if (f.type === 'date') {
      const inp = h('input', { type: 'date', 'aria-label': f.label, onchange: (e) => patch({ [f.key]: e.target.value, page: undefined }) });
      controls[f.key] = inp;
      toolbar.append(h('label', { class: 'date-f opt' }, h('span', null, f.short || f.label), inp));
      continue;
    }
    const sel = h('select', { class: 'opt', 'aria-label': f.label, onchange: (e) => patch({ [f.key]: e.target.value, page: undefined }) }, h('option', { value: '' }, f.label));
    controls[f.key] = sel;
    toolbar.append(sel);
    Promise.resolve(f.options()).then((opts) => {
      for (const o of opts) sel.append(h('option', { value: String(o.value) }, o.label));
      sel.value = P[f.key] || '';
      enhanceSelect(sel); // длинные названия (поставщики, категории) — общий список без обрезки (ВС.6)
    }).catch(() => { /* фильтр без вариантов — не критично */ });
  }
  const extra = L.toolbarExtra ? L.toolbarExtra() : null;
  if (extra) { toolbar.append(extra.el); extra.update(P); }
  const resetBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => resetFilters() }, 'Сбросить');
  toolbar.append(resetBtn);
  function resetFilters() {
    const clear = { q: undefined, page: undefined };
    for (const f of L.filters || []) clear[f.key] = undefined;
    for (const k of L.extraKeys || []) clear[k] = undefined;
    sb.set('', true);
    patch(clear);
  }

  // Чипы: варианты загружаются один раз, счётчики — с каждым ответом
  const chipsBox = h('div', { class: 'chips' });
  const hintBox = h('div', { class: 'list-hint', hidden: true });
  let chipOpts = null;
  let lastResp = null;
  Promise.all(chipFilters.map((f) => Promise.resolve(f.options()))).then((o) => { chipOpts = o; renderChips(); });
  function renderChips() {
    if (!chipOpts) return;
    chipsBox.replaceChildren(...chipFilters.flatMap((f, i) => {
      if (st().board && f.key === 'status') return [];
      const cur = P[f.key] || f.defaultValue || '';
      return [...(f.noAll ? [] : [{ value: '', label: f.allLabel || 'Все' }]), ...chipOpts[i]].map((o) => {
        const n = f.count && lastResp ? f.count(lastResp, o.value) : undefined;
        return h('button', {
          type: 'button', class: 'chip' + (String(o.value) === cur ? ' active' : ''),
          onclick: () => patch({ [f.key]: String(o.value) === cur ? undefined : o.value, page: undefined }),
        }, o.label, n !== undefined ? h('b', null, qty(n)) : null);
      });
    }));
  }

  // ---------- Таблица и карточки ----------
  const theadRow = h('tr');
  function renderHead() {
    const { sort } = st();
    if (bulkOn) headCb = h('input', { type: 'checkbox', class: 'pick-all', 'aria-label': 'Отметить все на странице', onchange: (e) => { for (const r of rows) { if (e.target.checked) picked.add(r.id); else picked.delete(r.id); } syncPicks(); paintBulk(); } });
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
  const tableBox = h('div', null, h('div', { class: 'table-wrap' }, h('table', { class: 'list' }, h('thead', null, theadRow), tbody)), cards);
  const foot = h('div', { class: 'list-foot' });
  const quickBox = quick && canCreate ? quick : null;
  // БЗ-9: отметка записей и «Изменить выбранные» — только где раздел объявил L.bulk и есть право правки
  const bulkOn = !!L.bulk && canEditSection(section);
  const picked = new Set();
  const bulkBar = bulkOn ? h('div', { class: 'bulk-bar', hidden: true, role: 'region', 'aria-label': 'Выбранные записи' }) : null;
  const paintBulk = () => {
    if (!bulkBar) return;
    bulkBar.hidden = !picked.size;
    bulkBar.replaceChildren(h('b', null, `Выбрано: ${qty(picked.size)}`),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => L.bulk.open([...picked], { done: () => { picked.clear(); paintBulk(); load(); } }) }, L.bulk.label || 'Изменить выбранные'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { picked.clear(); paintBulk(); syncPicks(); } }, 'Снять выбор'));
    const all = headPick(); if (all) { const ids = rows.map((r) => r.id); all.checked = ids.length > 0 && ids.every((id) => picked.has(id)); all.indeterminate = !all.checked && ids.some((id) => picked.has(id)); }
  };
  const pickBox = (row) => h('input', { type: 'checkbox', class: 'pick-cb', checked: picked.has(row.id), dataset: { id: row.id }, 'aria-label': 'Отметить запись',
    onclick: (e) => e.stopPropagation(), onchange: (e) => { if (e.target.checked) picked.add(row.id); else picked.delete(row.id); syncPicks(); paintBulk(); } });
  const syncPicks = () => panel.querySelectorAll('.pick-cb').forEach((cb) => { cb.checked = picked.has(cb.dataset.id); });
  let headCb = null;
  const headPick = () => headCb;
  const panel = h('div', { class: 'panel list-panel' }, chipFilters.length ? chipsBox : null, hintBox, toolbar, bulkBar, quickBox, tableBox, galleryBox, foot);
  const boardBox = h('div');
  let board = null;

  // Плитки (категории склада)
  const tilesBox = L.tiles ? h('div', { class: 'tiles' }) : null;
  let tiles = [];
  if (tilesBox) Promise.resolve(L.tiles.load()).then((t) => { tiles = t; renderTiles(); }).catch(() => tilesBox.remove());
  function renderTiles() {
    if (!tilesBox) return;
    const cur = P[L.tiles.key] || '';
    tilesBox.replaceChildren(...tiles.map((x) => h('button', {
      type: 'button', class: 'tile' + (String(x.value) === cur ? ' active' : ''),
      onclick: () => patch({ [L.tiles.key]: String(x.value) === cur ? undefined : x.value, page: undefined }),
    }, h('b', { title: x.label }, x.label), h('span', { class: 'tl-n' }, qty(x.n)), x.sub ? h('span', { class: 'tl-sub' }, x.sub) : null)));
  }

  const el = h('div', { class: 'list-screen' }, head, tilesBox, panel, boardBox);

  // ---------- Синхронизация элементов с адресом ----------
  function syncControls() {
    const { board: isBoard, gallery: isGallery } = st();
    sb.set(P.q || '');
    for (const [k, c] of Object.entries(controls)) c.value = P[k] || '';
    const nOpt = otherFilters.filter((f) => P[f.key]).length;
    if (filtersToggle) filtersToggle.textContent = 'Фильтры' + (nOpt ? ' · ' + nOpt : '');
    resetBtn.hidden = !((L.filters || []).some((f) => P[f.key]) || P.q);
    btnTable.classList.toggle('active', !isBoard);
    btnBoard.classList.toggle('active', isBoard);
    btnGallery.classList.toggle('active', isGallery);
    btnTable.classList.toggle('active', !isBoard && !isGallery);
    tableBox.hidden = isBoard || isGallery; foot.hidden = isBoard; galleryBox.hidden = !isGallery;
    if (quickBox) quickBox.hidden = isBoard;
    panel.classList.toggle('compact', isBoard);
    boardBox.hidden = !isBoard;
    renderHead(); renderChips(); renderTiles();
    const hint = L.hints && !isBoard ? L.hints[P[L.hintKey || 'status'] || ''] : '';
    // banner(P) → { text, keys } — особая выборка (пришли по ссылке «Все →»): пометка + «Показать все» (снимает keys)
    const bn = L.banner ? L.banner(P) : null;
    if (bn) { hintBox.replaceChildren(h('b', null, bn.text), ' ', h('button', { type: 'button', class: 'link-btn', onclick: () => patch(Object.fromEntries([...bn.keys, 'page'].map((k) => [k, undefined]))) }, 'Показать все')); hintBox.hidden = false; hintBox.classList.add('banner'); }
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
    for (const f of L.filters || []) if (P[f.key] && !(isBoard && f.key === 'status')) query[f.key] = P[f.key];
    return query;
  }
  async function load() {
    let { limit, page, sort, board: isBoard, gallery: isGallery } = st();
    if (isGallery) { limit = Number(P.limit) || L.gallery.limit || 100; sort = P.sort || L.gallery.sort || sort; }
    const query = currentQuery(isBoard);
    const per = L.periods ? L.periods(P) : null;
    if (per && !isBoard) { limit = 2000; page = 1; }
    if (isBoard) {
      countEl.textContent = '';
      if (!board) { board = mountBoard(L.board, L.path, query, { onOpen, onChanged: () => board.reload() }); boardBox.replaceChildren(board.el); }
      else board.setQuery(query);
      return;
    }
    const my = ++seq;
    if (!loaded) stateRow(() => h('div', { class: 'skel-block' }, ...Array.from({ length: 6 }, () => h('div', { class: 'skel' }))));
    panel.classList.add('loading');
    let resp;
    try {
      resp = await api(L.path, { query: { ...query, page, limit, sort } });
    } catch (e) {
      if (my !== seq) return;
      panel.classList.remove('loading');
      stateRow(() => h('div', { class: 'state' }, h('div', null, 'Не удалось загрузить: ' + errText(e)), h('button', { class: 'btn', type: 'button', onclick: load }, 'Повторить')));
      foot.replaceChildren();
      return;
    }
    if (my !== seq) return;
    loaded = true;
    panel.classList.remove('loading');
    lastResp = resp;
    countEl.textContent = qty(resp.total);
    renderChips();
    rows = resp.items;
    if (bulkOn) queueMicrotask(paintBulk); // «все на странице» — по новой странице
    const active = (L.filters || []).some((f) => P[f.key]) || P.q;
    if (!rows.length) {
      if (page > 1 && resp.total > 0) { patch({ page: Math.ceil(resp.total / limit) }); return; }
      stateRow(() => active
        ? h('div', { class: 'state' }, h('div', null, P.q ? `По «${P.q}» ничего не найдено.` : 'Ничего не найдено.'),
          P.q ? h('button', { class: 'btn', type: 'button', onclick: () => { sb.set('', true); patch({ q: undefined, page: undefined }); } }, 'Сбросить поиск') : null,
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: resetFilters }, 'Сбросить всё'))
        : h('div', { class: 'state' }, h('div', null, L.emptyText || 'Записей пока нет.'),
          canCreate ? h('button', { class: 'btn btn-primary', type: 'button', onclick: onCreate }, '+ ' + (L.createLabel || 'Создать')) : null));
    } else if (isGallery) {
      renderGallery();
    } else if (per) {
      renderPeriods(per);
    } else {
      const trs = [];
      let group = null;
      rows.forEach((row, i) => {
        if (L.groupBy) {
          const g = L.groupBy(row);
          if (g !== group) {
            group = g;
            const same = rows.filter((r) => L.groupBy(r) === g);
            trs.push(h('tr', { class: 'group-row' }, h('td', { colspan: L.columns.length + (L.rowAction ? 1 : 0) + (bulkOn ? 1 : 0) }, h('span', null, g), L.groupTotal ? L.groupTotal(same) : null)));
          }
        }
        const tr = h('tr', { onclick: () => onOpen(row), dataset: { i: String(i) } },
          bulkOn ? h('td', { class: 'pick' }, pickBox(row)) : null,
          L.columns.map((c) => h('td', { class: c.cls || '' }, c.render ? c.render(row) : row[c.key] ?? '')));
        if (L.rowAction && canEditSection(section)) tr.append(h('td', { class: 'act' }, actionButton(row)));
        trs.push(tr);
      });
      tbody.replaceChildren(...trs);
      cards.replaceChildren(...rows.map((row) => h('li', { onclick: () => onOpen(row) },
        bulkOn ? pickBox(row) : null,
        L.card.thumb ? L.card.thumb(row) : null,
        h('div', { class: 'c-main' }, h('div', { class: 'c-title' }, L.card.title(row)), h('div', { class: 'c-sub' }, L.card.sub(row))),
        h('div', { class: 'c-side' }, L.card.side ? L.card.side(row) : null))));
      markSelected();
    }
    if (per) { foot.replaceChildren(...[h('span', null, resp.total ? `${qty(resp.total)} ${plural(resp.total, 'запись', 'записи', 'записей')} по месяцам` : ''), L.footer ? L.footer(resp) : null].filter(Boolean)); return; }
    const from = resp.total ? (page - 1) * limit + 1 : 0;
    const to = Math.min(resp.total, page * limit);
    foot.replaceChildren(...[
      h('span', null, resp.total ? `${from}–${to} из ${qty(resp.total)}` : ''),
      L.footer ? L.footer(resp) : null,
      resp.total > 25 ? pager({ page, limit, total: resp.total, onPage: (p) => patch({ page: p > 1 ? p : undefined }), onLimit: (n) => patch({ limit: n === 25 ? undefined : n, page: undefined }) }) : null].filter(Boolean));
  }

  /* ---------- Галерея: карточки с фото по группам (ПС: паспорта по категориям) ---------- */
  function renderGallery() {
    const groups = new Map();
    for (const r of rows) { const g = L.gallery.groupBy ? L.gallery.groupBy(r) : ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
    const order = [...groups].sort((a, b) => (a[0] === L.gallery.lastGroup) - (b[0] === L.gallery.lastGroup)); // «Без категории» — в конце
    galleryBox.replaceChildren(...order.map(([g, items]) => h('section', { class: 'gal-group' },
      g ? h('h3', { class: 'gal-head' }, g, h('span', { class: 'gal-n' }, qty(items.length))) : null,
      h('div', { class: 'gal' }, ...items.map((row) => {
        const v = L.gallery.card(row);
        const card = h('button', { type: 'button', class: 'gcard' + (row.id === P.open ? ' selected' : ''), dataset: { id: row.id }, onclick: () => onOpen(row), title: v.title },
          v.pic ? h('img', { class: 'gc-pic', src: v.pic, alt: '', loading: 'lazy', onerror: (e) => e.target.replaceWith(h('div', { class: 'gc-pic gc-none' }, 'нет фото')) }) : h('div', { class: 'gc-pic gc-none' }, 'нет фото'),
          h('div', { class: 'gc-title' }, v.title), v.meta ? h('div', { class: 'gc-meta' }, v.meta) : null, v.badge || null);
        return bulkOn ? h('div', { class: 'gcard-wrap' }, card, h('label', { class: 'gc-pick', title: 'Отметить' }, pickBox(row))) : card;
      })))));
  }

  /* ---------- Месяцы и годы (фаза М) ---------- */
  const openKey = 'dc-open-' + section.id;
  const opened = new Set((() => { try { return JSON.parse(localStorage.getItem(openKey) || '[]'); } catch { return []; } })());
  const toggle = (k) => { opened.has(k) ? opened.delete(k) : opened.add(k); try { localStorage.setItem(openKey, JSON.stringify([...opened].slice(-60))); } catch { /* */ } renderPeriods(L.periods(P)); };
  function renderPeriods(per) {
    const now = new Date();
    const curYM = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const all = !!P.q; // при поиске всё раскрыто
    const months = new Map();
    for (const r of rows) {
      const d = per.date(r) ? new Date(per.date(r)) : null;
      const ym = d && !Number.isNaN(d.getTime()) ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') : 'none';
      if (!months.has(ym)) months.set(ym, []);
      months.get(ym).push(r);
    }
    const keys = [...months.keys()].sort().reverse();
    const cols = L.columns.length + (L.rowAction && canEditSection(section) ? 1 : 0);
    const trs = []; const lis = [];
    const head = (k, label, n, items, level, isOpen) => {
      const tot = per.total ? per.total(items) : null;
      trs.push(h('tr', { class: 'period-row lvl' + level + (isOpen ? ' open' : ''), onclick: () => toggle(k) },
        h('td', { colspan: cols }, h('span', { class: 'p-caret', 'aria-hidden': 'true' }, isOpen ? '▾' : '▸'), h('b', null, label), h('span', { class: 'p-n' }, qty(n)), tot ? h('span', { class: 'p-tot' }, tot) : null)));
      lis.push(h('li', { class: 'period-li lvl' + level, onclick: () => toggle(k) }, h('span', null, (isOpen ? '▾ ' : '▸ ') + label), h('span', { class: 'p-n' }, qty(n)), tot ? h('span', { class: 'p-tot' }, tot) : null));
    };
    const rowsOf = (items) => items.forEach((row) => {
      const i = rows.indexOf(row);
      const tr = h('tr', { onclick: () => onOpen(row), dataset: { i: String(i) } }, L.columns.map((c) => h('td', { class: c.cls || '' }, c.render ? c.render(row) : row[c.key] ?? '')));
      if (L.rowAction && canEditSection(section)) tr.append(h('td', { class: 'act' }, actionButton(row)));
      trs.push(tr);
      lis.push(h('li', { onclick: () => onOpen(row) }, L.card.thumb ? L.card.thumb(row) : null,
        h('div', { class: 'c-main' }, h('div', { class: 'c-title' }, L.card.title(row)), h('div', { class: 'c-sub' }, L.card.sub(row))),
        h('div', { class: 'c-side' }, L.card.side ? L.card.side(row) : null)));
    });
    const monthName = (ym) => { if (ym === 'none') return 'Без даты'; const [y, m] = ym.split('-').map(Number); return MONTHS[m - 1] + ' ' + y; };
    const year = String(now.getFullYear());
    // этот год — месяцами; прошлые годы — строкой года, внутри месяцы
    const byYear = new Map();
    for (const k of keys) { const y = k === 'none' ? 'none' : k.slice(0, 4); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(k); }
    for (const [y, ks] of byYear) {
      const nested = y !== year && y !== 'none' && byYear.size > 1;
      let show = true;
      if (nested) {
        const items = ks.flatMap((k) => months.get(k));
        const yk = 'y' + y; const isOpen = all || opened.has(yk);
        head(yk, y + ' год', items.length, items, 0, isOpen);
        show = isOpen;
      }
      if (!show) continue;
      for (const k of ks) {
        const items = months.get(k);
        const isOpen = all || k === curYM || opened.has(k) || (keys.length === 1);
        head(k, monthName(k), items.length, items, nested ? 1 : 0, isOpen);
        if (isOpen) rowsOf(items);
      }
    }
    tbody.replaceChildren(...trs);
    cards.replaceChildren(...lis);
    markSelected();
  }

  /** Кнопка следующего шага в строке: делает дело на месте, список обновляется без моргания. */
  function actionButton(row) {
    const acts = [].concat(L.rowAction(row) || []).filter(Boolean);
    return acts.length ? h('span', { class: 'row-acts' }, acts.map((a) => oneButton(row, a))) : null;
  }
  function oneButton(row, a) {
    return h('button', { class: 'btn btn-sm row-act', type: 'button', title: a.title, onclick: async (e) => {
      e.stopPropagation();
      const b = e.currentTarget; b.disabled = true;
      try { if (await a.run(row) !== false) { await load(); onChanged?.(); } } catch (ex) { toastError(ex); } finally { b.disabled = false; }
    } }, a.label);
  }

  // ---------- Клавиатура: ↑/↓ — соседняя запись, N — новая ----------
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.querySelector('.modal-back')) return;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && rows.length && !st().board) {
      e.preventDefault();
      const i = rows.findIndex((r) => r.id === P.open);
      const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
      onOpen(rows[next]);
    } else if ((e.key === 'n' || e.key === 'т') && canCreate) { e.preventDefault(); onCreate(); }
  }
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
    load();
  }

  return {
    el,
    update,
    reload: () => (st().board && board ? board.reload() : load()),
    focusSearch: () => sb.focus(),
    destroy: () => document.removeEventListener('keydown', onKey),
  };
}
