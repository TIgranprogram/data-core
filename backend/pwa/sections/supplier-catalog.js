import { api, apiFile, session, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, money, qty, plural } from '../core/format.js';
import { stepFunnel, attachCombo, enhanceSelect, button, iconButton } from '../ui/kit/index.js';
import { catArt } from '../ui/cat-art.js';
import { current, patch, go } from '../core/router.js';
import { openSide, noteField, sideForm } from '../ui/kit/side-form.js';
import { downloadXlsx } from '../core/xlsx-write.js';
import { openPopMenu } from '../ui/kit/pop-menu.js';
import { icon } from '../ui/icons.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { setCrumbTail } from '../ui/kit/crumbs.js';
import { partnerAction } from './lookups.js';
import { previewTable, orderPreview, orderTemplate } from './supplier-catalog-import.js';
import { openOrderBulk } from './order-bulk.js';

import { table, section, stack, card, badge, empty, hint, landing, tileGrid, navList, posPic, readonlyGroup, toolbar } from '../ui/kit/index.js';
/**
 * Каталог поставщиков (SUPPLIER-CATALOG.md §8): один список как везде (ui/list.js).
 * Слева: воронка категория → подкатегория → поставщик (только поставщики выбранной ветки) и быстрые отборы «Без связи / Без цены / Цена устарела» (toolbarExtra) — из GET /supply/catalog/counts.
 * Справа: таблица GET /supply/catalog/items. Сверху: крошки и шестерёнка (шаблон, импорт, выгрузка).
 * Правка, добавление, импорт — только admin / manager; остальные — просмотр и выгрузка.
 */

const canWrite = () => session.canEdit;
const FLAGS = [['unmatched', 'Без связи — связать с позицией'], ['noPrice', 'Без цены'], ['stale', 'Цена устарела']];
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
  const q = { view: 'all' }; // вся номенклатура: и предложения, и материалы без поставщика
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
const staleBadge = (priceDate) => { const b = badge(priceDate ? 'от ' + date(priceDate) + ' — устарела' : 'устарела', 'warn'); b.title = 'Цене больше 6 месяцев'; return b; }; // «Цена устарела» — badge warn
const catTops = (c) => { const all = c.categories || []; const ids = new Set(all.map((x) => String(x.id))); return all.filter((x) => !x.parentId || !ids.has(String(x.parentId))); };
const totalOf = (c) => (c.suppliers || []).reduce((a, s) => a + (s.count || 0), 0) + (c.noSupplier || 0);
const isMaterial = (r) => r.kind === 'material'; // материал без предложений поставщика
const exportQuery = (P) => { const { view, ...q } = queryOf(P); return q; }; // выгрузка — по предложениям

/** Слева: воронка Категория → Подкатегория (поставщики — плитки списка), быстрые отборы, порядок, «Сбросить», «Показано N из M». */
function sideFilters() {
  const el = h('div');
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
      if (c.noSupplier > 0) sups.push({ value: 'none', label: 'Без поставщика', n: c.noSupplier });
      return { catId: tops, subId: subs, supplierId: sups };
    },
  });
  const quickBox = h('div');
  const orderBox = h('div');
  const rest = h('div');
  let P = {};
  let seq = 0;
  const ordKey = (o) => (ORDERS.find(([k]) => k === (o || '')) || [''])[0] || 'name';
  async function paint() {
    const my = ++seq;
    let c;
    try { c = await getCounts(); } catch { return; }
    const flagN = { unmatched: c.unmatched, noPrice: c.noPrice, stale: c.stale };
    quickBox.replaceChildren(navList({ label: 'Быстрые отборы', value: P.flag || null, // отборы/порядок — navList, пересборка для свежих счётчиков
      groups: [{ title: 'Быстро', items: FLAGS.map(([k, label]) => ({ key: k, label, count: flagN[k] })) }],
      onPick: (k) => patch({ flag: P.flag === k ? undefined : k, page: undefined }) }).el);
    orderBox.replaceChildren(navList({ label: 'Порядок', value: ordKey(P.ord),
      groups: [{ title: 'Порядок', items: ORDERS.map(([k, label]) => ({ key: k || 'name', label })) }],
      onPick: (k) => patch({ ord: k === 'name' ? undefined : k, page: undefined }) }).el);
    const shown = h('p', { class: 'muted small' });
    api('/supply/catalog/items', { query: { ...queryOf(P), limit: 1 } }).then((r) => {
      if (my === seq) shown.textContent = `Показано ${qty(r.total)} из ${qty(totalOf(c))}`;
    }).catch(() => {});
    rest.replaceChildren(
      shown,
      button({ label: 'Сбросить', kind: 'ghost', onClick: () => patch({ supplierId: undefined, catId: undefined, subId: undefined, flag: undefined, ord: undefined, q: undefined, all: undefined, page: undefined }) }));
  }
  el.append(funnel.el, quickBox, orderBox, rest);
  return { el, update(next) { P = next; funnel.update(next); paint(); } };
}

