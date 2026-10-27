import { api, session } from '../core/api.js';
import { normSearch } from '../core/facets.js';
import { h } from '../core/dom.js';
import { stepFunnel } from '../ui/step-funnel.js';
import { date, isoDay, money, qty } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { stockLookup } from '../core/stock-list.js';
import { badge, COST_CENTER, PRIORITY, SUPPLY_STATUS, supplyKey } from '../ui/badges.js';
import { modal } from '../ui/dialog.js';
import { quickAdd } from '../ui/quick.js';
import { toast } from '../ui/toast.js';
import { lookups, UNITS, unitList } from './lookups.js';
import { pic } from './stock.js';
import { dictNames } from '../ui/dict-options.js';
import { joinRef, orderOptions, splitRef } from './salesorders.js';

/** Раздел «Заявки» (PRODUCT §1) — коллекция supplyrequests через /api/supply. */
/** «+ Новый заказчик «…»» и «Заказчик: X · Объект: Y» под списком поля «Заказчик» (TASKS ЗЧ.2). */
function customerActions(text, shown, form) {
  if (!text) return [];
  const known = (lk) => shown.some((o) => String(o.label).toLowerCase() === lk.toLowerCase());
  const create = async (name) => { if (!known(name)) { await api('/partners', { method: 'POST', body: { kind: 'customer', name } }).catch((e) => { if (e.status !== 409) throw e; }); form.add(name); lookups.reset?.(); } };
  const acts = [];
  const i = text.indexOf(',');
  if (i > 0 && text.slice(i + 1).trim()) {
    const x = text.slice(0, i).trim(), y = text.slice(i + 1).trim();
    acts.push({ label: `Заказчик: «${x}» · Объект: «${y}» — разнести по полям`, run: async () => { await create(x); form.set('orderLabel', x); form.set('costObject', y); } });
  } else if (!known(text)) {
    acts.push({ label: `+ Новый заказчик «${text}»`, run: async () => { await create(text); form.set('orderLabel', text); toast(`Заказчик «${text}» добавлен в «Контрагенты»`); } });
  }
  return acts;
}

export const STATUS_ORDER = ['in_progress', 'requested', 'ordered', 'paid', 'received', 'cancelled'];
const statusOptions = () => STATUS_ORDER.map((k) => ({ value: k, label: SUPPLY_STATUS[k].label }));
export const NEXT = { in_progress: 'requested', requested: 'ordered', ordered: 'paid' };

export const name = (r) => r.title || r.materialName || '—';
export const heading = (r) => (r.num ? `№${r.num} · ` : '') + name(r);

/** Сменить статус (без окна). Возвращает обновлённую заявку. */
export function patchStatus(r, key) {
  return api(`/supply/requests/${r.id}`, { method: 'PATCH', body: { statusLabel: SUPPLY_STATUS[key].label } });
}
async function setStatus(r, key, ctx) {
  const saved = await patchStatus(r, key);
  toast(`Статус: ${SUPPLY_STATUS[key].label}`, { undo: async () => ctx.setRow(await patchStatus(saved, supplyKey(r))) });
  ctx.setRow(saved);
}

/** Окно «Принять» (2026-10-20): сколько пришло, куда пошло (Цех / Офис / СМР / Под заказ) и ставить ли на склад.
 *  Без склада — заявка «Получено» с отметкой, куда ушло (сразу в работу, в офис, на объект): в воздухе ничего не остаётся. */
