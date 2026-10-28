import { api, apiFile, session, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, money, qty, plural } from '../core/format.js';
import { stepFunnel } from '../ui/step-funnel.js';
import { catArt } from '../ui/cat-art.js';
import { current, patch } from '../core/router.js';
import { attachCombo } from '../ui/combo.js';
import { modal } from '../ui/dialog.js';
import { enhanceSelect } from '../ui/select.js';
import { openPopMenu } from '../ui/pop-menu.js';
import { icon } from '../ui/icons.js';
import { toast, toastError } from '../ui/toast.js';
import { setCrumbTail } from '../ui/crumbs.js';

/**
 * Каталог поставщиков (SUPPLIER-CATALOG.md §8): один список как везде (ui/list.js).
 * Слева: воронка категория → подкатегория → поставщик (только поставщики выбранной ветки) и быстрые отборы «Без связи / Без цены / Цена устарела» (toolbarExtra) — из GET /supply/catalog/counts.
 * Справа: таблица GET /supply/catalog/items. Сверху: крошки и шестерёнка (шаблон, импорт, выгрузка).
 * Правка, добавление, импорт — только admin / manager; остальные — просмотр и выгрузка.
 */

const canWrite = () => session.canEdit;
const FLAGS = [['unmatched', 'Без связи с нашим материалом'], ['noPrice', 'Без цены'], ['stale', 'Цена устарела']];
const SRC = { excel: 'Excel', request: 'Заявка', stock: 'Склад', manual: 'Вручную' };

// ---------- данные ----------
let countsP = null;
let countsAt = 0;
/** Счётчики левой панели: кэш на 20 с, bust() — после правки и импорта. */
function getCounts() {
  if (!countsP || Date.now() - countsAt > 20000) { countsAt = Date.now(); countsP = api('/supply/catalog/counts').catch((e) => { countsP = null; throw e; }); }
  return countsP;
}
const bust = () => { countsP = null; };

let suppliersCache = null;
/** Поставщики для выбора: /partners?type=supplier (не kind). */
async function loadSuppliers() {
  if (suppliersCache) return suppliersCache;
  const res = await api('/partners', { query: { limit: 500, type: 'supplier' } }).catch(() => ({ items: [] }));
  suppliersCache = (res.items || []).map((p) => ({ value: p.id, label: String(p.shortName || p.name) }));
  return suppliersCache;
}

const rowCache = new Map(); // строки списка — карточка открывается без отдельного запроса (GET по id на сервере нет)

/** Параметры адреса → запрос к серверу (список и выгрузка). */
function queryOf(P) {
  const q = {};
  if (P.q) q.search = P.q;
  if (P.supplierId) q.supplierId = P.supplierId;
  if (P.subId || P.catId) q.categoryId = P.subId || P.catId; // 'none' — без категории
  if (P.ord && P.ord.startsWith('-')) q.dir = 'desc';
  if (FLAGS.some(([k]) => k === P.flag)) q[P.flag] = '1';
  return q;
}

// ---------- левая панель: категории и быстрые отборы ----------
const ORDERS = [['', 'По названию'], ['price', 'Цена: сначала дешёвые'], ['-price', 'Цена: сначала дорогие'], ['-priceDate', 'Дата цены: сначала свежие'], ['priceDate', 'Дата цены: сначала старые']];
const STALE_MS = 183 * 86400000;
const isStale = (r) => r.priceHint != null && (!r.priceDate || Date.now() - new Date(r.priceDate).getTime() > STALE_MS);
const catTops = (c) => { const all = c.categories || []; const ids = new Set(all.map((x) => String(x.id))); return all.filter((x) => !x.parentId || !ids.has(String(x.parentId))); };
const totalOf = (c) => (c.suppliers || []).reduce((a, s) => a + (s.count || 0), 0);

