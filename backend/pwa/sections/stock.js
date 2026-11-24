import { stockCard } from './stock-card.js';
import { stockTableColumns, stockRowClass } from './stock-table-columns.js';
import { catalogueStockList, catalogueStockQuery, heldStockQuery, stockLookup, stockScopeKey } from '../core/stock-list.js';
import { stockPositionCode, stockPositionName } from '../core/stock-display.js';
import { normSearch } from '../core/facets.js';
import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty, plural } from '../core/format.js';
import { go, patch, current } from '../core/router.js';
import { STOCK_STATUS } from '../ui/kit/badges.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { lookups, UNITS, unitList } from './lookups.js';
import { facetFilter, parseFt } from '../ui/kit/index.js';
import { index as facetIndex, pick as facetPick } from '../core/facets.js';
import { typeExpand } from './stock-types.js';
import { stockRequestsBox, requestFromHash, catalogFromHash, closeRequest } from './stock-requests.js';
import { loadZones, setZone, zoneNow } from '../core/zone.js';
import { segmented, toolbar, catArt, section, stack, button as kitButton, badge, card, row, tileGrid, landing, hint, empty, posPic } from '../ui/kit/index.js';

/** Переключатель склада над списком (kit.segmented): виден, если доступно больше одного склада. Выбор запоминается; список и категории перечитываются. */
function zoneBar() {
  const box = toolbar();
  box.hidden = true;
  loadZones().then((zs) => {
    // При одном складе сервер сам ограничивает список по роли.
    if (zs.length < 2) return;
    box.hidden = false;
    box.replaceChildren(segmented({ label: 'Склад', scroll: true, items: zs.map((z) => ({ key: z.id, label: z.name })), value: zoneNow(),
      onChange: (id) => {
        setZone(id);
        patch({ categoryId: undefined, ft: undefined, page: undefined, open: undefined }, { replace: true, kind: 'screen' });
        window.dispatchEvent(new CustomEvent('data-changed'));
      } }).el);
  }).catch(() => { /* без списка складов экран работает как раньше: сервер сам ограничивает по роли */ });
  return box;
}

export { mountPipeGrid } from './pipe-grid.js';
export { mountSheetGrid } from './sheet-grid.js';
import { metalBody, metalFields, metalInitial, metalKindUi } from './metal.js';
import { weightCount } from '../ui/weight-count.js';
import { errText } from '../ui/kit/errors.js';
import { openStockOp, openStockIssue } from './stock-ops.js';
import { passportSpecField, savePassportSpec } from './stock-passport.js';
import { mobileStockDashboard } from './warehouse-mobile.js';
import { qrBulkAction } from './qr.js';
import { stockDuplicateAction } from './stock-duplicate-preview.js';
import { stockOrderAction } from './order-bulk.js';
import { openStockBulk } from './stock-bulk.js';