export async function receiveDialog(r) {
  const left = h('input', { name: 'qty', inputmode: 'decimal', value: String(r.qty ?? '') });
  let cc = r.costCenter || (r.salesOrderId ? 'order' : 'workshop');
  const obj = h('input', { maxlength: 200, value: r.costObject || '', placeholder: 'объект / адрес' });
  const objWrap = h('label', { class: 'field' }, h('span', null, 'Объект СМР'), obj);
  const stock = h('input', { type: 'checkbox' });
  const stockHint = h('span', { class: 'hint' });
  const sync = () => {
    objWrap.hidden = cc !== 'smr';
    stockHint.textContent = stock.checked ? 'Остаток на складе увеличится.' : 'На склад не ставится — сразу в работу / туда, куда выбрали. Заявка станет «Получено».';
  };
  const setCc = (k, auto = true) => { cc = k; seg.querySelectorAll('.fseg-btn').forEach((b) => b.classList.toggle('on', b.dataset.v === k)); if (auto) stock.checked = k === 'workshop' || k === 'order'; sync(); };
  const seg = h('div', { class: 'fseg' }, ...Object.entries(COST_CENTER).map(([k, l]) => h('button', { type: 'button', class: 'fseg-btn', 'data-v': k, onclick: () => setCc(k) }, l)));
  setCc(cc);
  stock.addEventListener('change', sync);
  const saved = await modal({
    title: 'Принять: ' + name(r),
    body: h('div', null,
      h('label', { class: 'field' }, h('span', null, `Сколько пришло${r.unit ? ', ' + r.unit : ''}`), left),
      h('div', { class: 'field' }, h('span', null, 'Куда пошло'), seg),
      objWrap,
      h('label', { class: 'check' }, stock, ' Поставить на склад'), stockHint,
      r.materialName || !stock.checked ? null : h('p', { class: 'hint' }, 'Такой позиции на складе нет — она будет создана.')),
    okText: 'Принять',
    onOk: async () => {
      const n = Number(String(left.value).replace(',', '.').replace(/\s/g, ''));
      if (!(n > 0)) throw new Error('Укажите количество больше нуля');
      return api(`/supply/requests/${r.id}/receive`, { method: 'POST', body: { qty: n, toStock: stock.checked, costCenter: cc, ...(cc === 'smr' && obj.value.trim() ? { costObject: obj.value.trim() } : {}) } });
    },
  });
  if (saved) toast(saved.receivedTo === 'direct' ? `Получено — ${COST_CENTER[cc]}, без склада` : 'Принято на склад');
  return saved;
}
async function receive(r, ctx) { const saved = await receiveDialog(r); if (saved) ctx.setRow(saved); }

async function changeStatus(r, ctx) {
  const sel = h('select', { name: 'status', value: supplyKey(r) }, statusOptions().map((o) => h('option', { value: o.value }, o.label)));
  const key = await modal({
    title: 'Сменить статус', okText: 'Сохранить',
    body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Статус'), sel),
      h('p', { class: 'hint' }, '«Получено» — откроется приём на склад: товар обязательно приходует, ничего не теряется.')),
    onOk: async () => sel.value,
  });
  if (key === 'received' && supplyKey(r) !== 'received') { await receive(r, ctx); return; }
  if (key && key !== supplyKey(r)) await setStatus(r, key, ctx);
}

/** Ранее заказанное + склад для подсказок в новой заявке (З.7): одно наименование — одна строка. */
export async function pastItems() {
  const [reqs, stockRes] = await Promise.all([
    api('/supply/requests', { query: { limit: 2000, sort: '-requestDate' } }).catch(() => ({ items: [] })),
    stockLookup().catch(() => []), // короткий список склада (/stock/lookup, SK-8d) — общий кэш (core/stock-list.js); pastItems зовут по действию
  ]);
  const by = new Map();
  const key = (s) => normSearch(s);
  for (const it of stockRes) {
    by.set(key(it.name), { label: it.name, cat: it.categoryName || '', stock: it, values: { title: it.invoiceName || it.name, unit: it.unit, categoryName: it.categoryName, article: it.article } }); // Н-1: «в счёте», если есть, иначе короткое
  }
  for (const r of reqs.items) {
    if (!r.title) continue;
    const k = key(r.title);
    const x = by.get(k) || { label: r.title, cat: r.categoryName || '', values: { title: r.title } };
    if (!x.last) {
      x.last = r;
      x.values = { ...x.values, unit: x.values.unit || r.unit, categoryName: x.values.categoryName || r.categoryName, supplierName: r.supplierName, article: x.values.article || r.article };
      if (!x.cat) x.cat = r.categoryName || '';
    }
    x.n = (x.n || 0) + 1;
    by.set(k, x);
  }
  return [...by.values()].map((x) => ({
    ...x,
    search: normSearch([x.label, x.cat, x.values.article, x.last?.supplierName].filter(Boolean).join(' ')),
    sub: [x.cat, x.stock ? `на складе ${qty(x.stock.quantity)} ${x.stock.unit || ''}` : null,
      x.last ? `заказывали ${x.n} раз, последний — ${date(x.last.requestDate)}${x.last.supplierName ? ' у ' + x.last.supplierName : ''}${x.last.priceHint ? ` за ${money(x.last.priceHint)} (${qty(x.last.qty)} ${x.last.unit || ''})` : ''}` : null].filter(Boolean).join(' · '),
  }));
}