/** Слева: воронка Категория → Подкатегория (поставщики — плитки списка), быстрые отборы, порядок, «Сбросить», «Показано N из M». */
function sideFilters() {
  const el = h('div', { class: 'ls-extra' });
  const funnel = stepFunnel({
    title: 'Категория',
    steps: [{ key: 'catId', label: 'Категория' }, { key: 'subId', label: 'Подкатегория', when: (P) => !!P.catId && P.catId !== 'none' }, { key: 'supplierId', label: 'Поставщик' }],
    load: async (P) => {
      const c = await getCounts();
      const tops = catTops(c).map((x) => ({ value: x.id, label: x.name, n: x.count }));
      if (c.noCategory) tops.push({ value: 'none', label: 'Без категории', n: c.noCategory });
      const subs = P.catId ? (c.categories || []).filter((x) => String(x.parentId) === P.catId).map((x) => ({ value: x.id, label: x.name, n: x.count })) : [];
      // поставщики — только те, у кого есть позиции в выбранной ветке категорий (не весь список пачкой)
      const pick = P.subId || P.catId;
      let branch = null;
      if (pick === 'none') branch = new Set(['none']);
      else if (pick) {
        branch = new Set([pick]);
        for (let grew = true; grew;) { grew = false; for (const x of c.categories || []) if (branch.has(String(x.parentId)) && !branch.has(x.id)) { branch.add(x.id); grew = true; } }
      }
      const sups = (c.suppliers || []).filter((s) => !branch || (s.cats || []).some((k) => branch.has(k))).map((s) => ({ value: s.id, label: s.name, n: s.count }));
      return { catId: tops, subId: subs, supplierId: sups };
    },
  });
  const rest = h('div');
  let P = {};
  let seq = 0;
  const opt = (label, n, on, run) => h('button', { type: 'button', class: 'ls-opt' + (on ? ' active' : ''), onclick: run },
    h('span', { class: 'ls-t' }, label), n !== undefined ? h('b', null, qty(n)) : null);
  async function paint() {
    const my = ++seq;
    let c;
    try { c = await getCounts(); } catch { return; }
    const flagN = { unmatched: c.unmatched, noPrice: c.noPrice, stale: c.stale };
    const shown = h('p', { class: 'sc-shown muted small' });
    api('/supply/catalog/items', { query: { ...queryOf(P), limit: 1 } }).then((r) => {
      if (my === seq) shown.textContent = `Показано ${qty(r.total)} из ${qty(totalOf(c))}`;
    }).catch(() => {});
    rest.replaceChildren(
      shown,
      h('div', { class: 'ls-group' }, h('div', { class: 'ls-h' }, 'Быстро'),
        h('div', { class: 'ls-list' }, FLAGS.map(([k, label]) => opt(label, flagN[k], P.flag === k, () => patch({ flag: P.flag === k ? undefined : k, page: undefined }))))),
      h('div', { class: 'ls-group' }, h('div', { class: 'ls-h' }, 'Порядок'),
        h('div', { class: 'ls-list' }, ORDERS.map(([k, label]) => opt(label, undefined, (P.ord || '') === k, () => patch({ ord: k || undefined, page: undefined }))))),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => patch({ supplierId: undefined, catId: undefined, subId: undefined, flag: undefined, ord: undefined, q: undefined, all: undefined, page: undefined }) }, 'Сбросить'));
  }
  el.append(funnel.el, rest);
  return { el, update(next) { P = next; funnel.update(next); paint(); } };
}

// ---------- первая страница: плитки главных категорий ----------
const nPos = (n) => `${qty(n)} ${plural(n, 'позиция', 'позиции', 'позиций')}`;
async function catLanding() {
  const c = await getCounts();
  const go = (p) => patch({ ...p, view: 'table', page: undefined });
  const tile = (name, n, pick) => {
    const art = h('div', { class: 'cat-art' });
    art.innerHTML = catArt(name); // свой статичный SVG, данных пользователя нет
    return h('button', { type: 'button', class: 'cat-tile', title: name, onclick: pick }, art, h('div', { class: 'cat-body' }, h('div', { class: 'cat-name' }, name), h('div', { class: 'cat-n' }, nPos(n || 0))));
  };
  const tops = catTops(c);
  if (!tops.length && !c.noCategory) return h('div', { class: 'state' }, h('div', null, 'Категорий пока нет — позиции покажутся списком.'), h('button', { class: 'btn', type: 'button', onclick: () => go({ all: '1' }) }, 'Все списком'));
  return h('div', { class: 'cat-landing' },
    h('div', { class: 'cat-top' }, h('p', { class: 'muted' }, `Выберите категорию · всего ${nPos(totalOf(c))}`), h('button', { class: 'btn', type: 'button', onclick: () => go({ all: '1' }) }, 'Все списком')),
    h('div', { class: 'cat-grid' },
      ...tops.map((x) => tile(x.name, x.count, () => go({ catId: x.id }))),
      c.noCategory ? tile('Без категории', c.noCategory, () => go({ catId: 'none' })) : null));
}