// ---------- первая страница: плитки главных категорий ----------
const nPos = (n) => `${qty(n)} ${plural(n, 'позиция', 'позиции', 'позиций')}`;
async function catLanding() {
  const c = await getCounts();
  const go = (p) => patch({ ...p, view: 'table', page: undefined });
  const tile = (name, n, pick) => {
    const art = h('span');
    art.innerHTML = catArt(name); // свой статичный SVG, данных пользователя нет
    return card({ size: 'S', art, title: name, meta: nPos(n || 0), onClick: pick });
  };
  const tops = catTops(c);
  if (!tops.length && !c.noCategory) { const box = empty({ title: 'Категорий пока нет — позиции покажутся списком.' }); box.append(button({ label: 'Все списком', onClick: () => go({ all: '1' }) })); return box; }
  const queue = c.unmatched > 0 && canWrite()
    ? landing({ head: `Без связи со складом: ${nPos(c.unmatched)} — выберите позицию или создайте новую, не плодя дубли имени.`,
        action: button({ label: 'Очередь «Связать с позицией»', kind: 'primary', onClick: () => go({ flag: 'unmatched', all: '1' }) }) })
    : null;
  return landing({ head: `Выберите категорию · всего ${nPos(totalOf(c))}`, action: button({ label: 'Все списком', onClick: () => go({ all: '1' }) }),
    body: [queue, tileGrid(
      ...tops.map((x) => tile(x.name, x.count, () => go({ catId: x.id }))),
      c.noCategory ? tile('Без категории', c.noCategory, () => go({ catId: 'none' })) : null)] });
}