const fields = async (r) => {
  const lk = await lookups();
  return [
    { section: 'Что заказать', tone: 'main', fixed: true },
    r ? null : { key: '_pick', type: 'pick', load: pastItems, target: 'title' },
    { key: 'title', label: 'Наименование', required: true, max: 500, suggest: r ? undefined : pastItems, suggestTitle: 'Уже заказывали / есть на складе — выберите, чтобы не завести дубль', hint: r ? undefined : 'Начните печатать — появятся ранее заказанные позиции', span: 3 },
    { key: 'article', label: 'Артикул', max: 100, span: 1 },
    { key: 'qty', label: 'Количество', type: 'number', required: true, min: 0, span: 1 },
    { key: 'unit', label: 'Ед. изм.', type: 'combo', options: unitList(lk), max: 30, span: 1 },
    { key: 'priority', label: 'Приоритет', type: 'segment', required: true, options: Object.entries(PRIORITY).map(([value, p]) => ({ value, label: p.label, tone: value === 'urgent' ? 'danger' : value === 'low' ? 'dim' : '' })) },
    { section: 'Детали товара', tone: 'info', collapsed: true },
    { key: 'categoryName', label: 'Категория', type: 'combo', options: lk.categories.map((c) => c.name), max: 100 },
    { key: 'color', label: 'Цвет', type: 'combo', max: 100, load: dictNames('colors') },
    { key: 'productUrl', label: 'Ссылка на товар', max: 1000, placeholder: 'https://…', wide: true },
    { key: 'deliveryNote', label: 'Доставка', max: 300, wide: true },
    { key: 'photos', label: 'Фото', type: 'photos', hint: 'Своё фото заявки показывается вместо фото позиции склада' },
    { key: 'notes', label: 'Примечание', type: 'textarea', wide: true },
    { section: 'Поставщик и счёт', tone: 'money' },
    // «Получено» — только через «Принять» (приход на склад), в форме его не выбрать
    { key: 'status', label: 'Статус', type: 'select', required: true, options: statusOptions().filter((o) => o.value !== 'received' || (r && supplyKey(r) === 'received')), hint: r && supplyKey(r) === 'received' ? undefined : 'Пришло — кнопка «Принять»: товар встанет на склад' },
    { key: 'supplierName', label: 'Поставщик', type: 'combo', options: lk.suppliers, max: 200 },
    { key: 'priceHint', money: true, label: 'Сумма с НДС, ₽', type: 'money', min: 0, hint: 'Сумма по строке, не цена за штуку' },
    { key: 'companyName', label: 'Наша компания', type: 'select', options: lk.companies, hint: 'Нужна для платёжного календаря' },
    { key: 'invoiceType', label: 'Тип счёта', type: 'combo', options: lk.invoiceTypes || [], max: 60 },
    { key: 'invoiceNo', label: '№ счёта', max: 100, span: 1 },
    { key: 'invoiceDate', label: 'Дата счёта', type: 'date', hint: 'День расхода в календаре', span: 1 },
    { section: 'Для кого', tone: 'who' },
    { key: 'costCenter', label: 'Куда (направление затрат)', type: 'select', options: Object.entries(COST_CENTER).map(([value, label]) => ({ value, label })), hint: 'Для «Денег»: сколько ушло на цех, офис, СМР, заказы' },
    { key: 'costObject', label: 'Объект СМР / уточнение', max: 200 },
    { key: 'salesOrderRef', label: 'Под заказ (позиция)', type: 'select', options: await orderOptions(r ? joinRef(r) : '').catch(() => []), hint: 'Заявка появится в карточке заказа', wide: true },
    // ЗЧ.2: заказчик — из «Контрагентов» (один список); новый — явным «+ Новый заказчик «…»»; «X, Y» — разнести на заказчика и объект
    { key: 'orderLabel', label: 'Заказчик', type: 'combo', options: lk.customers || [], max: 300, wide: true, strict: true,
      strictText: 'Выберите заказчика из списка или нажмите «+ Новый заказчик «…»» в списке. Участок / объект — в поле «Объект СМР / уточнение»',
      hint: 'Из «Контрагентов». Участок, объект — в «Объект СМР / уточнение»', extra: customerActions },
    { key: 'requestedBy', label: 'Кто подал', type: 'combo', options: lk.requestedBy, max: 200 },
    { key: 'requestDate', label: 'Дата заявки', type: 'date' },
  ];
};

