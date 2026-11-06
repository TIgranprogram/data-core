import { grp } from '../ui/kit/index.js';
import { stockLookup, stockList } from '../core/stock-list.js';
import { normSearch } from '../core/facets.js';
import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { busyBtn, failBlock } from '../ui/kit/busy.js';
import { date, qty, plural } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { badge, STOCK_STATUS } from '../ui/kit/badges.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { lookups, UNITS, unitList } from './lookups.js';
import { facetFilter, ftParams, ftQuery, parseFt } from '../ui/kit/index.js';
import { facetLabel, pipeKey, index as facetIndex, pick as facetPick } from '../core/facets.js';
import { stockRequestsBox, requestFromHash, catalogFromHash, closeRequest } from './stock-requests.js';
import { loadZones, setZone, zoneNow, zoneQuery } from '../core/zone.js';
import { segmented, toolbar, catArt, section, stack, button as kitButton } from '../ui/kit/index.js';

/** Переключатель склада над списком (kit.segmented): виден, если доступно больше одного склада. Выбор запоминается; список и категории перечитываются. */
function zoneBar() {
  const box = toolbar();
  box.hidden = true;
  const used = zoneNow();
  loadZones().then((zs) => {
    // один склад: переключатель скрыт; раньше при used слали data-changed и сбрасывали кэш 10k (C022)
    if (zs.length < 2) return;
    box.hidden = false;
    box.replaceChildren(segmented({ label: 'Склад', items: zs.map((z) => ({ key: z.id, label: z.name })), value: zoneNow(),
      onChange: (id) => { setZone(id); patch({ categoryId: undefined, page: undefined }); window.dispatchEvent(new CustomEvent('data-changed')); } }).el);
    if (zoneNow() !== used) window.dispatchEvent(new CustomEvent('data-changed')); // запомненный склад устарел — список уже ушёл с другим
  }).catch(() => { /* без списка складов экран работает как раньше: сервер сам ограничивает по роли */ });
  return box;
}

export { mountPipeGrid } from './pipe-grid.js';
export { mountSheetGrid } from './sheet-grid.js';
import { metalBody, metalFields, metalInitial, metalKindUi, metalView, offcutDialog } from './metal.js';
import { orderedBlock, orderItem } from './item-orders.js';
import { weightCount } from '../ui/weight-count.js';
import { errText } from '../ui/kit/errors.js';
import { openStockOp, openStockIssue } from './stock-ops.js';
import { targetNote } from '../ui/kit/target-picker.js';
import { passportSpecField, passportSpecView, savePassportSpec } from './stock-passport.js';
import { mobileStockDashboard } from './warehouse-mobile.js';
import { qrBulkAction, qrPrintAction } from './qr.js';