/** Раздел «Склад» (PRODUCT §2): materials + storageitems через /api/stock. */
const unit = (r) => r.unit || '';
/** Миниатюра в строке списка (или пустое место того же размера — колонки не прыгают). */
/** Миниатюра в ячейке таблицы; фото нет (или битое) — ячейка пустая, без квадрата-заглушки. */
export const pic = (p) => (p ? h('img', { class: 'pic', src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null);
let knownStockZones = [];
const columnScopes = new Map();
const scopeKey = () => JSON.stringify([stockScopeKey(), zoneNow()]);
const columnScope = (params = {}) => {
  const rows = columnScopes.get(scopeKey()) || [];
  const categories = params.categoryId ? new Set(params.categoryId.split(',')) : null;
  return categories ? rows.filter(item => categories.has(item.categoryId || 'none')) : rows;
};
const zoneStockKind = () => {
  const name = knownStockZones.find(zone => zone.id === zoneNow())?.name?.toLowerCase() || '';
  return /труб/.test(name) ? 'pipe' : /лист/.test(name) ? 'sheet' : /дерев/.test(name) ? 'wood' : 'main';
};
const stockKind = (params = {}) => {
  const zoneKind = zoneStockKind();
  const rows = params.categoryId ? columnScope(params) : [];
  return zoneKind !== 'main' ? zoneKind : rows.length && rows.every(item => item.metal === 'pipe') ? 'pipe'
    : rows.length && rows.every(item => item.metal === 'sheet') ? 'sheet' : 'main';
};
const photoThumb = (r) => posPic((r.photos || [])[0], 'sm');

/** Шапка «Остатков» (УПР-1/Д5): одна синяя «Принять на склад» + «Ещё ▾» (Бронь по списку, Пересчёт, Движения; ⇩ Excel добавляет list.js автоматически). */
const stockActions = () => kitButton({ label: 'Принять на склад', onClick: () => openStockOp('in') });
const stockMore = () => [
  { items: [
    { label: 'Бронь по списку', onSelect: () => openStockOp('reserve') },
    { label: 'Пересчёт', onSelect: () => openStockOp('count') }] },
  { sep: true, items: [{ label: 'Движения', href: '#movements' }] },
];

/** Новая позиция: подсказка «уже есть на складе», иначе одно и то же заводится второй раз с другим написанием. */
const similarOnStock = () => ({
  suggestTitle: 'Уже есть на складе — проверьте, не дубль ли',
  suggest: async () => (await stockLookup()).map((x) => ({ label: x.name, sub: `${qty(x.quantity ?? 0)} ${x.unit || ''}`.trim(), cat: x.categoryName || '', search: normSearch([x.name, x.assortment].filter(Boolean).join(' ')), values: { name: x.name } })),
});

/** Выборка «Остатков»: список и признаки получают одну зону с сервера. */
async function balanceQuery(P) {
  knownStockZones = await loadZones().catch(() => []);
  const zoneId = zoneNow();
  const query = { priority: 1, ...(P.held === '1' ? heldStockQuery(zoneId) : catalogueStockQuery(zoneId)) };
  let catalogue;
  if (zoneStockKind() === 'main' || P.ft) {
    const key = scopeKey(); catalogue = await catalogueStockList(zoneId);
    if (key === scopeKey()) columnScopes.set(key, catalogue);
  }
  if (P.ft) {
    const items = facetIndex(catalogue.map(item => ({ ...item })), { stockSearch: true });
    const candidates = facetPick(items, { q: P.q || '', cat: P.categoryId || '' });
    const matching = facetPick(candidates, { sel: parseFt(P.ft) });
    if (!matching.length || matching.length !== candidates.length) {
      query.ids = matching.length ? matching.map((it) => it.id).join(',') : 'none';
    }
  }
  return query;
}

// ---------- первая страница «Остатков»: плитки категорий (эталон cat-tile, как «Каталог поставщиков») ----------
const nPos = (n) => `${qty(n)} ${plural(n, 'позиция', 'позиции', 'позиций')}`;
/** Метка у названия трубы (эталон badge): «нерж.» / «Мытая». */
async function stockLanding() {
  const categories = (zoneId) => api('/stock/categories', { query: catalogueStockQuery(zoneId) });
  const [summary, zones] = await Promise.all([categories(), loadZones().catch(() => [])]);
  const cats = (summary.items || []).filter((c) => c.id !== 'none');
  const open = (p) => patch({ ...p, view: 'table', page: undefined });
  const all = kitButton({ label: 'Все позиции списком', onClick: () => open({ all: '1' }) });
  if (!summary.total) { const box = empty({ title: 'На складе пока нет позиций в наличии.' }); box.append(all); return box; }
  const art = (name) => { const el = h('span'); el.innerHTML = catArt(name); return el; }; // свой статичный SVG, данных пользователя нет
  const catTile = (c, zoneId) => card({ size: 'S', artCover: true, art: art(c.name), title: c.name, meta: nPos(c.total), low: c.low ? `к закупке ${c.low}` : undefined,
    ...typeExpand({ categoryId: c.id, categoryName: c.name, zoneId, onPick: (t) => { if (zoneId) setZone(zoneId); open({ categoryId: c.id, ft: t ? `type:${t}` : undefined }); } }) });
  const head = `Выберите ${zones.length > 1 ? 'склад' : 'категорию'} · всего ${nPos(summary.total)}`;
  // один склад или ни одного — сразу категории
  if (zones.length < 2) return landing({ head: cats.length ? head : `Всего ${nPos(summary.total)}`, action: all, body: tileGrid(...cats.map((c) => catTile(c, ''))) });
  const zoneItems = await Promise.all(zones.map(async (z) => {
    const one = await categories(z.id);
    const zc = one.items.filter((c) => c.id !== 'none');
    return card({ size: 'S', artCover: true, art: art(z.name), title: z.name, meta: nPos(one.total) + (zc.length ? ` · категорий ${zc.length}` : ''),
      expand: { title: 'Категории склада «' + z.name + '»',
        action: kitButton({ label: 'Весь склад →', kind: 'ghost', size: 'S', onClick: () => { setZone(z.id); open({ all: '1' }); } }),
        body: zc.length ? tileGrid(...zc.map((c) => catTile(c, z.id))) : hint(one.total ? 'В наличии только позиции без категории.' : 'В этой зоне пока нет позиций в наличии.') } });
  }));
  return landing({ head, action: all, body: tileGrid(...zoneItems) });
}

export const stock = {
  id: 'stock',
  title: 'Остатки',
  newTitle: 'Новая позиция склада',
  entityType: 'Material',
  historyLabels: { 'stock.item.created': 'Создана', 'stock.item.updated': 'Изменена', 'stock.item.deleted': 'Удалена', 'stock.item.restored': 'Восстановлена', 'stock.item.moved': 'Движение по складу' },
  get: (id) => api(`/stock/items/${id}`),

  list: {
    path: '/stock/items',
    // левая панель (NAV F2): поиск → категории → состояние → признаки «тип / резьба / длина / стандарт»; выбранное уходит словами поиска
    sidebar: true,
    chipsTop: true, // СКФ.2: «Состояние» — строкой над таблицей
    toolbarExtra: () => facetFilter({ categoryKey: 'categoryId', inline: true, loadItems: catalogueStockList }),
    extraKeys: ['ft', 'all', 'held'],
    // первая страница — плитки категорий с рисунками (как «Продукция» и «Каталог номенклатуры»); галерея — карточки позиций с фото
    gallery: { limit: 100, card: (r) => ({ pic: r.photos?.[0] ? PREFIX + (r.photos[0].thumb || r.photos[0].url) : null, title: stockPositionName(r), meta: [r.categoryName, stockPositionCode(r)].filter(Boolean).join(' · '), price: `${qty(r.quantity)} ${unit(r)}` }) },
    landing: { when: (P) => !P.categoryId && !P.q && !P.ft && !P.status && !P.all, render: stockLanding },
    // priority=1: «заканчивается» и «в брони» — сверху (внутри групп — выбранный порядок)
    query: balanceQuery,
    export: 'admin',
    exportLimit: Infinity,
    bulk: { open: (ids, { done }) => openStockBulk({ ids, done }), extra: [stockOrderAction, stockDuplicateAction(), qrBulkAction('S')] },
    headActions: () => [kitButton({ label: 'Выдать материалы', kind: 'primary', onClick: openStockIssue }), stockActions()],
    moreActions: stockMore,
    top: (_reload) => h('div', null, zoneBar(), stockRequestsBox(), mobileStockDashboard()),
    sortDefault: 'name',
    sortFor: P => ({ pipe: 'sectionSize', sheet: 'sheetSize', wood: 'woodSize' }[stockKind(P)] || 'name'),
    columnsFor: P => stockTableColumns(stockKind(P), pic, columnScope(P)),
    rowClass: stockRowClass,
    createLabel: 'Новая позиция склада',
    searchPlaceholder: 'Название, размер, стандарт…',
    emptyText: 'На складе пока нет позиций.', emptyHint: 'Позиции появляются из прихода по заявке или кнопкой «Новая позиция склада» (категория, ед. изм., остаток).',
    filters: [
      { key: 'status', label: 'Состояние', type: 'chips',
        options: () => [
          { value: 'low', label: 'Ниже минимума' },
          { value: 'ordered', label: 'Ждут поставку' },
          { value: 'reserved', label: 'В брони' },
          { value: 'ok', label: 'В норме' },
        ],
        count: (resp, v) => resp.counts?.[v || 'all'],
      },
      { key: 'availability', label: 'Наличие', type: 'select', options: () => [{ value: 'in', label: 'В наличии' }, { value: 'none', label: 'Нет в наличии' }] },
      { key: 'categoryId', label: 'Категория', type: 'hidden' }, // выбирается списком «Категории» в левой панели
    ],
    // C266: подсказки над таблицей убраны — занимали место, смысл и так в чипах/кнопках строк
    hints: undefined,
    rowAction: (r) => {
      // УПР-1/Д5: ≤ 2 кнопки. Главная — «Выдать» (если есть бронь) или «Забронировать»; вторая — «+ Принять». «Списать» только в карточке.
      const inc = { label: '+ Принять', title: 'Поступление на склад', run: (row) => { openStockOp('in', row.id); return false; } };
      const main = r.reservedQty > 0
        ? { label: 'Выдать', title: 'Выдать из брони', run: (row) => { openStockOp('fromres', row.id); return false; } }
        : { label: 'Забронировать', title: 'Забронировать под заказ', run: (row) => { openStockOp('reserve', row.id); return false; } };
      return Number(r.free ?? r.quantity) > 0 || r.reservedQty > 0 ? [main, inc] : [inc];
    },
    tiles: {
      key: 'categoryId', title: 'Категории',
      load: async () => {
        knownStockZones = await loadZones().catch(() => []);
        return (await api('/stock/categories', { query: catalogueStockQuery(zoneNow()) })).items.filter((c) => c.id !== 'none').map((c) => ({
          value: c.id, label: c.name, n: c.total,
          sub: h('span', null, c.low ? h('span', { class: 'warn' }, `к закупке ${c.low}`) : 'всё в норме', c.ordered ? ` · заказано ${c.ordered}` : null),
        }));
      },
    },
    columns: stockTableColumns('main', pic, []),
    card: {
      thumb: photoThumb,
      title: stockPositionName,
      sub: (r) => [r.categoryName, r.reservedQty ? `бронь ${qty(r.reservedQty)}` : '', stockPositionCode(r)].filter(Boolean).join(' · '),
      side: (r) => [h('b', { class: 'num' }, `${qty(r.quantity)} ${unit(r)}`), badge(STOCK_STATUS, r.status)],
    },
  },

  card: stockCard,

  form: {
    fields: async (row) => {
      const lk = await lookups().catch(() => ({ categories: [] }));
      const [ps, metal] = await Promise.all([passportSpecField(row), metalFields()]);
      const namesOpen = !!(row?.fullName || row?.invoiceName);
      const stockOpen = !!(row?.weightG || row?.minQuantity);
      return [
        // C022: воронка — сначала категория и ед., затем названия; металл только у трубы/листа
        { section: 'Что за позиция', tone: 'main', fixed: true },
        { key: 'categoryName', label: 'Категория', type: 'combo', required: !row, options: lk.categories.map((c) => c.name), max: 100, hint: 'От категории зависят поля трубы или листа' },
        { key: 'unit', label: 'Ед. изм.', type: 'combo', required: true, options: unitList(lk), max: 30, hint: ' ' },
        { key: 'name', label: 'Короткое название', required: true, max: 300, span: 3, ...(row ? {} : similarOnStock()), hint: 'Для списков и фильтров: «Болт мебельный, M8х40, DIN 603»' },
        { key: 'article', label: 'Артикул (поставщика)', max: 100, span: 1, hint: 'Из счёта / заявки. Пусто — останется внутренний код' },
        { section: 'Ещё названия', tone: 'info', collapsed: !namesOpen },
        { key: 'fullName', label: 'Длинное название', max: 500, span: 3, hint: 'Для документов и паспорта. Пусто — берётся короткое' },
        { key: 'invoiceName', label: 'Название в счёте', max: 500, span: 3, hint: 'Как пишет поставщик — поиск найдёт позицию и по нему' },
        ...(row ? [] : [{ section: 'Начальный остаток', tone: 'info', fixed: true },
          { key: 'initial', type: 'widget', label: '', wide: true,
            widget: () => {
              const host = h('div');
              const q = h('input', { inputmode: 'decimal', placeholder: '0' });
              let wc = weightCount({ qtyInput: q, unit: 'шт', label: 'Количество' });
              host.append(wc.el);
              const api = {
                el: host,
                get value() { return JSON.stringify(wc.get()); },
                set value(_) { /* только ввод */ },
                setUnit(u) { wc = weightCount({ qtyInput: q, unit: u || 'шт', label: 'Количество' }); host.replaceChildren(wc.el); },
              };
              return api;
            },
            mount: (f) => {
              const sync = () => f.input('initial')?.setUnit?.(f.get('unit') || 'шт');
              f.on('unit', sync); sync();
            } }]),
        ...metal,
        { section: 'Фото и примечание', tone: 'main' },
        { key: 'photos', label: 'Фото', type: 'photos', hint: 'Перетащите, вставьте Ctrl+V или выберите файл' },
        { key: 'notes', label: 'Примечание', type: 'textarea', wide: true },
        { section: 'Склад', tone: 'info', collapsed: !stockOpen },
        { key: 'minQuantity', label: 'Минимальный остаток', type: 'number', min: 0, hint: 'Станет меньше — позиция попадёт в «К закупке»' },
        { key: 'weightG', label: 'Вес 1 шт., г', type: 'number', min: 0, hint: 'Для счёта по весу: штуки = вес партии ÷ вес 1 шт.' },
        ...(ps ? [{ section: 'Для паспорта', tone: 'neutral' }, ps] : []),
      ];
    },
    initial: () => {
      const fromReq = requestFromHash();
      const fromCat = catalogFromHash();
      const context = current().params;
      return { unit: context.unit || 'шт', categoryName: context.categoryName || '', photos: [], name: fromReq.name || fromCat.name || '', article: fromCat.article || '' };
    },
    toInitial: (r) => ({ ...r, article: r.supplierArticle || '', ...metalInitial(r), weightG: r.weightG ?? null, photos: r.photos || [] }),
    toBody: (v, row) => {
      const b = { photoIds: v.photos || [], name: v.name, fullName: v.fullName || '', invoiceName: v.invoiceName || '', unit: v.unit || 'шт', categoryName: v.categoryName || '', notes: v.notes || '' };
      if (v.article) b.article = v.article;
      // пустое поле = стереть значение (В.7): null уходит на сервер, мин. остаток станет 0
      b.minQuantity = v.minQuantity;
      b.weightG = v.weightG; // НО: вес 1 шт. в граммах (сервер хранит кг)
      if (v.initial) b.initial = v.initial;
      if (v.passportSpec) b.passportSpec = v.passportSpec;
      const wasKind = row ? (row.metal || metalKindUi(row.categoryName, row.unit)) : null;
      return { ...b, ...metalBody(v, { wasKind, previous: row }) };
    },
    create: async (body) => {
      const same = await api('/stock/items', { query: { search: body.name, limit: 20 } });
      const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
      const twin = same.items.find((i) => norm(i.name) === norm(body.name));
      if (twin) throw new Error(`Позиция «${twin.name}» уже есть на складе — найдите её поиском`);
      const { photoIds, initial, ...rest } = body;
      let r = await api('/stock/items', { method: 'POST', body: rest });
      // начальный остаток — штуками или по весу (НО.2): приход в штуках, расчёт — в примечании
      if (initial?.byWeight || initial?.qty > 0) {
        try { r = await api(`/stock/items/${r.id}/move`, { method: 'POST', body: { type: 'in', qty: initial.qty || 1, note: 'Ввод начального остатка', ...(initial.byWeight ? { byWeight: initial.byWeight } : {}) } }); }
        catch (e) { toast(`Позиция создана, но начальный остаток не записан: ${errText(e)}. Сделайте «+ Принять» в карточке.`, { error: true }); }
      }
      for (const photoId of photoIds || []) {
        try { r = await api(`/stock/items/${r.id}/photos`, { method: 'POST', body: { photoId } }); }
        catch (e) { toast(`Позиция создана, но фото не прикрепилось: ${errText(e)}. Добавьте фото в карточке.`, { error: true }); break; }
      }
      lookups.reset();
      const fromReq = requestFromHash().id; // создано по заявке кладовщика — закрываем её
      if (fromReq) await closeRequest(fromReq, 'done', r.id).catch(() => toast('Позиция создана, но заявка осталась открытой — отклоните или закройте её в списке', { error: true }));
      const fromCat = catalogFromHash().id; // C009: из каталога — связать и вернуться, без второго «того же» имени
      if (fromCat) {
        try {
          await api(`/supply/catalog/items/${fromCat}`, { method: 'PATCH', body: { materialId: r.id } });
          toast('Позиция создана и связана с каталогом');
          go('suppliercatalog', { open: fromCat, new: undefined, fromCatalog: undefined, name: undefined, article: undefined });
        } catch (e) {
          toast(`Позиция создана, но связь с каталогом не записалась: ${errText(e)}. Откройте строку каталога и выберите её вручную.`, { error: true });
        }
      }
      return r;
    },
    update: async (id, body) => {
      const { photoIds, passportSpec, ...rest } = body;
      let r = await api(`/stock/items/${id}`, { method: 'PATCH', body: rest });
      // Основные данные уже записаны; сбой паспорта оставляет форму с текстами для повторного сохранения.
      try { await savePassportSpec(id, passportSpec); }
      catch (e) { throw new Error(`Основные данные сохранены. Блок «Для паспорта» не записался: ${errText(e)} Повторите сохранение.`, { cause: e }); }
      try {
        const have = new Set((r.photos || []).map((p) => p.id));
        for (const photoId of photoIds || []) if (!have.has(photoId)) r = await api(`/stock/items/${id}/photos`, { method: 'POST', body: { photoId } });
        for (const p of have) if (photoIds && !photoIds.includes(p)) r = await api(`/stock/items/${id}/photos/${p}`, { method: 'DELETE' });
        if (photoIds?.[0] && r.photos?.[0]?.id !== photoIds[0]) r = await api(`/stock/items/${id}/photos/${photoIds[0]}/main`, { method: 'PUT' }); // ★ в форме
      } catch (e) { toast(`Название сохранено. Фото не обновились: ${errText(e)}. Добавьте фото в карточке.`, { error: true }); }
      lookups.reset(); return r;
    },
  },

  remove: { password: true,
    blocked: (r) => (r.quantity > 0 ? `Нельзя удалить: на складе ${qty(r.quantity)} ${unit(r)}. Сначала спишите или сделайте инвентаризацию до 0.`
      : r.reservedQty > 0 ? 'Нельзя удалить: по позиции есть бронь. Сначала снимите её.' : null),
    text: (r) => `Удалить позицию «${r.name}»?`,
    run: (r) => api(`/stock/items/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/stock/items/${r.id}/restore`, { method: 'POST' }),
  },

  searchRow: (r) => ({ title: stockPositionName(r), sub: [stockPositionCode(r), r.categoryName, `${qty(r.quantity)} ${unit(r)}`].filter(Boolean).join(' · '), side: badge(STOCK_STATUS, r.status) }),
  open: (id) => go('stock', { open: id }),
};