const toInitial = (r) => ({ ...r, photos: r.photos || [], salesOrderRef: joinRef(r), status: supplyKey(r), priority: r.priority || 'normal', requestDate: r.requestDate ? isoDay(r.requestDate) : '', invoiceDate: r.invoiceDate ? String(r.invoiceDate).slice(0, 10) : '' });

export const requests = {
  id: 'requests',
  title: 'Заявки',
  newTitle: 'Новая заявка',
  entityType: 'SupplyRequest',
  historyLabels: { 'supply.request.created': 'Создана', 'supply.request.updated': 'Изменена', 'supply.request.deleted': 'Удалена', 'supply.request.restored': 'Восстановлена', 'supply.request.received': 'Оприходована', 'supply.request.photo.added': 'Добавлено фото', 'supply.request.photo.removed': 'Убрано фото' },
  get: (id) => api(`/supply/requests/${id}`),

  list: {
    path: '/supply/requests',
    export: 'admin',
    sortDefault: '-requestDate',
    createLabel: 'Заявка',
    // «+ Счёт» — внести уже оплаченный/полученный счёт с позициями одним окном (TASKS В.3)
    headActions: () => [
      h('button', { class: 'btn', type: 'button', title: 'Скопировать строки из Excel / корзины сайта — заявки на все позиции сразу', onclick: () => patch({ of: 'pasteorder', new: '1', open: undefined }) }, '+ Из таблицы'),
      h('button', { class: 'btn', type: 'button', title: 'Счёт, которого не было в заявках: все позиции сразу', onclick: () => patch({ of: 'invoice', new: '1', open: undefined }) }, '+ Счёт')],
    searchPlaceholder: 'Поиск: наименование, №, поставщик, заказ…',
    sidebar: true,
    chipsTop: true, // статусы — строкой над списком
    toolbarExtra: () => stepFunnel({
      steps: [{ key: 'supplierId', label: 'Поставщик' }, { key: 'categoryId', label: 'Категория' }, { key: 'requestedBy', label: 'Кто подал' }],
      load: async (P) => {
        const keys = ['status', 'supplierId', 'categoryId', 'requestedBy', 'from', 'to', 'needsFill'];
        const r = await api('/supply/requests', { query: { facets: 1, limit: 1, ...(P.q ? { search: P.q } : {}), ...Object.fromEntries(keys.filter((k) => P[k]).map((k) => [k, P[k]])) } });
        return r.facets || {};
      },
    }),
    emptyText: 'Заявок пока нет.',
    filters: [
      { key: 'status', label: 'Статус', type: 'chips', options: statusOptions, count: (resp, v) => (v === '' ? resp.counts?.all : resp.counts?.[v]) ?? undefined },
      // Б4: поставщик / категория / кто подал — воронкой в левой панели (числа при уже выбранном); здесь — для «Сбросить всё»
      { key: 'supplierId', label: 'Поставщик', type: 'hidden' },
      { key: 'categoryId', label: 'Категория', type: 'hidden' },
      { key: 'requestedBy', label: 'Кто подал', type: 'hidden' },
      { key: 'from', label: 'С даты', short: 'с', type: 'date' },
      { key: 'to', label: 'По дату', short: 'по', type: 'date' },
      { key: 'needsFill', type: 'hidden' },
    ],
    banner: (P) => (P.needsFill ? { text: 'Показаны заявки, которые не попадают в выплаты: нет суммы, даты счёта или нашей компании. Откройте и допишите.', keys: ['needsFill'] } : null),
    columns: [
      { key: 'pic', label: '', cls: 'pic-cell', render: (r) => pic(r.photo) },
      { key: 'num', label: '№', sort: 'num', cls: 'num', render: (r) => r.num ?? '' },
      { key: 'requestDate', label: 'Дата', sort: 'requestDate', cls: 'num', render: (r) => date(r.requestDate || r.createdAt) },
      { key: 'title', label: 'Наименование', sort: 'title', cls: 'clip', render: (r) => h('span', { title: name(r) }, name(r)) },
      { key: 'qty', label: 'Кол-во', sort: 'qty', cls: 'num right', render: (r) => `${qty(r.qty)} ${r.unit || ''}`.trim() },
      { key: 'supplierName', label: 'Поставщик', cls: 'md-hide', render: (r) => r.supplierName || '' },
      { key: 'requestedBy', label: 'Кто подал', sort: 'requestedBy', cls: 'nowrap md-hide', render: (r) => r.requestedBy || '' },
      { key: 'priceHint', money: true, label: 'Сумма', sort: 'priceHint', cls: 'num right', render: (r) => money(r.priceHint) },
      { key: 'status', label: 'Статус', sort: 'status', cls: 'nowrap', render: (r) => h('span', null, badge(SUPPLY_STATUS, supplyKey(r)), r.priority === 'urgent' ? h('span', null, ' ', badge(PRIORITY, 'urgent')) : null) },
    ],
    card: {
      title: heading,
      sub: (r) => [`${qty(r.qty)} ${r.unit || ''}`.trim(), r.supplierName, r.requestedBy, date(r.requestDate)].filter(Boolean).join(' · '),
      side: (r) => [badge(SUPPLY_STATUS, supplyKey(r)), r.priceHint && session.canMoney ? h('span', { class: 'num small' }, money(r.priceHint)) : null],
    },
    footer: (resp) => (session.canMoney ? h('span', { class: 'sum-line', title: 'Сумма всех заявок в списке — с учётом вкладки, поиска и фильтров, по всем страницам' }, `Итого по списку: ${money(resp.sum || 0)} · ${qty(resp.total)} заявок`) : null),
    // Завершённое копится — сворачивается по месяцам получения/отмены (TASKS фаза М)
    periods: (P) => (['received', 'cancelled'].includes(P.status) ? { date: (r) => r.receivedAt || r.requestDate || r.updatedAt, total: session.canMoney ? (rs) => money(rs.reduce((s, r) => s + (Number(r.priceHint) || 0), 0)) : undefined } : null),
    hints: {
      '': 'Все заявки. Кнопка в строке — следующий шаг: «В заказ» → «Заказано» → «Оплачено» → «Принять» на склад.',
      in_progress: 'Ждут решения: заказывать («В заказ») или отменить в карточке.',
      requested: 'Нужно заказать у поставщика. Оформили — «Заказано».',
      ordered: 'Заказано, ждём счёт и оплату. Оплатили — «Оплачено» (впишите № и дату счёта в карточке).',
      paid: 'Оплачено, ждём поставку. Пришло — «Принять»: товар встанет на склад.',
      received: 'Получено и оприходовано на склад. Делать ничего не нужно.',
      cancelled: 'Отменённые заявки — в расчёты не идут.',
    },
    rowAction: (r) => {
      const k = supplyKey(r);
      if (k === 'paid' || (k === 'ordered' && r.paid)) return { label: 'Принять', title: 'Оприходовать на склад', run: async (row) => !!(await receiveDialog(row)) };
      const to = NEXT[k];
      if (!to) return null;
      const label = { requested: 'В заказ', ordered: 'Заказано', paid: 'Оплачено' }[to];
      return { label, title: 'Статус → «' + SUPPLY_STATUS[to].label + '»', run: async (row) => {
        await patchStatus(row, to);
        toast(`${heading(row)} → ${SUPPLY_STATUS[to].label}`, { undo: async () => { await patchStatus(row, k); window.dispatchEvent(new Event('data-changed')); } });
      } };
    },
    board: {
      columns: STATUS_ORDER.map((k) => ({ key: k, label: SUPPLY_STATUS[k].label, tone: SUPPLY_STATUS[k].tone, query: { status: k, sort: '-requestDate' } })),
      card: (r) => ({
        pic: r.photo,
        title: heading(r),
        meta: [`${qty(r.qty)} ${r.unit || ''}`.trim(), r.supplierName, r.priority === 'urgent' ? badge(PRIORITY, 'urgent') : null].filter(Boolean).map((x) => (typeof x === 'string' ? h('span', null, x) : x)),
        side: r.priceHint && session.canMoney ? money(r.priceHint) : '',
      }),
      /** Перетаскивание в колонку: «Получено» — через оприходование на склад, остальное — смена статуса. */
      move: async (r, to) => {
        if (to === 'received') return !!(await receiveDialog(r));
        await api(`/supply/requests/${r.id}`, { method: 'PATCH', body: { statusLabel: SUPPLY_STATUS[to].label } });
        toast(`«${name(r)}» → ${SUPPLY_STATUS[to].label}`);
        return true;
      },
    },
  },

  card: {
    // Свои фото заявки; нет своих — фото позиции склада (его меняют в карточке склада)
    gallery: (r) => (r.photos?.length ? r.photos : r.materialPhoto ? [r.materialPhoto] : []),
    photoAdd: (r, photoId) => api(`/supply/requests/${r.id}/photos`, { method: 'POST', body: { photoId } }),
    photoRemove: (r, photoId) => {
      if (!photoId) throw new Error('Это фото позиции склада — поменять его можно в карточке склада');
      return api(`/supply/requests/${r.id}/photos/${photoId}`, { method: 'DELETE' });
    },
    heading,
    subheading: (r) => [date(r.requestDate || r.createdAt), r.requestedBy && `подал(а): ${r.requestedBy}`].filter(Boolean).join(' · '),
    view: (r) => [
      ['Статус', h('span', null, badge(SUPPLY_STATUS, supplyKey(r)), ' ', r.priority && r.priority !== 'normal' ? badge(PRIORITY, r.priority) : '')],
      ['Количество', `${qty(r.qty)} ${r.unit || ''}`.trim()],
      ['Сумма с НДС', session.canMoney && r.priceHint ? money(r.priceHint) : ''],
      ['В каталоге сейчас', session.canMoney && r.catalogCurrentPrice != null
        ? h('span', { class: 'hint', title: 'Текущая цена в каталоге поставщика — заявка не меняется' },
            money(r.catalogCurrentPrice) + ' ₽',
            r.catalogPriceHistory?.length > 1
              ? h('details', { class: 'price-history', style: 'display:inline-block;margin-left:.5rem' },
                  h('summary', { style: 'cursor:pointer;font-size:.85em;color:var(--muted)' }, 'история'),
                  h('table', { class: 'small', style: 'margin-top:.25rem;border-collapse:collapse' },
                    ...r.catalogPriceHistory.map((e) =>
                      h('tr', null,
                        h('td', { style: 'padding:.1rem .4rem .1rem 0;color:var(--muted);white-space:nowrap' }, date(e.date)),
                        h('td', { style: 'padding:.1rem .4rem;text-align:right' }, money(e.price) + ' ₽'),
                        h('td', { style: 'padding:.1rem 0;color:var(--muted);font-size:.85em' }, e.source === 'excel' ? 'Excel' : 'заявка'),
                      )
                    )
                  )
                )
              : null
          )
        : ''],
      ['Куда', [COST_CENTER[r.costCenter] || (r.salesOrderId ? COST_CENTER.order : ''), r.costObject].filter(Boolean).join(' · ')],
      ['Получено', r.status === 'received' ? (r.receivedTo === 'direct' ? 'без склада — сразу в работу / по назначению' : 'на склад') : ''],
      ['Поставщик', r.supplierName],
      ['Категория', r.categoryName],
      ['Заказ / заказчик', r.orderLabel],
      ['Наша компания', r.companyName],
      ['Тип счёта', r.invoiceType],
      ['№ счёта', r.invoiceNo],
      ['Дата счёта', r.invoiceDate ? date(r.invoiceDate) : ''],
      ['Артикул', r.article],
      ['Цвет', r.color],
      ['Доставка', r.deliveryNote],
      ['Ссылка', r.productUrl ? h('a', { href: r.productUrl, target: '_blank', rel: 'noopener' }, 'открыть') : ''],
      ['Примечание', r.notes],
      ['Короткое (склад)', r.materialId && r.materialName && r.materialName !== r.title ? r.materialName : ''],
      ['Позиция склада', r.materialId ? h('a', { href: '#stock?open=' + r.materialId }, r.materialName || 'открыть') : ''],
      ['Оприходовано', r.status === 'received' && r.receivedQty ? qty(r.receivedQty) : ''],
    ],
    actions: (r) => {
      const k = supplyKey(r);
      return [
        !['received', 'cancelled'].includes(k) && { label: 'Оприходовать на склад', primary: true, run: receive },
        NEXT[k] && { label: '→ ' + SUPPLY_STATUS[NEXT[k]].label, run: (row, ctx) => setStatus(row, NEXT[k], ctx) },
        { label: 'Сменить статус…', run: changeStatus },
      ];
    },
  },

  form: {
    fields: () => fields(),
    initial: () => ({ qty: 1, unit: 'шт', status: 'requested', priority: 'normal', requestedBy: session.name, requestDate: isoDay() }),
    toInitial,
    toBody: (v) => {
      const s = (x) => (x === null ? '' : String(x));
      const body = {
        title: s(v.title), qty: v.qty ?? 1, unit: s(v.unit), categoryName: s(v.categoryName), supplierName: s(v.supplierName),
        companyName: s(v.companyName), orderLabel: s(v.orderLabel), requestedBy: s(v.requestedBy), article: s(v.article), color: s(v.color),
        productUrl: s(v.productUrl), invoiceType: s(v.invoiceType), invoiceNo: s(v.invoiceNo), deliveryNote: s(v.deliveryNote), notes: s(v.notes),
        statusLabel: SUPPLY_STATUS[v.status]?.label, priorityLabel: PRIORITY[v.priority]?.label,
        photoIds: v.photos || [],
      };
      body.priceHint = v.priceHint; // пусто — null: сумму можно стереть (В.7)
      if (v.requestDate) body.requestDate = v.requestDate;
      body.costCenter = v.costCenter || ''; body.costObject = v.costObject || '';
      body.invoiceDate = v.invoiceDate || '';
      Object.assign(body, splitRef(v.salesOrderRef));
      if (body.salesOrderId && !v.orderLabel) delete body.orderLabel; // подпись заказа поставит сервер
      return body;
    },
    create: async (body) => { const r = await api('/supply/requests', { method: 'POST', body }); lookups.reset(); return r; },
    update: async (id, body) => { const r = await api(`/supply/requests/${id}`, { method: 'PATCH', body }); lookups.reset(); return r; },
  },

  /** Быстрая заявка одной строкой над списком (и на «Главной»). */
  quick: (after) => quickAdd({
    placeholder: 'Быстрая заявка: что нужно заказать?  (Enter — добавить)',
    unitOptions: UNITS,
    create: (v) => api('/supply/requests', { method: 'POST', body: { title: v.title, qty: v.qty, unit: v.unit, statusLabel: SUPPLY_STATUS.requested.label, requestedBy: session.name } }),
    after: (row) => { lookups.reset(); toast(`Заявка №${row.num} добавлена в «Заказать»`); after?.(row); },
  }),

  duplicate: (r) => ({ ...toInitial(r), status: 'requested', requestDate: isoDay(), requestedBy: session.name, invoiceNo: '', invoiceDate: '', num: undefined }),

  remove: { password: true,
    text: (r) => `Удалить заявку ${heading(r)}?` + (r.status === 'received' ? ' Приход на склад по ней останется — при необходимости отмените его в «Движениях».' : ''),
    run: (r) => api(`/supply/requests/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/supply/requests/${r.id}/restore`, { method: 'POST' }),
  },

  /** Для поиска по всему и корзины. */
  searchRow: (r) => ({ title: heading(r), sub: [r.supplierName, date(r.requestDate)].filter(Boolean).join(' · '), side: badge(SUPPLY_STATUS, supplyKey(r)) }),
  open: (id) => go('requests', { open: id }),
};