/** Раздел «Склад» (PRODUCT §2): materials + storageitems через /api/stock. */
const unit = (r) => r.unit || '';
/** Миниатюра в строке списка (или пустое место того же размера — колонки не прыгают). */
/** Миниатюра в ячейке таблицы; фото нет (или битое) — ячейка пустая, без квадрата-заглушки. */
export const pic = (p) => (p ? h('img', { class: 'pic', src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null);
const photoThumb = (r) => {
  const p = (r.photos || [])[0];
  return p ? h('img', { class: 'thumb', src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy' }) : null;
};

const HIST = { in: 'Приход', out: 'Списание', adjust: 'Корректировка', count: 'Пересчёт', transfer: 'Перемещение', reserve: 'Бронь', unreserve: 'Снятие брони' };
/** Последние 5 записей истории позиции (GET /stock/items/:id/history?limit=5) и «Вся история» — без ограничения. */
function recentMoves(r) {
  const ul = h('ul', { class: 'timeline' }, h('li', { class: 'muted' }, 'Загрузка…')); const more = h('div', { class: 'actions' }); const box = h('div');
  const paint = (count) => box.replaceChildren(section({ tone: 'gold', title: 'Последние записи', count, open: box.querySelector('details.k-sec')?.open || false, body: [ul, more] })); paint(null);
  const show = (res, full) => {
    paint(res.total ?? res.items.length); if (!res.items.length) { ul.replaceChildren(h('li', { class: 'muted' }, 'Движений нет. Приход и списание — кнопки в карточке позиции.')); more.replaceChildren(); return; }
    ul.replaceChildren(...res.items.map((m) => h('li', null,
      h('span', { class: 'when' }, date(m.date)), h('span', null, HIST[m.type] || m.type),
      h('span', { class: 'num ' + (m.type === 'in' ? 'pos' : m.type === 'out' ? 'neg' : '') }, (m.type === 'in' ? '+' : m.type === 'out' ? '−' : '') + qty(m.qty)),
      h('span', { class: 'muted', style: { flex: '1' } }, targetNote(m), targetNote(m) && m.note ? ' · ' : '', m.note || ''))));
    more.replaceChildren(...[
      !full && res.total > res.items.length ? kitButton({ label: `Вся история (${res.total})`, kind: 'ghost', size: 'S', onClick: async (e) => {
        const free = busyBtn(e.currentTarget, null);
        try { show(await api(`/stock/items/${r.id}/history`), true); } catch (err) { free(); toastError(err, 'загрузить историю'); }
      } }) : null,
      h('a', { class: 'btn btn-ghost btn-sm', href: '#movements?materialId=' + r.id, title: 'Журнал движений позиции — там можно отменить ошибочное' }, 'Журнал движений →')].filter(Boolean));
  };
  const loadHist = () => api(`/stock/items/${r.id}/history`, { query: { limit: 5 } }).then((res) => show(res, false)).catch((e) => ul.replaceChildren(h('li', null, failBlock(e, loadHist, { text: 'История не загрузилась' }))));
  loadHist();
  return box;
}

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
  suggest: async () => (await stockLookup()).map((x) => ({ label: x.name, sub: `${qty(x.quantity ?? 0)} ${x.unit || ''}`.trim(), cat: x.categoryName || '', search: normSearch(x.name), values: { name: x.name } })),
});

/** Полный список склада с признаками (тот же, по которому кнопки-признаки считают числа); грузится вместе с фильтром. */
let ftItems = null;
const ftLoad = () => stockList().then((x) => { ftItems = facetIndex(x); }).catch(() => {});
/** Позиции под выбранные признаки — как у кнопки: { ids } для GET /stock/items; нет списка — null. */
function ftIds(P) {
  if (!ftItems) { ftLoad().then(() => ftItems && window.dispatchEvent(new CustomEvent('data-changed'))); return null; } // открыли по ссылке с признаком — догрузили и перечитали
  const ids = facetPick(ftItems, { q: P.q || '', cat: P.categoryId || '', sel: parseFt(P.ft) }).map((it) => it.id);
  return { ids: ids.length ? ids.join(',') : 'none' };
}

// ---------- первая страница «Остатков»: плитки категорий (эталон cat-tile, как «Каталог поставщиков») ----------
const nPos = (n) => `${qty(n)} ${plural(n, 'позиция', 'позиции', 'позиций')}`;
async function stockLanding() {
  const [catsR, zones] = await Promise.all([api('/stock/categories'), loadZones().catch(() => [])]);
  const cats = (catsR.items || []).filter((c) => c.id !== 'none' && c.total);
  const open = (p) => patch({ ...p, view: 'table', page: undefined });
  const all = kitButton({ label: 'Все позиции списком', onClick: () => open({ all: '1' }) });
  if (!cats.length) return h('div', { class: 'state' }, h('div', null, 'Категорий пока нет — позиции покажутся списком.'), all);
  const art = (name, cls) => { const el = h('div', { class: cls }); el.innerHTML = catArt(name); return el; }; // свой статичный SVG, данных пользователя нет
  const low = (c) => [c.low ? `к закупке ${c.low}` : '', c.none ? `нет ${c.none}` : ''].filter(Boolean).join(' · ');
  const catTile = (c, zoneId) => h('button', { type: 'button', class: 'cat-tile', title: c.name, onclick: () => { if (zoneId) setZone(zoneId); open({ categoryId: c.id }); } }, art(c.name, 'cat-art'),
    h('div', { class: 'cat-body' }, h('div', { class: 'cat-name' }, c.name), h('div', { class: 'cat-n' }, nPos(c.total), low(c) ? h('span', { class: 'warn' }, ' · ' + low(c)) : null)));
  const total = cats.reduce((a, c) => a + c.total, 0);
  const head = h('div', { class: 'cat-top' }, h('p', { class: 'muted' }, `Выберите ${zones.length > 1 ? 'склад' : 'категорию'} · всего ${nPos(total)}`), all);
  // один склад или ни одного — сразу категории
  if (zones.length < 2) return h('div', { class: 'cat-landing' }, head, h('div', { class: 'cat-grid' }, ...cats.map((c) => catTile(c, ''))));
  // склады — большие плитки (как разделы «Продукции»), под ними — категории склада; категория без склада — в основном
  const def = zones.find((z) => z.isDefault) || zones[0];
  const zoneOf = (c) => zones.find((z) => (z.categoryIds || []).includes(c.id)) || def;
  const items = [];
  const setOpen = (id) => { for (const it of items) { const on = it.id === id; it.tile.classList.toggle('active', on); it.tile.setAttribute('aria-expanded', String(on)); it.panel.classList.toggle('open', on); if (on) it.panel.removeAttribute('inert'); else it.panel.setAttribute('inert', ''); } };
  const zoneItem = (z) => {
    const zc = cats.filter((c) => zoneOf(c) === z);
    const n = zc.reduce((a, c) => a + c.total, 0);
    const pid = 'zone-p-' + z.id;
    const tile = h('button', { type: 'button', class: 'sec-tile sec-stock', title: z.name, 'aria-expanded': 'false', 'aria-controls': pid,
      onclick: () => setOpen(tile.classList.contains('active') ? '' : z.id) }, art(z.name, 'sec-art'),
      h('span', { class: 'sec-body' }, h('span', { class: 'sec-name' }, z.name), h('span', { class: 'sec-n' }, nPos(n) + (zc.length ? ` · категорий ${zc.length}` : ''))),
      h('span', { class: 'sec-chev', 'aria-hidden': 'true' }, '▾'));
    const panel = h('div', { class: 'sec-panel', id: pid, inert: '' }, h('div', { class: 'sec-panel-in' },
      h('div', { class: 'sec-panel-head' }, h('h3', null, 'Категории склада «' + z.name + '»'), kitButton({ label: 'Весь склад →', kind: 'ghost', onClick: () => { setZone(z.id); open({ all: '1' }); } })),
      zc.length ? h('div', { class: 'cat-grid' }, ...zc.map((c) => catTile(c, z.id))) : h('p', { class: 'muted' }, 'Категорий нет — отметьте их в «Справочники» → «Склады».')));
    items.push({ id: z.id, tile, panel });
    return h('div', { class: 'sec-item' }, tile, panel);
  };
  const node = h('div', { class: 'cat-landing' }, head, h('div', { class: 'sec-grid' }, ...zones.map(zoneItem)));
  setOpen(def.id); // основной раскрыт сразу — частые категории под рукой
  return node;
}

export const stock = {
  id: 'stock',
  title: 'Склад',
  newTitle: 'Новая позиция склада',
  entityType: 'Material',
  historyLabels: { 'stock.item.created': 'Создана', 'stock.item.updated': 'Изменена', 'stock.item.deleted': 'Удалена', 'stock.item.restored': 'Восстановлена', 'stock.item.moved': 'Движение по складу' },
  get: (id) => api(`/stock/items/${id}`),

  list: {
    path: '/stock/items',
    // левая панель (NAV F2): поиск → категории → состояние → признаки «тип / резьба / длина / стандарт»; выбранное уходит словами поиска
    sidebar: true,
    chipsTop: true, // СКФ.2: «Состояние» — строкой над таблицей
    toolbarExtra: () => facetFilter({ categoryKey: 'categoryId', inline: true }),
    extraKeys: ['ft', 'all'],
    // первая страница — плитки категорий с рисунками (как «Продукция» и «Каталог поставщиков»); галерея — карточки позиций с фото
    gallery: { limit: 100, card: (r) => ({ pic: r.photos?.[0] ? PREFIX + (r.photos[0].thumb || r.photos[0].url) : null, title: r.name, meta: [r.categoryName, r.article].filter(Boolean).join(' · '), price: `${qty(r.quantity)} ${unit(r)}` }) },
    landing: { when: (P) => !P.categoryId && !P.q && !P.ft && !P.status && !P.all, render: stockLanding },
    // priority=1: «заканчивается» и «в брони» — сверху (внутри групп — выбранный порядок)
    // признаки: список — ровно те позиции, что посчитала кнопка (ids из полного списка склада); список ещё не загружен — по словам, как раньше
    query: (P) => ({ priority: 1, ...zoneQuery(), ...(P.ft ? ftIds(P) || { search: [P.q, ftQuery(P.ft)].filter(Boolean).join(' ') || undefined, ...ftParams(P.ft) } : {}) }),
    export: 'admin',
    bulk: { extra: [qrBulkAction('S')] }, // только «Распечатать QR» над отмеченными (без «Изменить выбранные»)
    headActions: () => [kitButton({ label: 'Выдать материалы', kind: 'primary', onClick: openStockIssue }), stockActions()],
    moreActions: stockMore,
    top: (_reload) => h('div', null, zoneBar(), stockRequestsBox(), mobileStockDashboard()),
    sortDefault: 'name',
    createLabel: 'Новая позиция склада',
    searchPlaceholder: 'Название, размер, стандарт…',
    emptyText: 'На складе пока нет позиций.', emptyHint: 'Позиции появляются из прихода по заявке или кнопкой «Новая позиция склада» (категория, ед. изм., остаток).',
    filters: [
      { key: 'status', label: 'Состояние', type: 'chips',
        options: () => [
          { value: 'ok,low,reserved', label: 'В наличии' },
          { value: 'none', label: 'Нет на складе' },
          { value: 'low,none', label: 'Требуют внимания' },
          { value: 'low', label: 'Ниже минимума' },
          { value: 'ordered', label: 'Ждут поставку' },
          { value: 'reserved', label: 'В брони' },
          { value: 'ok', label: 'В норме' },
        ],
        count: (resp, v) => v === '' ? resp.counts?.all : v.includes(',') ? v.split(',').reduce((s, k) => s + (resp.counts?.[k] ?? 0), 0) : resp.counts?.[v],
      },
      { key: 'categoryId', label: 'Категория', type: 'hidden' }, // выбирается списком «Категории» в левой панели
    ],
    hints: {
      '': 'Все позиции склада. «+ Принять» и «Забронировать» — в строке; бронь списком, пересчёт и движения — в «Ещё».',
      low: 'Меньше минимального остатка — пора заказать: откройте позицию → «Заказать».',
      none: 'Закончилось — закажите из карточки, если позиция ещё нужна.',
      ordered: 'Заказано, ждём поставку. Приехало — откройте позицию и нажмите «Принять» у заявки.',
      reserved: 'Отложено под заказы. В строке — «Выдать». Снять бронь — в карточке позиции.',
      ok: 'Хватает. Делать ничего не нужно.',
    },
    rowAction: (r) => {
      // УПР-1/Д5: ≤ 2 кнопки. Главная — «Выдать» (если есть бронь) или «Забронировать»; вторая — «+ Принять». «Списать» только в карточке.
      const inc = { label: '+ Принять', title: 'Поступление на склад', run: (row) => { openStockOp('in', row.id); return false; } };
      const main = r.reservedQty > 0
        ? { label: 'Выдать', title: 'Выдать из брони', run: (row) => { openStockOp('fromres', row.id); return false; } }
        : { label: 'Забронировать', title: 'Забронировать под заказ', run: (row) => { openStockOp('reserve', row.id); return false; } };
      return [main, inc];
    },
    tiles: {
      key: 'categoryId', title: 'Категории',
      load: async () => (await api('/stock/categories', { query: zoneQuery() })).items.filter((c) => c.id !== 'none').map((c) => ({
        value: c.id, label: c.name, n: c.total,
        sub: h('span', null, c.low || c.none ? [c.low ? h('span', { class: 'warn' }, `к закупке ${c.low}`) : null, c.low && c.none ? ' · ' : null, c.none ? `нет ${c.none}` : null] : 'всё в норме', c.ordered ? ` · заказано ${c.ordered}` : null),
      })),
    },
    columns: [
      { key: 'pic', label: '', cls: 'pic-cell', render: (r) => pic(r.photos?.[0]) },
      { key: 'name', label: 'Название', sort: 'name', cls: 'clip', render: (r) => (r.metal === 'pipe' && r.assortment
        ? h('span', { title: r.name }, h('b', null, facetLabel('pipe', pipeKey(r))), /нерж/i.test(r.name) ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'нерж.') : null, r.washed == null ? null : h('span', { class: 'badge ' + (r.washed ? 'info' : 'warn'), style: { marginLeft: '6px' } }, r.washed ? 'Мытая' : 'Не мытая'))
        : h('span', { title: r.name }, r.name)) },
      { key: 'categoryName', label: 'Категория', sort: 'categoryName', cls: 'md-hide', render: (r) => r.categoryName || '' },
      { key: 'quantity', label: 'Остаток', sort: 'quantity', cls: 'num right', render: (r) => {
        // C022-4: «м» и пересчёт хлыстов — только труба в метрах с длиной хлыста; обрезок в шт — как штуки
        const pipeM = r.metal === 'pipe' && String(r.unit || '').toLowerCase() === 'м';
        return h('span', { class: 'nowrap' }, h('b', null, qty(r.quantity), pipeM ? ' м' : ''), pipeM && r.dims?.length ? h('span', { class: 'muted' }, ` · ${qty(Math.floor(r.quantity * 1000 / r.dims.length))} шт`) : null);
      } },
      { key: 'unit', label: 'Ед. изм.', render: unit },
      { key: 'reservedQty', label: 'В брони', sort: 'reservedQty', cls: 'num right', render: (r) => (r.reservedQty ? qty(r.reservedQty) : '') },
      { key: 'free', label: 'Свободно', sort: 'free', cls: 'num right', render: (r) => h('span', { title: r.ordered ? `С учётом заказанного: ${qty(r.free + r.ordered)}` : '' }, qty(r.free)) },
      { key: 'minQuantity', label: 'Мин.', sort: 'minQuantity', cls: 'num right md-hide', render: (r) => (r.minQuantity ? qty(r.minQuantity) : '') },
      { key: 'lastCountedAt', label: 'Пересчёт', sort: 'lastCountedAt', cls: 'md-hide muted', render: (r) => (r.lastCountedAt ? date(r.lastCountedAt) : '') },
      { key: 'status', label: 'Состояние', sort: 'status', render: (r) => h('span', { class: 'nowrap st-cell' },
          r.status === 'none' && r.ordered
            ? h('span', { class: 'badge warn', title: `Нет на складе, в заявках: ${qty(r.ordered)} ${unit(r)}` }, `нет (заказано ${qty(r.ordered)})`)
            : [badge(STOCK_STATUS, r.status), r.ordered ? h('span', { class: 'muted small', title: 'Открытые заявки на позицию' }, `  зак. ${qty(r.ordered)}`) : null],
          r.reservedQty ? h('span', { class: 'tag', title: 'Отложено под заказы. Снять — откройте позицию, кнопка «Снять бронь»' }, `бронь ${qty(r.reservedQty)}`) : null,
          r.hangingQty ? h('span', { class: 'tag tag-hang', title: 'Заказ уже отгружен, закрыт или аннулирован, а материал всё ещё в брони. Откройте позицию, кнопка «Снять бронь»' }, `висит ${qty(r.hangingQty)}`) : null) },
    ],
    card: {
      thumb: photoThumb,
      title: (r) => r.name,
      sub: (r) => [r.categoryName, r.reservedQty ? `бронь ${qty(r.reservedQty)}` : '', r.supplierArticle && `арт. ${r.supplierArticle}`].filter(Boolean).join(' · '),
      side: (r) => [h('b', { class: 'num' }, `${qty(r.quantity)} ${unit(r)}`), r.status === 'none' && r.ordered ? h('span', { class: 'badge warn' }, `нет (заказано ${qty(r.ordered)})`) : badge(STOCK_STATUS, r.status)],
    },
  },

  card: {
    gallery: (r) => r.photos || [],
    photoMain: (r, photoId) => api(`/stock/items/${r.id}/photos/${photoId}/main`, { method: 'PUT' }),
    // СКФ.5: фото в карточке — только просмотр; добавить / убрать — в «Изменить» (раньше было в двух местах)
    heading: (r) => r.name,
    subheading: (r) => [r.categoryName, r.supplierArticle && `арт. ${r.supplierArticle}`].filter(Boolean).join(' · '),
    stats: (r) => [['Остаток', `${qty(r.quantity)} ${unit(r)}`], ['В брони', qty(r.reservedQty)], ['Свободно', qty(r.free)]],
    view: (r) => [
      grp('Остаток'),
      ['Состояние', badge(STOCK_STATUS, r.status)],
      ['Мин. остаток', r.minQuantity ? `${qty(r.minQuantity)} ${unit(r)}` : ''],
      ['Пересчитано', r.lastCountedAt ? date(r.lastCountedAt) : 'ещё не пересчитывали'],
      grp('Названия'),
      ['Короткое', r.name],
      ['Длинное (документы)', r.fullName && r.fullName !== r.name ? r.fullName : null], // совпадает с коротким — не повторяем
      ['В счёте', r.invoiceName && r.invoiceName !== r.name ? r.invoiceName : null],
      grp('Позиция'),
      ['Категория', r.categoryName],
      ...metalView(r),
      ['Ед. изм.', r.unit],
      // АР.1: артикул поставщика и внутренний код — раздельно; СКЛ-… — не артикул
      ['Артикул (поставщика)', r.supplierArticle ? h('span', null, r.supplierArticle, r.articleSource ? h('span', { class: 'muted' }, ` · из: ${r.articleSource}`) : null) : h('span', { class: 'muted' }, 'нет — впишите из счёта или заявки')],
      ['Внутр. код', r.internalCode ? h('span', { class: 'muted' }, r.internalCode) : ''],
      ['Вес 1 шт.', r.weightG ? `${qty(r.weightG)} г` : ''],
      grp('Дополнительно'),
      ['Примечание', r.notes],
    ],
    actions: (r) => [
      r.reservedQty > 0 && { label: 'Выдать из брони', primary: true, title: 'Количество и объект — из брони', run: (row) => { openStockOp('fromres', row.id); return false; } },
      // все действия — в правой панели «Склад» (SK-9): закрыли панель — вернулись к этой позиции
      { label: '+ Принять', primary: !(r.reservedQty > 0), run: (row) => { openStockOp('in', row.id); return false; } },
      { label: '− Выдать', title: 'Кому и под что выдано — в правой панели', run: (row) => { openStockOp('out', row.id); return false; } },
      { label: 'Списать (брак, потеря)', more: true, title: 'Причина из списка', run: (row) => { openStockOp('writeoff', row.id); return false; } },
      { label: 'Забронировать под заказ', more: r.reservedQty > 0, run: (row) => { openStockOp('reserve', row.id); return false; } },
      r.reservedQty > 0 && { label: 'Снять бронь', more: true, run: (row) => { openStockOp('unreserve', row.id); return false; } },
      { label: 'Пересчитать (сколько лежит)', more: true, run: (row) => { openStockOp('count', row.id); return false; } },
      r.metal && !r.offcutOf && { label: 'Отложить обрезок…', more: true, run: (row, ctx) => offcutDialog(row, ctx) },
      { label: 'Заказать (новая заявка)', more: true, run: (row) => orderItem(row) },
      qrPrintAction('S'),
    ],
    // «Заказано», «Поставщики и цены» (ЗП.1, ЗП.5), затем последние движения
    zones: { extra: 'side' }, // УПР-3: заказано, паспорт и движения — боковой колонкой
    extra: (r) => stack(orderedBlock(r), passportSpecView(r), recentMoves(r)),
  },

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
      return { unit: 'шт', photos: [], name: fromReq.name || fromCat.name || '', article: fromCat.article || '' };
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
      return { ...b, ...metalBody(v, { wasKind }) };
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
      // Название уже записано — сбой паспорта/фото не должен выглядеть как «ничего не сохранилось».
      try { await savePassportSpec(id, passportSpec); }
      catch (e) { toast(`Название сохранено. Блок «Для паспорта» не записался: ${errText(e)}. Откройте карточку снова.`, { error: true }); }
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

  searchRow: (r) => ({ title: r.name, sub: [r.categoryName, `${qty(r.quantity)} ${unit(r)}`].filter(Boolean).join(' · '), side: badge(STOCK_STATUS, r.status) }),
  open: (id) => go('stock', { open: id }),
};