// ---------- шапка: крошки и шестерёнка ----------
function topBlock(reload) {
  const gear = iconButton({ icon: icon('settings'), label: 'Действия с Excel', title: 'Шаблон, загрузка и выгрузка Excel', menu: true,
    onClick: () => openPopMenu({ anchor: gear, side: 'down', groups: [
      { items: [
        { label: '⇩ Шаблон Excel', onSelect: () => download('/supply/catalog/template', {}, 'Шаблон_каталога.xlsx') },
        canWrite() ? { label: 'Загрузить Excel…', onSelect: () => openSide('pricelist', current().params.supplierId || 'x') } : null,
        { label: 'Выгрузить в Excel', onSelect: () => download('/supply/catalog/export', exportQuery(current().params), 'Каталог_поставщиков.xlsx') },
      ] }] }) });
  // выход к плиткам категорий и сброс — всегда на виду сверху (жалоба 2026-10-29: «зашёл в категорию — назад не выйти»)
  const ALL = { supplierId: undefined, catId: undefined, subId: undefined, flag: undefined, ord: undefined, q: undefined, all: undefined, page: undefined };
  const back = button({ label: '← Все категории', onClick: () => patch(ALL) });
  const el = toolbar(back, h('span', { class: 'spacer' }), gear);
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

/**
 * Загрузка Excel — одна правая панель (П3 + Д3; раньше два окна: в каталоге и в контрагенте).
 * open = <id поставщика>|x — прайс-лист в каталог (preview → apply); order:<id> — «Заказ клиента» от поставщика: заявки + цены каталога.
 */
const fileKey = (k) => (String(k).startsWith('order:') ? { mode: 'order', supplierId: String(k).slice(6) } : { mode: 'price', supplierId: k === 'x' ? '' : String(k) });
let cur = null; // файл и предпросмотр открытой панели «Загрузить прайс»
export const priceList = sideForm({
  id: 'pricelist', title: 'Загрузить прайс из Excel', noun: 'файл',
  canEdit: canWrite,
  get: async (k) => { const o = fileKey(k); const name = o.mode === 'order' ? (await api(`/partners/${encodeURIComponent(o.supplierId)}`).catch(() => null))?.name || '' : ''; return { ...o, supplierName: name }; },
  heading: (r) => (r.mode === 'order' ? 'Загрузить прайс от «' + (r.supplierName || 'поставщика') + '»' : 'Загрузить прайс из Excel'),
  saveLabel: 'Загрузить',
  fields: async (r) => {
    const order = r.mode === 'order';
    const file = h('input', { type: 'file', accept: order ? '.xlsx,.xls' : '.xlsx', 'aria-label': 'Файл Excel' });
    const out = section({ fixed: true, title: 'Предпросмотр', body: [] });
    const outBody = out.querySelector('.k-sec-body');
    let ready = false; let fapi = null;
    const supplier = () => (order ? r.supplierId : fapi?.get('supplierId') || '');
    const fd = () => { const x = new FormData(); x.append('file', file.files[0]); if (!order && supplier()) x.append('supplierId', supplier()); return x; };
    async function preview() {
      ready = false;
      if (!file.files?.[0]) { outBody.replaceChildren(); return; }
      outBody.replaceChildren(hint('Проверяю файл…'));
      try {
        if (order) {
          const res = await api(`/supply/suppliers/${r.supplierId}/excel?preview=1`, { method: 'POST', body: fd() });
          ready = true; outBody.replaceChildren(...orderPreview(res.rows || []));
        } else {
          const res = await api('/supply/catalog/import?preview=1', { method: 'POST', body: fd() });
          outBody.replaceChildren(...previewTable(res).filter(Boolean));
          ready = (res.counts?.total || 0) > (res.counts?.error || 0);
        }
      } catch (e) { outBody.replaceChildren(hint(e.message || 'Не удалось прочитать файл', 'danger')); }
    }
    file.addEventListener('change', preview);
    cur = { file, ready: () => ready, fd, order };
    const note = order
      ? (() => { const p = hint('Загрузите файл «Заказ клиента» от поставщика: по каждой строке — заявка и цена в каталог поставщика. Кол-во пусто — 1; Ед. изм. пусто — шт; цена — за 1 единицу. '); p.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: orderTemplate }, '⇩ Шаблон Excel')); return p; })()
      : hint('Скачайте шаблон в меню ⚙ каталога, заполните и загрузите. Поставщика можно не выбирать, если в файле есть колонка «ИНН поставщика».');
    return [noteField(note),
      order ? null : { key: 'supplierId', label: 'Поставщик (необязательно)', type: 'select', wide: true, options: await loadSuppliers(), hint: 'Не выбран — поставщик указан в файле' },
      { key: 'file', label: 'Файл Excel (.xlsx)', type: 'widget', wide: true, widget: () => ({ el: h('div', null, file, out), get value() { return file.files?.[0]?.name || ''; }, set value(_) { /* только ввод */ } }),
        mount: (f) => { fapi = f; f.on('supplierId', preview); } }].filter(Boolean);
  },
  toInitial: (r) => ({ supplierId: r.supplierId || current().params.supplierId || '' }),
  toBody: () => {
    if (!cur?.file.files?.[0]) throw new Error('Выберите файл');
    if (!cur.ready()) throw new Error(cur.order ? 'Дождитесь загрузки предпросмотра' : 'Нет строк для загрузки — проверьте файл');
    return cur.fd();
  },
  save: async (body, r) => {
    if (r.mode === 'order') {
      const res = await api(`/supply/suppliers/${r.supplierId}/excel`, { method: 'POST', body });
      if (res.duplicate) toast('Этот файл уже был загружен ранее — дублей не создано');
      else toast(`Создано заявок: ${res.created ?? 0}, обновлено в каталоге: ${res.catalogUpdated ?? 0}`);
      bust(); return {};
    }
    const res = await api('/supply/catalog/import', { method: 'POST', body });
    bust();
    toast(`Загружено: новых ${res.created ?? 0}, обновлено ${res.updated ?? 0}, без изменений ${res.same ?? 0}${res.errors ? `, пропущено ${res.errors}` : ''}`);
    return {};
  },
});