// ---------- шапка: крошки и шестерёнка ----------
function topBlock(reload) {
  const gear = h('button', { class: 'btn btn-ghost', type: 'button', title: 'Шаблон, загрузка и выгрузка Excel', 'aria-label': 'Действия с Excel', 'aria-haspopup': 'menu',
    onclick: () => openPopMenu({ anchor: gear, side: 'down', groups: [
      { items: [
        { label: 'Скачать шаблон Excel', onSelect: () => download('/supply/catalog/template', {}, 'Шаблон_каталога.xlsx') },
        canWrite() ? { label: 'Загрузить Excel…', onSelect: () => importDialog(reload) } : null,
        { label: 'Выгрузить в Excel', onSelect: () => download('/supply/catalog/export', queryOf(current().params), 'Каталог_поставщиков.xlsx') },
      ] }] }) }, icon('settings'));
  // выход к плиткам категорий и сброс — всегда на виду сверху (жалоба 2026-10-29: «зашёл в категорию — назад не выйти»)
  const ALL = { supplierId: undefined, catId: undefined, subId: undefined, flag: undefined, ord: undefined, q: undefined, all: undefined, page: undefined };
  const back = h('button', { class: 'btn', type: 'button', onclick: () => patch(ALL) }, '← Все категории');
  const el = h('div', { class: 'sc-top' }, back, h('span', { class: 'spacer' }), gear);
  el.onParams = async (P) => {
    back.hidden = !(P.supplierId || P.catId || P.subId || P.q || P.flag || P.all || P.ord);
    setCrumbTail(null);
    if (!P.supplierId) return;
    const c = await getCounts().catch(() => null);
    const s = c?.suppliers?.find((x) => x.id === P.supplierId);
    if (s && P.supplierId === current().params.supplierId) setCrumbTail(s.name);
  };
  return el;
}

async function download(path, query, fallback) {
  try { toast(`Скачан: ${await apiFile(path, { query, fallback })}`); } catch (e) { toastError(e, 'скачать файл'); }
}

// ---------- импорт: окно с предпросмотром ----------
const ST = { new: ['Новая', 'ok'], price: ['Цена изменилась', 'warn'], update: ['Изменится', 'info'], same: ['Без изменений', ''], error: ['Ошибка', 'warn'] };

function previewTable(res) {
  const c = res.counts || {};
  const rows = res.rows || [];
  const head = h('p', { class: 'hint' + (c.error ? '' : ' ok') },
    `Строк: ${qty(c.total)} · новых: ${qty(c.new)} · цена изменилась: ${qty(c.price)} · изменится: ${qty(c.update)} · без изменений: ${qty(c.same)} · ошибок: ${qty(c.error)}`);
  const dup = res.duplicate ? h('p', { class: 'form-error' }, 'Этот файл уже загружали. Если загрузить ещё раз, изменений почти не будет.') : null;
  const note = c.error ? h('p', { class: 'hint' }, 'Строки с ошибками будут пропущены, остальные загрузятся.') : null;
  const trs = rows.slice(0, 300).map((r) => {
    const [label, tone] = ST[r.status] || [r.status, ''];
    return h('tr', null,
      h('td', { class: 'muted nowrap' }, String(r.rowNum)),
      h('td', null, h('span', { class: 'badge ' + tone }, label), r.errors?.length ? h('div', { class: 'form-error small' }, r.errors.join('; ')) : null),
      h('td', { class: 'muted nowrap' }, r.supplierName || '—'),
      h('td', { class: 'nowrap' }, r.article || '—'),
      h('td', null, r.name || '—', r.materialName ? h('div', { class: 'muted small' }, '→ ' + r.materialName) : null),
      h('td', { class: 'num nowrap' }, r.price != null ? (r.oldPrice != null && r.oldPrice !== r.price ? `${money(r.oldPrice)} → ` : '') + money(r.price) : '—'));
  });
  const table = h('div', { class: 'table-wrap', style: { maxHeight: '320px', overflow: 'auto' } },
    h('table', { class: 'data-table' },
      h('thead', null, h('tr', null, ['Строка', 'Что будет', 'Поставщик', 'Артикул', 'Название', 'Цена, ₽'].map((t) => h('th', null, t)))),
      h('tbody', null, ...trs)));
  return [head, dup, note, table, rows.length > 300 ? h('p', { class: 'muted small' }, `Показаны первые 300 из ${rows.length}`) : null];
}

