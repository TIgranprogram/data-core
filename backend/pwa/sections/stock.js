import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, parseNum, qty } from '../core/format.js';
import { go } from '../core/router.js';
import { badge, STOCK_STATUS } from '../ui/badges.js';
import { modal } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { lookups, UNITS, unitList } from './lookups.js';
import { facetFilter, ftParams, ftQuery } from '../ui/facet-filter.js';
import { cancelMovement, moveLabel } from './movements.js';
import { issueDialog, issueToFields, withOrders } from './issue.js';
import { metalBody, metalFields, metalInitial, metalView, offcutDialog, pipeInHelper } from './metal.js';
import { orderedBlock, orderItem, receiveField } from './item-orders.js';
import { weightCount } from '../ui/weight-count.js';
import { errText } from '../ui/errors.js';

/** Раздел «Склад» (PRODUCT §2): materials + storageitems через /api/stock. */
const unit = (r) => r.unit || '';
/** Миниатюра в строке списка (или пустое место того же размера — колонки не прыгают). */
const noPic = () => h('span', { class: 'pic empty', 'aria-hidden': 'true' }, '▢');
export const pic = (p) => (p ? h('img', { class: 'pic', src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy', onerror: (e) => e.target.replaceWith(noPic()) }) : noPic());
const photoThumb = (r) => {
  const p = (r.photos || [])[0];
  return p ? h('img', { class: 'thumb', src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy' }) : null;
};

/**
 * «Выдать из брони» (замечание 2026-10-23: «списываю — опять спрашивает количество, хотя в брони оно есть»): брони позиции;
 * одна — сразу окно выдачи с количеством и объектом из брони; несколько — сначала выбрать, какую.
 */
async function issueFromReserve(r, ctx) {
  try {
    const res = await api('/stock/reservations');
    const lines = res.items.flatMap((g) => g.lines.filter((l) => l.materialId === r.id && l.qty > 0).map((l) => ({ id: l.id, name: l.name, unit: l.unit, qty: l.qty, group: g.name })));
    if (!lines.length) { toast('Активной брони у позиции нет'); return; }
    let line = lines[0];
    if (lines.length > 1) {
      const sel = h('select', { 'aria-label': 'Какая бронь' }, lines.map((l, i) => h('option', { value: String(i) }, `${l.group} — ${qty(l.qty)} ${l.unit}`)));
      const k = await modal({ title: `Из какой брони: ${r.name}`, okText: 'Дальше', body: h('label', { class: 'field wide' }, h('span', null, 'Бронь'), sel), onOk: async () => sel.value });
      if (k === null) return;
      line = lines[Number(k)];
    }
    const out = await issueDialog(`Выдать из брони: ${r.name}`, [line], { issuedTo: line.group && line.group !== 'Бронь' ? line.group : '' });
    if (!out) return;
    toast('Выдано из брони');
    ctx.setRow(await api(`/stock/items/${r.id}`));
    window.dispatchEvent(new CustomEvent('data-changed'));
  } catch (e) { toastError(e); }
}

/** Приход / списание / бронь / снятие брони / инвентаризация. */
async function move(r, type, ctx) {
  const inv = type === 'adjust';
  const titles = { in: 'Приход', out: 'Списание', reserve: 'Бронь', unreserve: 'Снять бронь', adjust: 'Инвентаризация' };
  const hints = {
    in: 'Поступление на склад. Остаток увеличится.',
    out: `Выдача в производство / расход — из свободного остатка: ${qty(r.free)} ${unit(r)}.${r.reservedQty ? ` Забронированное (${qty(r.reservedQty)}) выдаётся кнопкой «Выдать из брони».` : ''}`,
    reserve: `Резерв под заказ: остаток не меняется, «свободно» уменьшается. Свободно сейчас: ${qty(r.free)} ${unit(r)}.`,
    unreserve: `Вернуть забронированное в свободный остаток. В брони: ${qty(r.reservedQty)} ${unit(r)}.`,
    adjust: `По учёту ${qty(r.quantity)} ${unit(r)} · в брони ${qty(r.reservedQty)} · свободно ${qty(r.free)}. Бронь физически лежит на складе — считайте её вместе со всем.`,
  };
  const qIn = h('input', { name: 'qty', inputmode: 'decimal', value: type === 'unreserve' ? String(r.reservedQty) : inv ? String(r.quantity) : '' });
  // ФИ.3: значение выделяется при фокусе — дописанные цифры не дают «931931»
  qIn.addEventListener('focus', () => qIn.select());
  // ФИ.2: предпросмотр до сохранения; «Сохранить» неактивна, пока изменений нет
  const preview = inv ? h('p', { class: 'count-preview' }) : null;
  let armed = false; // ФИ.3: опасное (меньше брони, сильно меньше, ноль) — второе нажатие подтверждает
  const okBtn = () => qIn.closest('form')?.querySelector('button[type=submit]');
  const showPreview = () => {
    if (!inv) return;
    armed = false;
    const n = parseNum(qIn.value);
    const b = okBtn(); if (b) b.textContent = 'Сохранить остаток';
    if (n === undefined || Number.isNaN(n)) { preview.className = 'count-preview'; preview.textContent = 'Введите число — сколько лежит всего'; if (b) b.disabled = true; return; }
    const d = Math.round((n - r.quantity) * 1000) / 1000, free = Math.round((n - r.reservedQty) * 1000) / 1000;
    const below = n < r.reservedQty;
    preview.className = 'count-preview' + (below ? ' danger' : d ? ' change' : '');
    preview.textContent = d === 0 ? `По учёту ${qty(r.quantity)} → станет ${qty(n)} (изменений нет)`
      : `Будет корректировка ${d > 0 ? '+' : '−'}${qty(Math.abs(d))}: остаток ${qty(r.quantity)} → ${qty(n)}, свободно станет ${qty(free)}`
        + (below ? `. Меньше, чем в брони (${qty(r.reservedQty)}) — сначала снимите или выдайте бронь` : '');
    if (b) b.disabled = d === 0;
  };
  if (inv) { qIn.addEventListener('input', showPreview); setTimeout(showPreview, 0); }
  const note = h('input', { name: 'note', maxlength: 300, placeholder: type === 'reserve' ? 'Заказ из списка или своё' : type === 'out' ? 'Необязательно' : 'Основание' });
  // бронь — «под какой заказ» выпадающим списком заказов в работе (замечание 2026-10-23); при выдаче объект — в «Кому выдано»
  const noteBox = h('label', { class: 'field' }, h('span', null, type === 'reserve' ? 'Под какой заказ' : 'Примечание'), note);
  if (type === 'reserve') withOrders(note);
  const to = type === 'out' ? issueToFields() : null; // кому выдано (TASKS Л.3)
  const recv = type === 'in' ? receiveField(r) : null; // приход закрывает открытую заявку (ЗП.4)
  // НО.2: приход и пересчёт — штуками или по весу (один компонент); пересчёт по весу — тоже «всего, вместе с бронью» (ФИ)
  const wc = (type === 'in' || inv) && !r.offcutOf ? weightCount({ qtyInput: qIn, unit: unit(r) || 'шт', unitWeightG: r.weightG, label: inv ? 'Сколько лежит на полке всего (вместе с забронированным)' : 'Количество', expectQty: inv ? r.quantity : null }) : null;
  const byW = () => (wc?.mode() === 'w' ? { byWeight: wc.get().byWeight } : {});
  const done = await modal({
    title: `${titles[type]}: ${r.name}`, okText: inv ? 'Сохранить остаток' : 'Провести',
    body: h('div', null, h('p', { class: 'hint' }, hints[type]),
      h('div', { class: 'form-grid' },
        wc ? wc.el : h('label', { class: 'field' + (inv ? ' wide' : '') }, h('span', null, (inv ? 'Сколько лежит на полке всего (вместе с забронированным)' : 'Количество') + (unit(r) ? ', ' + unit(r) : '')), qIn),
        preview,
        type === 'in' ? pipeInHelper(r, qIn) : null, // труба: «10 хлыстов по 6 м» = 60 м (СМ.2)
        recv?.el,
        noteBox, to?.el)),
    onOk: async () => {
      if (wc?.mode() === 'w' && wc.get().errors?.length) throw new Error(wc.get().errors[0]);
      const n = parseNum(qIn.value);
      if (n === undefined || Number.isNaN(n) || n < 0 || (!inv && n === 0)) throw new Error(inv ? 'Введите число не меньше 0' : 'Введите количество больше нуля');
      if (inv) {
        // ФИ.4: на сервер — «сколько лежит», разницу считает сервер; expected — что видел человек (разошлось — 409)
        const delta = Math.round((n - r.quantity) * 1000) / 1000;
        if (delta === 0) return r;
        const below = n < r.reservedQty, drastic = r.quantity > 0 && (n === 0 || Math.abs(delta) / r.quantity > 0.5);
        if ((below || drastic) && !armed) {
          armed = true;
          const b = okBtn(); if (b) b.textContent = below ? 'Да, меньше брони — сохранить' : 'Да, уверен — сохранить';
          throw new Error(below ? `Вы ввели ${qty(n)} — это меньше брони (${qty(r.reservedQty)}): свободно станет ${qty(n - r.reservedQty)}. Проверьте число. Если всё верно — нажмите ещё раз.`
            : `Остаток изменится сильно: ${qty(r.quantity)} → ${qty(n)}. Уверены? Если да — нажмите ещё раз.`);
        }
        return api(`/stock/items/${r.id}/move`, { method: 'POST', body: { type: 'count', qty: n, expected: r.quantity, force: below || undefined, note: note.value.trim() || 'инвентаризация', ...byW() } });
      }
      const req = recv?.value();
      if (req) {
        // пришло меньше заказанного — заявка остаётся открытой на остаток
        await api(`/supply/requests/${req.id}/receive`, { method: 'POST', body: { qty: n, partial: n < req.qty } });
        return api(`/stock/items/${r.id}`);
      }
      return api(`/stock/items/${r.id}/move`, { method: 'POST', body: { type, qty: n, note: note.value.trim() || undefined, ...(to ? to.value() : {}), ...(type === 'in' ? byW() : {}) } });
    },
  });
  if (done) { toast(`${titles[type]}: проведено`); ctx.setRow(done); }
}

function recentMoves(r, ctx) {
  const ul = h('ul', { class: 'timeline' }, h('li', { class: 'muted' }, 'Загрузка…'));
  api('/stock/movements', { query: { materialId: r.id, limit: 10 } }).then((res) => {
    if (!res.items.length) { ul.replaceChildren(h('li', { class: 'muted' }, 'Движений пока нет')); return; }
    ul.replaceChildren(...res.items.map((m) => h('li', null,
      h('span', { class: 'when' }, date(m.date)), h('span', null, moveLabel(m)),
      h('span', { class: 'num ' + (m.delta > 0 ? 'pos' : m.delta < 0 ? 'neg' : '') }, (m.delta > 0 ? '+' : '') + qty(m.delta)),
      m.qtyBefore != null && m.type === 'adjust' ? h('span', { class: 'num muted', title: 'Остаток было → стало' }, `${qty(m.qtyBefore)} → ${qty(m.qtyAfter)}`) : null, // ФИ.5
      h('span', { class: 'muted', style: { flex: '1' } }, m.note || ''),
      m.canCancel ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const it = await cancelMovement(m); if (it) ctx.setRow(it); } }, 'Отменить') : null)));
    if (res.total > res.items.length) ul.append(h('li', null, h('a', { href: '#movements?materialId=' + r.id }, `Все движения (${res.total}) →`)));
  }).catch(() => ul.replaceChildren(h('li', { class: 'muted' }, 'Не удалось загрузить движения')));
  return h('div', null, h('div', { class: 'section-title' }, 'Последние движения'), ul);
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
    // фильтры «тип / резьба / длина / стандарт» — выпадающая панель поверх таблицы; выбранное уходит словами поиска
    toolbarExtra: () => facetFilter({ categoryKey: 'categoryId' }),
    extraKeys: ['ft'],
    query: (P) => (P.ft ? { search: [P.q, ftQuery(P.ft)].filter(Boolean).join(' ') || undefined, ...ftParams(P.ft) } : {}),
    sortDefault: 'name',
    createLabel: 'Новая позиция склада',
    searchPlaceholder: 'Поиск: наименование, артикул…',
    emptyText: 'На складе пока нет позиций.',
    filters: [
      { key: 'status', label: 'Состояние', type: 'chips', options: () => [{ value: 'low', label: 'К закупке' }, { value: 'none', label: 'Нет на складе' }, { value: 'reserved', label: 'В брони' }, { value: 'ok', label: 'В норме' }], count: (resp, v) => (v === '' ? resp.counts?.all : resp.counts?.[v]) },
      { key: 'categoryId', label: 'Категория', type: 'hidden' }, // выбирается плитками над списком
    ],
    hints: {
      '': 'Все позиции склада. В строке: «+ Приход», «− Списать»; если не хватает — «Заказать». Несколько позиций разом и пересчёт полки — раздел «Операции».',
      low: 'Меньше минимального остатка — пора заказать: кнопка «Заказать» в строке.',
      none: 'Закончилось — закажите, если позиция ещё нужна.',
      reserved: 'Отложено под заказы. Выдать — «Из брони» в строке.',
      ok: 'Хватает. Делать ничего не нужно.',
    },
    rowAction: (r) => {
      const silent = { setRow: () => {} };
      const order = { label: 'Заказать', title: 'Создать заявку на эту позицию', run: (row) => { orderItem(row); return false; } };
      const inc = { label: '+ Приход', title: 'Поступление на склад', run: (row) => move(row, 'in', silent) };
      const out = { label: '− Списать', title: 'Выдача / расход', run: (row) => move(row, 'out', silent) };
      const fromRes = { label: 'Из брони', title: 'Выдать забронированное: количество и объект — из брони', run: (row) => issueFromReserve(row, silent) };
      const base = r.status === 'none' ? [order, inc] : r.status === 'low' ? [order, inc, out] : [inc, out];
      return r.reservedQty > 0 ? [fromRes, ...base.filter((a) => a !== out || r.free > 0)] : base;
    },
    tiles: {
      key: 'categoryId',
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
      { key: 'reservedQty', label: 'Бронь', sort: 'reservedQty', cls: 'num right', render: (r) => (r.reservedQty ? qty(r.reservedQty) : '') },
      { key: 'free', label: 'Свободно', sort: 'free', cls: 'num right', render: (r) => h('span', { title: r.ordered ? `С учётом заказанного: ${qty(r.free + r.ordered)}` : '' }, qty(r.free)) },
      { key: 'minQuantity', label: 'Мин.', sort: 'minQuantity', cls: 'num right md-hide', render: (r) => (r.minQuantity ? qty(r.minQuantity) : '') },
      { key: 'lastCountedAt', label: 'Пересчёт', sort: 'lastCountedAt', cls: 'md-hide muted', render: (r) => (r.lastCountedAt ? date(r.lastCountedAt) : '') },
      { key: 'status', label: 'Состояние', sort: 'status', render: (r) => h('span', { class: 'nowrap st-cell' }, badge(STOCK_STATUS, r.status), r.reservedQty ? h('span', { class: 'tag', title: 'Отложено под заказы — «Из брони» в строке' }, `бронь ${qty(r.reservedQty)}`) : null, r.ordered ? h('span', { class: 'muted small', title: 'Открытые заявки на позицию' }, `  заказано ${qty(r.ordered)}`) : null) },
    ],
    card: {
      thumb: photoThumb,
      title: (r) => r.name,
      sub: (r) => [r.categoryName, r.reservedQty ? `бронь ${qty(r.reservedQty)}` : '', r.supplierArticle && `арт. ${r.supplierArticle}`].filter(Boolean).join(' · '),
      side: (r) => [h('b', { class: 'num' }, `${qty(r.quantity)} ${unit(r)}`), badge(STOCK_STATUS, r.status)],
    },
  },

  card: {
    gallery: (r) => r.photos || [],
    photoAdd: (r, photoId) => api(`/stock/items/${r.id}/photos`, { method: 'POST', body: { photoId } }),
    photoRemove: (r, photoId) => api(`/stock/items/${r.id}/photos/${photoId}`, { method: 'DELETE' }),
    heading: (r) => r.name,
    subheading: (r) => [r.categoryName, r.supplierArticle && `арт. ${r.supplierArticle}`].filter(Boolean).join(' · '),
    stats: (r) => [['Остаток', `${qty(r.quantity)} ${unit(r)}`], ['В брони', qty(r.reservedQty)], ['Свободно', qty(r.free)]],
    view: (r) => [
      ['Состояние', badge(STOCK_STATUS, r.status)],
      ['Мин. остаток', r.minQuantity ? `${qty(r.minQuantity)} ${unit(r)}` : ''],
      ['Пересчитано', r.lastCountedAt ? date(r.lastCountedAt) : 'ещё не пересчитывали'],
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
      r.reservedQty > 0 && { label: 'Выдать из брони', primary: true, title: 'Количество и объект — из брони', run: (row, ctx) => issueFromReserve(row, ctx) },
      { label: '+ Приход', primary: !(r.reservedQty > 0), run: (row, ctx) => move(row, 'in', ctx) },
      { label: '− Списание', run: (row, ctx) => move(row, 'out', ctx) },
      { label: 'Забронировать под заказ', run: (row, ctx) => move(row, 'reserve', ctx) },
      r.reservedQty > 0 && { label: 'Снять бронь', run: (row, ctx) => move(row, 'unreserve', ctx) },
      { label: 'Пересчитать (сколько лежит)', run: (row, ctx) => move(row, 'adjust', ctx) },
      r.metal && !r.offcutOf && { label: 'Отложить обрезок…', run: (row, ctx) => offcutDialog(row, ctx) },
      { label: 'Заказать (новая заявка)', run: (row) => orderItem(row) },
    ],
    // «Заказано», «Поставщики и цены» (ЗП.1, ЗП.5), затем последние движения
    extra: (r, ctx) => h('div', null, orderedBlock(r), recentMoves(r, ctx)),
  },

  form: {
    fields: async (row) => {
      const lk = await lookups().catch(() => ({ categories: [] }));
      return [
        { section: 'Что за позиция', tone: 'main', fixed: true },
        { key: 'name', label: 'Наименование', required: true, max: 300, span: 3, hint: 'Как называется на складе: «Болт мебельный, M8х40, DIN 603»' },
        { key: 'article', label: 'Артикул (поставщика)', max: 100, span: 1, hint: 'Из счёта / заявки. Пусто — останется внутренний код' },
        { key: 'categoryName', label: 'Категория', type: 'combo', options: lk.categories.map((c) => c.name), max: 100 },
        { key: 'unit', label: 'Ед. изм.', type: 'combo', required: true, options: unitList(lk), max: 30 },
        // новая позиция — сразу «Начальный остаток»: штуками или по весу (НО.2)
        ...(row ? [] : [{ section: 'Начальный остаток', tone: 'info', fixed: true },
          { key: 'initial', type: 'widget', label: '', wide: true, widget: () => { const q = h('input', { inputmode: 'decimal', placeholder: '0' }); const wc = weightCount({ qtyInput: q, label: 'Сколько лежит' }); return { el: wc.el, get value() { return JSON.stringify(wc.get()); }, set value(_) { /* только ввод */ } }; } }]),
        { section: 'Запас', tone: 'info' },
        { key: 'minQuantity', label: 'Минимальный остаток', type: 'number', min: 0, hint: 'Станет меньше — позиция попадёт в «К закупке»' },
        { key: 'weightG', label: 'Вес 1 шт., г', type: 'number', min: 0, hint: 'Для счёта по весу: штуки = вес партии ÷ вес 1 шт.' },
        ...metalFields(),
        { section: 'Фото и примечание', tone: 'who' },
        { key: 'photos', label: 'Фото', type: 'photos', hint: 'Перетащите, вставьте Ctrl+V или выберите файл' },
        { key: 'notes', label: 'Примечание', type: 'textarea', wide: true },
      ];
    },
    initial: () => ({ unit: 'шт', photos: [] }),
    toInitial: (r) => ({ ...r, article: r.supplierArticle || '', ...metalInitial(r), weightG: r.weightG ?? null, photos: r.photos || [] }),
    toBody: (v) => {
      const b = { photoIds: v.photos || [], name: v.name, unit: v.unit || 'шт', categoryName: v.categoryName || '', notes: v.notes || '' };
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