// ---------- карточка ----------
/** Поле «Наш материал»: поиск только по складу (free:false). Новая позиция — явной кнопкой, без автодубля имени. */
function materialWidget(v, row) {
  let id = v || null;
  const input = h('input', { type: 'text', placeholder: 'Найти на складе: название или артикул', value: row?.materialName || '' });
  const wrap = h('div', null, input);
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
  const createBtn = row?.id && canWrite()
    ? button({ label: 'Создать позицию склада', kind: 'ghost', size: 'S', onClick: (e) => {
        e.preventDefault();
        const art = row.article && !String(row.article).startsWith('manual:') ? row.article : '';
        go('stock', { new: '1', name: row.name || '', article: art || undefined, fromCatalog: row.id, open: undefined });
      } })
    : null;
  const hintEl = hint('Сначала найдите на складе. Нет такой — только кнопка «Создать позицию склада» (иначе появится дубль имени).');
  return { el: h('div', null, wrap, createBtn, hintEl), get value() { return id ? JSON.stringify(id) : ''; }, set value(_) { /* только ввод */ } };
}

/** «В заявку» / «Заказать у поставщика» над отмеченными: предложения — с поставщиком, материалы — без; строки без позиции склада пропускаются. */
function orderRows(rows) {
  const sup = current().params.supplierId; const fixed = sup && sup !== 'none' ? sup : null;
  const ok = (rows || []).filter((r) => r.materialId);
  const skip = (rows || []).length - ok.length;
  if (skip) toast(`${skip} строк без позиции склада — сначала сопоставьте`, { error: !ok.length });
  openOrderBulk(ok.map((r) => ({ materialId: r.materialId, name: r.materialName || r.name, unit: r.unit, ...(isMaterial(r) ? (fixed ? { supplierId: fixed } : {}) : { supplierId: fixed || r.supplierId, supplierName: r.supplierName }) })));
}