async function importDialog(reload) {
  const sup = h('select', { 'aria-label': 'Поставщик' }, h('option', { value: '' }, 'Не выбран — поставщик указан в файле'));
  loadSuppliers().then((list) => { list.forEach((o) => sup.append(h('option', { value: o.value }, o.label))); const cur = current().params.supplierId; if (cur) sup.value = cur; enhanceSelect(sup); });
  const file = h('input', { type: 'file', accept: '.xlsx' });
  const out = h('div', { class: 'sc-preview' });
  let ready = false;
  const form = () => { const fd = new FormData(); fd.append('file', file.files[0]); if (sup.value) fd.append('supplierId', sup.value); return fd; };
  async function preview() {
    ready = false;
    if (!file.files?.[0]) { out.replaceChildren(); return; }
    out.replaceChildren(h('p', { class: 'hint' }, 'Проверяю файл…'));
    try {
      const res = await api('/supply/catalog/import?preview=1', { method: 'POST', body: form() });
      out.replaceChildren(...previewTable(res).filter(Boolean));
      ready = (res.counts?.total || 0) > (res.counts?.error || 0);
    } catch (e) { out.replaceChildren(h('p', { class: 'form-error' }, e.message || 'Не удалось прочитать файл')); }
  }
  file.addEventListener('change', preview);
  sup.addEventListener('change', preview);
  const body = h('div', null,
    h('p', { class: 'hint' }, 'Скачайте шаблон в меню ⚙, заполните и загрузите. Поставщика можно не выбирать, если в файле есть колонка «ИНН поставщика».'),
    h('label', { class: 'field' }, h('span', null, 'Поставщик (необязательно)'), sup),
    h('label', { class: 'field' }, h('span', null, 'Файл Excel (.xlsx)'), file),
    out);
  await modal({
    title: 'Загрузить прайс из Excel', okText: 'Загрузить', wide: true, body,
    onOk: async () => {
      if (!file.files?.[0]) throw new Error('Выберите файл');
      if (!ready) throw new Error('Нет строк для загрузки — проверьте файл');
      const res = await api('/supply/catalog/import', { method: 'POST', body: form() });
      bust();
      toast(`Загружено: новых ${res.created ?? 0}, обновлено ${res.updated ?? 0}, без изменений ${res.same ?? 0}${res.errors ? `, пропущено ${res.errors}` : ''}`);
      reload?.();
      window.dispatchEvent(new CustomEvent('data-changed'));
    },
  });
}

// ---------- карточка ----------
/** Поле «Наш материал»: поиск по складу, пусто = связи нет. value — JSON id. */
function materialWidget(v, row) {
  let id = v || null;
  const input = h('input', { type: 'text', placeholder: 'Найти на складе: название или артикул', value: row?.materialName || '' });
  const wrap = h('div', { class: 'combo-wrap' }, input);
  let opts = [];
  let last = null;
  let timer;
  attachCombo(input, { options: () => opts, free: false, empty: () => 'Введите название — найду на складе',
    onPick: (o) => { id = o.value; } });
  input.addEventListener('input', () => {
    if (!input.value.trim()) { id = null; }
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const s = input.value.trim();
      if (s === last || s.length < 2) return;
      last = s;
      const res = await api('/stock/items', { query: { search: s, limit: 30 } }).catch(() => ({ items: [] }));
      opts = (res.items || []).map((m) => ({ value: m.id, label: m.name, sub: [m.supplierArticle, m.categoryName].filter(Boolean).join(' · ') }));
      input.dispatchEvent(new Event('focus'));
    }, 250);
  });
  return { el: wrap, get value() { return id ? JSON.stringify(id) : ''; }, set value(_) { /* только ввод */ } };
}

const thumb = (r) => (r.thumb ? h('img', { class: 'thumb', src: PREFIX + r.thumb, alt: '', loading: 'lazy', decoding: 'async' }) : null);
const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x));

