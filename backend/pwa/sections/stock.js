import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { busyBtn, failBlock } from '../ui/busy.js';
import { date, qty } from '../core/format.js';
import { go } from '../core/router.js';
import { badge, STOCK_STATUS } from '../ui/badges.js';
import { toast, toastError } from '../ui/toast.js';
import { lookups, UNITS, unitList } from './lookups.js';
import { facetFilter, ftParams, ftQuery } from '../ui/facet-filter.js';
import { metalBody, metalFields, metalInitial, metalView, offcutDialog } from './metal.js';
import { orderedBlock, orderItem } from './item-orders.js';
import { weightCount } from '../ui/weight-count.js';
import { errText } from '../ui/errors.js';
import { openStockOp } from './stock-ops.js';
import { targetNote } from '../ui/target-picker.js';
import { mobileStockDashboard } from './warehouse-mobile.js';

/** Раздел «Склад» (PRODUCT §2): materials + storageitems через /api/stock. */
const unit = (r) => r.unit || '';
/** Миниатюра в строке списка (или пустое место того же размера — колонки не прыгают). */
const noPic = () => h('span', { class: 'pic empty', 'aria-hidden': 'true' }, '▢');
export const pic = (p) => (p ? h('img', { class: 'pic', src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy', onerror: (e) => e.target.replaceWith(noPic()) }) : noPic());
const photoThumb = (r) => {
  const p = (r.photos || [])[0];
  return p ? h('img', { class: 'thumb', src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy' }) : null;
};

const HIST = { in: 'Приход', out: 'Списание', adjust: 'Корректировка', count: 'Пересчёт', transfer: 'Перемещение', reserve: 'Бронь', unreserve: 'Снятие брони' };
/** Последние 5 записей истории позиции (GET /stock/items/:id/history?limit=5) и «Вся история» — без ограничения. */
function recentMoves(r) {
  const ul = h('ul', { class: 'timeline' }, h('li', { class: 'muted' }, 'Загрузка…'));
  const more = h('div', { class: 'actions' });
  const show = (res, full) => {
    if (!res.items.length) { ul.replaceChildren(h('li', { class: 'muted' }, 'Движений пока нет')); more.replaceChildren(); return; }
    ul.replaceChildren(...res.items.map((m) => h('li', null,
      h('span', { class: 'when' }, date(m.date)), h('span', null, HIST[m.type] || m.type),
      h('span', { class: 'num ' + (m.type === 'in' ? 'pos' : m.type === 'out' ? 'neg' : '') }, (m.type === 'in' ? '+' : m.type === 'out' ? '−' : '') + qty(m.qty)),
      h('span', { class: 'muted', style: { flex: '1' } }, targetNote(m), targetNote(m) && m.note ? ' · ' : '', m.note || ''))));
    more.replaceChildren(...[
      !full && res.total > res.items.length ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async (e) => {
        const free = busyBtn(e.currentTarget, null);
        try { show(await api(`/stock/items/${r.id}/history`), true); } catch (err) { free(); toastError(err, 'загрузить историю'); }
      } }, `Вся история (${res.total})`) : null,
      h('a', { class: 'btn btn-ghost btn-sm', href: '#movements?materialId=' + r.id, title: 'Журнал движений позиции — там можно отменить ошибочное' }, 'Журнал движений →')].filter(Boolean));
  };
  const loadHist = () => api(`/stock/items/${r.id}/history`, { query: { limit: 5 } }).then((res) => show(res, false)).catch((e) => ul.replaceChildren(h('li', null, failBlock(e, loadHist, { text: 'История не загрузилась' }))));
  loadHist();
  return h('div', null, h('div', { class: 'section-title' }, 'Последние записи'), ul, more);
}

/** Кнопки над списком остатков: «Принять», «Выдать», «Забронировать», «ещё ▾» (Списать, Пересчитать) — всё в правой панели; «Вся история» — журнал. */
// открытое меню «ещё ▾»: закрывается кликом мимо и Esc; слушатели — один раз на модуль, а не на каждую отрисовку
let moreOpen = null;
function closeMore() { if (moreOpen) { moreOpen.menu.hidden = true; moreOpen.more.setAttribute('aria-expanded', 'false'); moreOpen = null; } }
document.addEventListener('click', closeMore);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && moreOpen) { const b = moreOpen.more; closeMore(); b.focus(); e.stopPropagation(); } }, true);
function stockActions() {
  const item = (label, op) => h('button', { type: 'button', role: 'menuitem', onclick: () => { closeMore(); openStockOp(op); } }, label);
  const menu = h('div', { class: 'menu', role: 'menu', hidden: true }, item('Списать', 'writeoff'), item('Пересчитать', 'count'));
  const more = h('button', { class: 'btn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => {
    e.stopPropagation();
    if (!menu.hidden) { closeMore(); return; }
    closeMore(); menu.hidden = false; more.setAttribute('aria-expanded', 'true'); moreOpen = { menu, more };
    menu.querySelector('button')?.focus();
  } }, 'ещё ▾');
  return h('div', { class: 'stock-acts' },
    h('button', { class: 'btn', type: 'button', onclick: () => openStockOp('in') }, 'Принять'),
    h('button', { class: 'btn', type: 'button', onclick: () => openStockOp('out') }, 'Выдать'),
    h('button', { class: 'btn', type: 'button', onclick: () => openStockOp('reserve') }, 'Забронировать'),
    h('div', { class: 'rel' }, more, menu),
    h('a', { class: 'btn btn-ghost', href: '#movements', title: 'Журнал всех приходов, списаний и корректировок' }, 'Журнал движений'));
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
    extraKeys: ['ft'],
    // priority=1: «заканчивается» и «в брони» — сверху (внутри групп — выбранный порядок)
    query: (P) => ({ priority: 1, ...(P.ft ? { search: [P.q, ftQuery(P.ft)].filter(Boolean).join(' ') || undefined, ...ftParams(P.ft) } : {}) }),
    export: 'admin',
    headActions: () => [stockActions()],
    top: (_reload) => mobileStockDashboard(),
    sortDefault: 'name',
    createLabel: 'Новая позиция склада',
    searchPlaceholder: 'Название, размер, стандарт…',
    emptyText: 'На складе пока нет позиций.',
    filters: [
      { key: 'status', label: 'Состояние', type: 'chips',
        options: () => [
          { value: 'low,none', label: 'Требуют внимания' },
          { value: 'low', label: 'Ниже минимума' },
          { value: 'none', label: 'Нет на складе' },
          { value: 'ordered', label: 'Ждут поставку' },
          { value: 'reserved', label: 'В брони' },
          { value: 'ok', label: 'В норме' },
        ],
        count: (resp, v) => v === '' ? resp.counts?.all : v.includes(',') ? v.split(',').reduce((s, k) => s + (resp.counts?.[k] ?? 0), 0) : resp.counts?.[v],
      },
      { key: 'categoryId', label: 'Категория', type: 'hidden' }, // выбирается списком «Категории» в левой панели
    ],
    hints: {
      '': 'Все позиции склада. В строке: «+ Приход», «− Выдать»; если не хватает — «Заказать». Несколько позиций разом, бронь и пересчёт — кнопки сверху: «Принять», «Выдать», «Забронировать», «ещё».',
      low: 'Меньше минимального остатка — пора заказать: кнопка «Заказать» в строке.',
      none: 'Закончилось — закажите, если позиция ещё нужна.',
      ordered: 'Заказано, ждём поставку. Приехало — откройте позицию и нажмите «Принять» у заявки.',
      reserved: 'Отложено под заказы. Выдать — «Из брони» в строке.',
      ok: 'Хватает. Делать ничего не нужно.',
    },
    rowAction: (r) => {
      const order = { label: 'Заказать', title: 'Создать заявку на эту позицию', run: (row) => { orderItem(row); return false; } };
      // ждёт поставку — «Принять»: окно прихода само предложит закрыть заявку (receiveField)
      const inc = r.ordered > 0 ? { label: 'Принять', title: 'Приехала поставка: принять на склад и закрыть заявку', run: (row) => { openStockOp('in', row.id); return false; } } : { label: '+ Приход', title: 'Поступление на склад', run: (row) => { openStockOp('in', row.id); return false; } };
      const out = { label: '− Выдать', title: 'Выдача / расход: кому и под что — в правой панели', run: (row) => { openStockOp('out', row.id); return false; } };
      const fromRes = { label: 'Из брони', title: 'Выдать забронированное: количество и объект — из брони', run: (row) => { openStockOp('fromres', row.id); return false; } };
      const base = r.status === 'none' ? [order, inc] : r.status === 'low' ? [order, inc, out] : [inc, out];
      return r.reservedQty > 0 ? [fromRes, ...base.filter((a) => a !== out || r.free > 0)] : base;
    },
    tiles: {
      key: 'categoryId', title: 'Категории',
      load: async () => (await api('/stock/categories')).items.filter((c) => c.id !== 'none').map((c) => ({
        value: c.id, label: c.name, n: c.total,
        sub: h('span', null, c.low || c.none ? [c.low ? h('span', { class: 'warn' }, `к закупке ${c.low}`) : null, c.low && c.none ? ' · ' : null, c.none ? `нет ${c.none}` : null] : 'всё в норме', c.ordered ? ` · заказано ${c.ordered}` : null),
      })),
    },
    columns: [
      { key: 'pic', label: '', cls: 'pic-cell', render: (r) => pic(r.photos?.[0]) },
      { key: 'name', label: 'Наименование', sort: 'name', cls: 'clip', render: (r) => h('span', { title: r.name }, r.name) },
      { key: 'categoryName', label: 'Категория', sort: 'categoryName', cls: 'md-hide', render: (r) => r.categoryName || '' },
      { key: 'quantity', label: 'Остаток', sort: 'quantity', cls: 'num right', render: (r) => h('b', null, qty(r.quantity)) },
      { key: 'unit', label: 'Ед.', render: unit },
      { key: 'reservedQty', label: 'В брони', sort: 'reservedQty', cls: 'num right', render: (r) => (r.reservedQty ? qty(r.reservedQty) : '') },
      { key: 'free', label: 'Свободно', sort: 'free', cls: 'num right', render: (r) => h('span', { title: r.ordered ? `С учётом заказанного: ${qty(r.free + r.ordered)}` : '' }, qty(r.free)) },
      { key: 'minQuantity', label: 'Мин.', sort: 'minQuantity', cls: 'num right md-hide', render: (r) => (r.minQuantity ? qty(r.minQuantity) : '') },
      { key: 'lastCountedAt', label: 'Пересчёт', sort: 'lastCountedAt', cls: 'md-hide muted', render: (r) => (r.lastCountedAt ? date(r.lastCountedAt) : '') },
      { key: 'status', label: 'Состояние', sort: 'status', render: (r) => h('span', { class: 'nowrap st-cell' },
          r.status === 'none' && r.ordered
            ? h('span', { class: 'badge warn', title: `Нет на складе, в заявках: ${qty(r.ordered)} ${unit(r)}` }, `нет (заказано ${qty(r.ordered)})`)
            : [badge(STOCK_STATUS, r.status), r.ordered ? h('span', { class: 'muted small', title: 'Открытые заявки на позицию' }, `  зак. ${qty(r.ordered)}`) : null],
          r.reservedQty ? h('span', { class: 'tag', title: 'Отложено под заказы — «Из брони» в строке' }, `бронь ${qty(r.reservedQty)}`) : null,
          r.hangingQty ? h('span', { class: 'tag tag-hang', title: 'Заказ уже отгружен, закрыт или аннулирован, а материал всё ещё в брони. Снимите бронь в «Забронировать» → «Активные брони»' }, `висит ${qty(r.hangingQty)}`) : null) },
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
    // СКФ.5: фото в карточке — только просмотр; добавить / убрать — в «Изменить» (раньше было в двух местах)
    heading: (r) => r.name,
    subheading: (r) => [r.categoryName, r.supplierArticle && `арт. ${r.supplierArticle}`].filter(Boolean).join(' · '),
    stats: (r) => [['Остаток', `${qty(r.quantity)} ${unit(r)}`], ['В брони', qty(r.reservedQty)], ['Свободно', qty(r.free)]],
    view: (r) => [
      ['Состояние', badge(STOCK_STATUS, r.status)],
      ['Мин. остаток', r.minQuantity ? `${qty(r.minQuantity)} ${unit(r)}` : ''],
      ['Пересчитано', r.lastCountedAt ? date(r.lastCountedAt) : 'ещё не пересчитывали'],
      ['Полное наименование', r.fullName],
      ['В счёте', r.invoiceName],
      ['Категория', r.categoryName],
      ...metalView(r),
      ['Ед. изм.', r.unit],
      // АР.1: артикул поставщика и внутренний код — раздельно; СКЛ-… — не артикул
      ['Артикул (поставщика)', r.supplierArticle ? h('span', null, r.supplierArticle, r.articleSource ? h('span', { class: 'muted' }, ` · из: ${r.articleSource}`) : null) : h('span', { class: 'muted' }, 'нет — впишите из счёта или заявки')],
      ['Внутр. код', r.internalCode ? h('span', { class: 'muted' }, r.internalCode) : ''],
      ['Вес 1 шт.', r.weightG ? `${qty(r.weightG)} г` : ''],
      ['Примечание', r.notes],
    ],
    actions: (r) => [
      r.reservedQty > 0 && { label: 'Выдать из брони', primary: true, title: 'Количество и объект — из брони', run: (row) => { openStockOp('fromres', row.id); return false; } },
      // все действия — в правой панели «Склад» (SK-9): закрыли панель — вернулись к этой позиции
      { label: '+ Приход', primary: !(r.reservedQty > 0), run: (row) => { openStockOp('in', row.id); return false; } },
      { label: '− Выдать', title: 'Кому и под что выдано — в правой панели', run: (row) => { openStockOp('out', row.id); return false; } },
      { label: 'Списать (брак, потеря)', title: 'Причина из списка', run: (row) => { openStockOp('writeoff', row.id); return false; } },
      { label: 'Забронировать под заказ', run: (row) => { openStockOp('reserve', row.id); return false; } },
      r.reservedQty > 0 && { label: 'Снять бронь', run: (row) => { openStockOp('unreserve', row.id); return false; } },
      { label: 'Пересчитать (сколько лежит)', run: (row) => { openStockOp('count', row.id); return false; } },
      r.metal && !r.offcutOf && { label: 'Отложить обрезок…', run: (row, ctx) => offcutDialog(row, ctx) },
      { label: 'Заказать (новая заявка)', run: (row) => orderItem(row) },
    ],
    // «Заказано», «Поставщики и цены» (ЗП.1, ЗП.5), затем последние движения
    extra: (r) => h('div', null, orderedBlock(r), recentMoves(r)),
  },

  form: {
    fields: async (row) => {
      const lk = await lookups().catch(() => ({ categories: [] }));
      return [
        { section: 'Что за позиция', tone: 'main', fixed: true },
        { key: 'name', label: 'Наименование', required: true, max: 300, span: 3, hint: 'Короткое, как на складе: «Болт мебельный, M8х40, DIN 603»' },
        // ДМ.2: необязательные — полное и «как в счёте» (поиск находит по всем трём)
        { key: 'fullName', label: 'Полное наименование', max: 500, span: 3 },
        { key: 'invoiceName', label: 'Наименование в счёте', max: 500, span: 3, hint: 'Как пишет поставщик — поиск найдёт позицию и по нему' },
        { key: 'article', label: 'Артикул (поставщика)', max: 100, span: 1, hint: 'Из счёта / заявки. Пусто — останется внутренний код' },
        { key: 'categoryName', label: 'Категория', type: 'combo', options: lk.categories.map((c) => c.name), max: 100 },
        { key: 'unit', label: 'Ед. изм.', type: 'combo', required: true, options: unitList(lk), max: 30 },
        // новая позиция — сразу «Начальный остаток»: штуками или по весу (НО.2)
        ...(row ? [] : [{ section: 'Начальный остаток', tone: 'info', fixed: true },
          { key: 'initial', type: 'widget', label: '', wide: true, widget: () => { const q = h('input', { inputmode: 'decimal', placeholder: '0' }); const wc = weightCount({ qtyInput: q, label: 'Сколько лежит' }); return { el: wc.el, get value() { return JSON.stringify(wc.get()); }, set value(_) { /* только ввод */ } }; } }]),
        { key: 'weightG', label: 'Вес 1 шт., г', type: 'number', min: 0, hint: 'Для счёта по весу: штуки = вес партии ÷ вес 1 шт.' },
        ...metalFields(),
        { section: 'Фото и примечание', tone: 'main' },
        { key: 'photos', label: 'Фото', type: 'photos', hint: 'Перетащите, вставьте Ctrl+V или выберите файл' },
        { key: 'notes', label: 'Примечание', type: 'textarea', wide: true },
        // СКФ.5: настройки склада — отдельно от свойств самой позиции
        { section: 'Склад', tone: 'info' },
        { key: 'minQuantity', label: 'Минимальный остаток', type: 'number', min: 0, hint: 'Станет меньше — позиция попадёт в «К закупке»' },
      ];
    },
    initial: () => ({ unit: 'шт', photos: [] }),
    toInitial: (r) => ({ ...r, article: r.supplierArticle || '', ...metalInitial(r), weightG: r.weightG ?? null, photos: r.photos || [] }),
    toBody: (v) => {
      const b = { photoIds: v.photos || [], name: v.name, fullName: v.fullName || '', invoiceName: v.invoiceName || '', unit: v.unit || 'шт', categoryName: v.categoryName || '', notes: v.notes || '' };
      if (v.article) b.article = v.article;
      // пустое поле = стереть значение (В.7): null уходит на сервер, мин. остаток станет 0
      b.minQuantity = v.minQuantity;
      b.weightG = v.weightG; // НО: вес 1 шт. в граммах (сервер хранит кг)
      if (v.initial) b.initial = v.initial;
      return { ...b, ...metalBody(v) };
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
        catch (e) { toast(`Позиция создана, но начальный остаток не записан: ${errText(e)}. Сделайте «+ Приход» в карточке.`, { error: true }); }
      }
      for (const photoId of photoIds || []) {
        try { r = await api(`/stock/items/${r.id}/photos`, { method: 'POST', body: { photoId } }); }
        catch (e) { toast(`Позиция создана, но фото не прикрепилось: ${errText(e)}. Добавьте фото в карточке.`, { error: true }); break; }
      }
      lookups.reset();
      return r;
    },
    update: async (id, body) => {
      const { photoIds, ...rest } = body;
      let r = await api(`/stock/items/${id}`, { method: 'PATCH', body: rest });
      const have = new Set((r.photos || []).map((p) => p.id));
      for (const photoId of photoIds || []) if (!have.has(photoId)) r = await api(`/stock/items/${id}/photos`, { method: 'POST', body: { photoId } });
      for (const p of have) if (photoIds && !photoIds.includes(p)) r = await api(`/stock/items/${id}/photos/${p}`, { method: 'DELETE' });
      lookups.reset(); return r;
    },
  },

  remove: {
    blocked: (r) => (r.quantity > 0 ? `Нельзя удалить: на складе ${qty(r.quantity)} ${unit(r)}. Сначала спишите или сделайте инвентаризацию до 0.`
      : r.reservedQty > 0 ? 'Нельзя удалить: по позиции есть бронь. Сначала снимите её.' : null),
    text: (r) => `Удалить позицию «${r.name}»?`,
    run: (r) => api(`/stock/items/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/stock/items/${r.id}/restore`, { method: 'POST' }),
  },

  searchRow: (r) => ({ title: r.name, sub: [r.categoryName, `${qty(r.quantity)} ${unit(r)}`].filter(Boolean).join(' · '), side: badge(STOCK_STATUS, r.status) }),
  open: (id) => go('stock', { open: id }),
};