const thumb = (r) => posPic(r.thumb ? { thumb: r.thumb, url: r.thumb } : null, 'sm');
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
    viewKey: 'catalog', path: '/supply/catalog/items',
    sidebar: true,
    bulk: { extra: [{ get label() { return current().params.supplierId && current().params.supplierId !== 'none' ? 'Заказать у поставщика' : 'В заявку'; }, run: (ids, rows) => orderRows(rows) }] },
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
    emptyText: 'В каталоге пока пусто.', emptyHint: 'Загрузите прайс поставщика по шаблону: шестерёнка → «⇩ Шаблон Excel», затем «Загрузить Excel…».',
    rowAction: (r) => (!r.materialId && canWrite()
      ? { label: 'Связать с позицией', title: 'Выбрать позицию склада или создать новую', run: () => { patch({ open: r.id, fill: 'material' }); return false; } }
      : null),
    columns: [
      { key: 'photo', label: '', render: (r) => thumb(r) },
      { key: 'supplierName', label: 'Поставщик', cls: 'clip', render: (r) => { rowCache.set(r.id, r); return isMaterial(r) ? badge('Поставщика нет', 'dim') : r.supplierName || h('span', { class: 'muted' }, '—'); } },
      { key: 'article', label: 'Артикул поставщика', cls: 'nowrap', render: (r) => r.article && !r.article.startsWith('manual:') ? r.article : h('span', { class: 'muted' }, '—') },
      { key: 'name', label: 'Название у поставщика', cls: 'clip', render: (r) => h('span', { title: r.name }, r.name, r.color ? h('span', { class: 'muted' }, ' · ' + r.color) : null) },
      { key: 'material', label: 'Наш материал', cls: 'clip md-hide', render: (r) => r.materialId ? h('span', { title: r.materialArticle }, r.materialName) : h('span', { class: 'badge warn', title: 'Не связана с позицией склада' }, 'нет связи') },
      { key: 'unit', label: 'Ед. изм.', cls: 'md-hide', render: (r) => r.unit || '' },
      { key: 'priceHint', money: true, label: 'Цена, ₽', cls: 'num right', render: (r) => r.priceHint != null ? money(r.priceHint) : h('span', { class: 'muted' }, '—') },
      { key: 'priceDate', label: 'Дата цены', cls: 'nowrap md-hide muted', render: (r) => (isStale(r) ? staleBadge(r.priceDate) : r.priceDate ? date(r.priceDate) : '') },
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
    photoMain: async (r, photoId) => { const x = await api(`/supply/catalog/items/${r.id}/photos/${photoId}/main`, { method: 'PUT' }); rowCache.set(x.id, x); return x; },
    photoRemove: async (r, photoId) => { const x = await api(`/supply/catalog/items/${r.id}/photos/${photoId}`, { method: 'DELETE' }); rowCache.set(x.id, x); return x; },
    heading: (r) => r.name,
    subheading: (r) => (isMaterial(r) ? 'Поставщика нет' : r.supplierName || ''),
    editTop: true,
    editable: (r) => !isMaterial(r),
    top: (r, ctx) => {
      if (isMaterial(r)) {
        return card({ size: 'M', variant: 'fields',
          body: readonlyGroup({ rows: [['Артикул', r.article || '—'], ['Ед. изм.', r.unit || '—'], ['Остаток', r.stockQty != null ? qty(r.stockQty) : '—']] }) });
      }
      const art = r.article && !r.article.startsWith('manual:') ? r.article : '';
      const mat = r.materialId
        ? h('span', null, r.materialName, r.materialArticle ? h('span', { class: 'muted' }, ' · ' + r.materialArticle) : null)
        : h('span', null, h('span', { class: 'muted' }, 'нет связи'), canWrite() ? button({ label: 'Связать с позицией', size: 'S', onClick: () => ctx.edit() }) : null);
      return card({ size: 'M', variant: 'fields',
        price: { value: r.priceHint != null ? `${money(r.priceHint)}${r.unit ? ' / ' + r.unit : ''}` : 'Цена не задана',
          note: r.priceHint != null && r.priceDate ? (isStale(r) ? staleBadge(r.priceDate) : 'от ' + date(r.priceDate)) : null },
        body: readonlyGroup({ rows: [
          ['Артикул у поставщика', art],
          ['Цвет', r.color], ['Группа', r.optGroup],
          ['Остаток', r.stockQty != null ? qty(r.stockQty) : ''],
          ['Откуда', SRC[r.source] || ''],
          ['Наш материал', mat],
          ['Примечание', r.note]] }) });
    },
    view: () => [],
    extra: (r) => {
      if (isMaterial(r)) return hint('Поставщика нет, цены нет. Чтобы появились — загрузите прайс поставщика кнопкой «Загрузить Excel» или сопоставьте его строку с этой позицией.');
      const hist = [...(r.priceHistory || [])].reverse();
      if (!hist.length) return stack(section({ title: 'История цен', tone: 'money', count: 0, body: h('p', { class: 'muted small' }, 'Истории цен пока нет.') }));
      return stack(section({ title: 'История цен', tone: 'money', count: hist.length, body:
        table({ columns: [{ label: 'Дата' }, { label: 'Цена, ₽', num: true }, { label: 'Откуда' }],
          rows: hist.map((x) => ({ cells: [x.date ? date(x.date) : '—', money(x.price), { v: SRC[x.source] || x.source || '', cls: 'muted' }] })) }) }));
    },
  },

  form: {
    closeAfterCreate: true,
    fields: async (r) => {
      if (!r) suppliersCache = null; // каждый раз свежий список: поставщик мог появиться в «Контрагентах» только что
      const sups = r ? [] : await loadSuppliers();
      return [
        { section: 'Позиция', tone: 'main', fixed: true },
        // поставщика нет в списке — «Создать «…»» прямо из поля (как в заявке)
        ...(r ? [] : [{ key: 'supplierName', label: 'Поставщик', type: 'combo', required: true, wide: true, max: 200, options: sups.map((o) => o.label),
          extra: (t, shown, form) => partnerAction('supplier', t, sups.map((o) => o.label), (n) => { suppliersCache = null; form.add(n); form.set('supplierName', n); }) }]),
        ...(r ? [] : [{ key: 'article', label: 'Артикул поставщика', max: 100, hint: 'Пусто — позиция узнаётся по нашему материалу' }]),
        { key: 'name', label: 'Название у поставщика', required: true, wide: true, max: 300 },
        { key: 'color', label: 'Цвет', max: 100 },
        { key: 'unit', label: 'Ед. изм.', max: 40 },
        { key: 'price', money: true, label: 'Цена, ₽', type: 'number', min: 0, hint: 'Изменение цены запишется в историю' },
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
        body.supplierName = v.supplierName;
        if (v.article) body.article = v.article;
        if (price !== null) body.price = price;
        if (v.material) body.materialId = v.material;
      }
      return body;
    },
    create: async ({ supplierName, ...body }) => {
      const key = String(supplierName || '').trim().toLowerCase();
      const find = async () => (await loadSuppliers()).find((o) => o.label.trim().toLowerCase() === key);
      let sup = await find();
      if (!sup) { suppliersCache = null; sup = await find(); }
      if (!sup) throw new Error(`Поставщика «${supplierName}» нет — нажмите «Создать «${supplierName}»» под полем`);
      body.supplierId = sup.value;
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