export const supplierCatalog = {
  id: 'suppliercatalog',
  title: 'Каталог поставщиков',
  newTitle: 'Новая позиция каталога',
  canEdit: canWrite,
  get: async (id) => {
    if (rowCache.has(id)) return rowCache.get(id);
    const r = await api(`/supply/catalog/items/${id}`);
    rowCache.set(r.id, r);
    return r;
  },

  list: {
    path: '/supply/catalog/items',
    sidebar: true,
    export: false, // выгрузка — в шестерёнке (формат шаблона, можно править и загружать обратно)
    extraKeys: ['catId', 'subId', 'flag', 'ord', 'all'],
    toolbarExtra: sideFilters,
    top: topBlock,
    query: queryOf,
    // порядок — из адреса (?ord=price|-price|priceDate|…): список шлёт sort, направление (dir) добавляет queryOf
    get sortDefault() { return (current().params.ord || '').replace(/^-/, ''); },
    gallery: { default: true, limit: 100, card: (r) => ({ pic: r.thumb ? PREFIX + r.thumb : null, title: r.name, meta: [r.supplierName, r.article && !r.article.startsWith('manual:') ? 'арт. ' + r.article : ''].filter(Boolean).join(' · '), price: r.priceHint != null ? money(r.priceHint) : null }) },
    landing: { when: (P) => !P.supplierId && !P.catId && !P.subId && !P.q && !P.flag && !P.all, render: catLanding },
    createLabel: 'Новая позиция',
    searchPlaceholder: 'Артикул, название, примечание…',
    emptyText: 'В каталоге пока пусто. Загрузите прайс поставщика по шаблону: шестерёнка → «Скачать шаблон Excel», затем «Загрузить Excel…».',
    columns: [
      { key: 'photo', label: '', render: (r) => thumb(r) },
      { key: 'supplierName', label: 'Поставщик', cls: 'clip', render: (r) => { rowCache.set(r.id, r); return r.supplierName || h('span', { class: 'muted' }, '—'); } },
      { key: 'article', label: 'Артикул поставщика', cls: 'nowrap', render: (r) => r.article && !r.article.startsWith('manual:') ? r.article : h('span', { class: 'muted' }, '—') },
      { key: 'name', label: 'Название у поставщика', cls: 'clip', render: (r) => h('span', { title: r.name }, r.name, r.color ? h('span', { class: 'muted' }, ' · ' + r.color) : null) },
      { key: 'material', label: 'Наш материал', cls: 'clip md-hide', render: (r) => r.materialId ? h('span', { title: r.materialArticle }, r.materialName) : h('span', { class: 'badge warn', title: 'Не связана с позицией склада' }, 'нет связи') },
      { key: 'unit', label: 'Ед.', cls: 'md-hide', render: (r) => r.unit || '' },
      { key: 'priceHint', label: 'Цена, ₽', cls: 'num right', render: (r) => r.priceHint != null ? money(r.priceHint) : h('span', { class: 'muted' }, '—') },
      { key: 'priceDate', label: 'Дата цены', cls: 'nowrap md-hide muted', render: (r) => (isStale(r) ? h('span', { class: 'sc-stale', title: 'Цене больше 6 месяцев' }, r.priceDate ? 'от ' + date(r.priceDate) + ' — устарела' : 'устарела') : r.priceDate ? date(r.priceDate) : '') },
      { key: 'stockQty', label: 'Остаток', cls: 'num right md-hide', render: (r) => r.stockQty != null ? qty(r.stockQty) : '' },
    ],
    card: {
      thumb,
      title: (r) => r.name,
      sub: (r) => [r.supplierName, r.article && !r.article.startsWith('manual:') ? 'арт. ' + r.article : '', r.materialName].filter(Boolean).join(' · '),
      side: (r) => [h('b', { class: 'num' }, r.priceHint != null ? money(r.priceHint) + ' ₽' : '—')],
    },
  },

  card: {
    gallery: (r) => r.photos || [],
    photoAdd: async (r, photoId) => { const x = await api(`/supply/catalog/items/${r.id}/photos`, { method: 'POST', body: { photoId } }); rowCache.set(x.id, x); return x; },
    photoRemove: async (r, photoId) => { const x = await api(`/supply/catalog/items/${r.id}/photos/${photoId}`, { method: 'DELETE' }); rowCache.set(x.id, x); return x; },
    heading: (r) => r.name,
    subheading: (r) => r.supplierName || '',
    editTop: true,
    top: (r, ctx) => {
      const art = r.article && !r.article.startsWith('manual:') ? r.article : '';
      const cell = (l, v) => (v === undefined || v === null || v === '' ? null : h('div', { class: 'sc-f' }, h('span', null, l), h('b', null, v)));
      const mat = r.materialId
        ? h('span', null, r.materialName, r.materialArticle ? h('span', { class: 'muted' }, ' · ' + r.materialArticle) : null)
        : h('span', { class: 'sc-nolink' }, h('span', { class: 'muted' }, 'нет связи'), canWrite() ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => ctx.edit() }, 'Связать') : null);
      return h('div', { class: 'sc-card' },
        h('div', { class: 'sc-price' },
          h('div', { class: 'sc-price-v num' }, r.priceHint != null ? `${money(r.priceHint)}${r.unit ? ' / ' + r.unit : ''}` : 'Цена не задана'),
          r.priceHint != null && r.priceDate ? h('div', { class: isStale(r) ? 'sc-stale small' : 'muted small' }, 'от ' + date(r.priceDate) + (isStale(r) ? ' — устарела' : '')) : null),
        h('div', { class: 'sc-grid' },
          cell('Артикул у поставщика', art),
          cell('Цвет', r.color), cell('Группа', r.optGroup),
          cell('Остаток', r.stockQty != null ? qty(r.stockQty) : ''),
          cell('Откуда', SRC[r.source] || ''),
          cell('Наш материал', mat),
          cell('Примечание', r.note)));
    },
    view: () => [],
    extra: (r) => {
      const hist = [...(r.priceHistory || [])].reverse();
      if (!hist.length) return h('p', { class: 'muted' }, 'Истории цен пока нет.');
      return h('div', null, h('div', { class: 'section-title' }, 'История цен'),
        h('table', { class: 'data-table sc-hist' }, h('thead', null, h('tr', null, h('th', null, 'Дата'), h('th', { class: 'num' }, 'Цена, ₽'), h('th', null, 'Откуда'))),
          h('tbody', null, hist.map((x) => h('tr', null, h('td', null, x.date ? date(x.date) : '—'), h('td', { class: 'num' }, money(x.price)), h('td', { class: 'muted' }, SRC[x.source] || x.source || ''))))));
    },
  },

  form: {
    closeAfterCreate: true,
    fields: async (r) => {
      const sups = r ? [] : await loadSuppliers();
      return [
        { section: 'Позиция', tone: 'main', fixed: true },
        ...(r ? [] : [{ key: 'supplierId', label: 'Поставщик', type: 'select', required: true, wide: true, options: [{ value: '', label: 'Выберите поставщика' }, ...sups] }]),
        ...(r ? [] : [{ key: 'article', label: 'Артикул поставщика', max: 100, hint: 'Пусто — позиция узнаётся по нашему материалу' }]),
        { key: 'name', label: 'Название у поставщика', required: true, wide: true, max: 300 },
        { key: 'color', label: 'Цвет', max: 100 },
        { key: 'unit', label: 'Ед. изм.', max: 40 },
        { key: 'price', label: 'Цена, ₽', type: 'number', min: 0, hint: 'Изменение цены запишется в историю' },
        ...(r ? [{ key: 'optGroup', label: 'Группа', max: 100 }] : []),
        { section: 'Связь с нашим складом', tone: 'info', fixed: true },
        { key: 'material', label: 'Наш материал', type: 'widget', wide: true, widget: (v) => materialWidget(v, r) },
        { key: 'note', label: 'Примечание', type: 'textarea', wide: true, max: 500 },
      ];
    },
    toInitial: (r) => ({ ...r, price: r.priceHint, material: r.materialId || '' }),
    toBody: (v, row) => {
      const body = { name: v.name, color: v.color || '', unit: v.unit || '', note: v.note || '' };
      const price = num(v.price);
      if (row) {
        body.optGroup = v.optGroup || '';
        if (price !== null) body.price = price;
        body.materialId = v.material || null;
      } else {
        body.supplierId = v.supplierId;
        if (v.article) body.article = v.article;
        if (price !== null) body.price = price;
        if (v.material) body.materialId = v.material;
      }
      return body;
    },
    create: async (body) => {
      const res = await api('/supply/catalog/items', { method: 'POST', body });
      if (res.errors?.length) throw new Error(res.errors.join('; '));
      bust();
      return { id: '' };
    },
    update: async (id, body) => {
      const saved = await api(`/supply/catalog/items/${id}`, { method: 'PATCH', body });
      rowCache.set(saved.id, saved);
      bust();
      return saved;
    },
  },
};
