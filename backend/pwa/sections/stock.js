import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, parseNum, qty } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { badge, STOCK_STATUS } from '../ui/badges.js';
import { modal } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { lookups, UNITS } from './lookups.js';
import { cancelMovement, moveLabel } from './movements.js';

/** Раздел «Склад» (PRODUCT §2): materials + storageitems через /api/stock. */
const unit = (r) => r.unit || '';
/** Миниатюра в строке списка (или пустое место того же размера — колонки не прыгают). */
const noPic = () => h('span', { class: 'pic empty', 'aria-hidden': 'true' }, '▢');
export const pic = (p) => (p ? h('img', { class: 'pic', src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy', onerror: (e) => e.target.replaceWith(noPic()) }) : noPic());
const photoThumb = (r) => {
  const p = (r.photos || [])[0];
  return p ? h('img', { class: 'thumb', src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy' }) : null;
};

/** Приход / списание / бронь / снятие брони / инвентаризация. */
async function move(r, type, ctx) {
  const inv = type === 'adjust';
  const titles = { in: 'Приход', out: 'Списание', reserve: 'Бронь', unreserve: 'Снять бронь', adjust: 'Инвентаризация' };
  const hints = {
    in: 'Поступление на склад. Остаток увеличится.',
    out: `Выдача в производство / расход. Свободно сейчас: ${qty(r.free)} ${unit(r)}.`,
    reserve: `Резерв под заказ: остаток не меняется, «свободно» уменьшается. Свободно сейчас: ${qty(r.free)} ${unit(r)}.`,
    unreserve: `Вернуть забронированное в свободный остаток. В брони: ${qty(r.reservedQty)} ${unit(r)}.`,
    adjust: `Введите, сколько фактически лежит на складе. Сейчас по учёту: ${qty(r.quantity)} ${unit(r)}.`,
  };
  const qIn = h('input', { name: 'qty', inputmode: 'decimal', value: type === 'unreserve' ? String(r.reservedQty) : inv ? String(r.quantity) : '' });
  const note = h('input', { name: 'note', maxlength: 300, placeholder: type === 'reserve' ? 'Под какой заказ' : type === 'out' ? 'Куда / на какой заказ' : 'Основание' });
  const done = await modal({
    title: `${titles[type]}: ${r.name}`, okText: inv ? 'Сохранить остаток' : 'Провести',
    body: h('div', null, h('p', { class: 'hint' }, hints[type]),
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', null, (inv ? 'Фактический остаток' : 'Количество') + (unit(r) ? ', ' + unit(r) : '')), qIn),
        h('label', { class: 'field' }, h('span', null, 'Примечание'), note))),
    onOk: async () => {
      const n = parseNum(qIn.value);
      if (n === undefined || Number.isNaN(n) || n < 0 || (!inv && n === 0)) throw new Error(inv ? 'Введите число не меньше 0' : 'Введите количество больше нуля');
      if (inv) {
        const delta = Math.round((n - r.quantity) * 1000) / 1000;
        if (delta === 0) return r;
        return api(`/stock/items/${r.id}/move`, { method: 'POST', body: { type: 'adjust', qty: delta, note: note.value.trim() || 'инвентаризация' } });
      }
      return api(`/stock/items/${r.id}/move`, { method: 'POST', body: { type, qty: n, note: note.value.trim() || undefined } });
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
      reserved: 'Часть остатка забронирована под заказы: «свободно» меньше остатка.',
      ok: 'Хватает. Делать ничего не нужно.',
    },
    rowAction: (r) => {
      const silent = { setRow: () => {} };
      const order = { label: 'Заказать', title: 'Создать заявку на эту позицию', run: (row) => { patch({ of: 'requests', new: '1', open: undefined, title: row.name, unit: row.unit || '', categoryName: row.categoryName || '' }); return false; } };
      const inc = { label: '+ Приход', title: 'Поступление на склад', run: (row) => move(row, 'in', silent) };
      const out = { label: '− Списать', title: 'Выдача / расход', run: (row) => move(row, 'out', silent) };
      return r.status === 'none' ? [order, inc] : r.status === 'low' ? [order, inc, out] : [inc, out];
    },
    tiles: {
      key: 'categoryId',
      load: async () => (await api('/stock/categories')).items.filter((c) => c.id !== 'none').map((c) => ({
        value: c.id, label: c.name, n: c.total,
        sub: c.low || c.none ? h('span', null, c.low ? h('span', { class: 'warn' }, `к закупке ${c.low}`) : null, c.low && c.none ? ' · ' : null, c.none ? `нет ${c.none}` : null) : 'всё в норме',
      })),
    },
    columns: [
      { key: 'pic', label: '', cls: 'pic-cell', render: (r) => pic(r.photos?.[0]) },
      { key: 'name', label: 'Наименование', sort: 'name', cls: 'clip', render: (r) => h('span', { title: r.name }, r.name) },
      { key: 'categoryName', label: 'Категория', sort: 'categoryName', cls: 'md-hide', render: (r) => r.categoryName || '' },
      { key: 'quantity', label: 'Остаток', sort: 'quantity', cls: 'num right', render: (r) => h('b', null, qty(r.quantity)) },
      { key: 'unit', label: 'Ед.', render: unit },
      { key: 'reservedQty', label: 'Бронь', sort: 'reservedQty', cls: 'num right', render: (r) => (r.reservedQty ? qty(r.reservedQty) : '') },
      { key: 'free', label: 'Свободно', sort: 'free', cls: 'num right', render: (r) => qty(r.free) },
      { key: 'minQuantity', label: 'Мин.', sort: 'minQuantity', cls: 'num right md-hide', render: (r) => (r.minQuantity ? qty(r.minQuantity) : '') },
      { key: 'lastCountedAt', label: 'Пересчёт', sort: 'lastCountedAt', cls: 'md-hide muted', render: (r) => (r.lastCountedAt ? date(r.lastCountedAt) : '') },
      { key: 'status', label: 'Состояние', sort: 'status', render: (r) => badge(STOCK_STATUS, r.status) },
    ],
    card: {
      thumb: photoThumb,
      title: (r) => r.name,
      sub: (r) => [r.categoryName, r.reservedQty ? `бронь ${qty(r.reservedQty)}` : '', r.article].filter(Boolean).join(' · '),
      side: (r) => [h('b', { class: 'num' }, `${qty(r.quantity)} ${unit(r)}`), badge(STOCK_STATUS, r.status)],
    },
  },

  card: {
    gallery: (r) => r.photos || [],
    photoAdd: (r, photoId) => api(`/stock/items/${r.id}/photos`, { method: 'POST', body: { photoId } }),
    heading: (r) => r.name,
    subheading: (r) => [r.categoryName, r.article && `арт. ${r.article}`].filter(Boolean).join(' · '),
    stats: (r) => [['Остаток', `${qty(r.quantity)} ${unit(r)}`], ['В брони', qty(r.reservedQty)], ['Свободно', qty(r.free)]],
    view: (r) => [
      ['Состояние', badge(STOCK_STATUS, r.status)],
      ['Мин. остаток', r.minQuantity ? `${qty(r.minQuantity)} ${unit(r)}` : ''],
      ['Пересчитано', r.lastCountedAt ? date(r.lastCountedAt) : 'ещё не пересчитывали'],
      ['Категория', r.categoryName],
      ['Ед. изм.', r.unit],
      ['Артикул', r.article],
      ['Вес 1 шт., кг', r.weightKg ? qty(r.weightKg) : ''],
      ['Примечание', r.notes],
      ['Заявки', h('a', { href: '#requests?q=' + encodeURIComponent(r.name) }, 'найти заявки по позиции →')],
    ],
    actions: (r) => [
      { label: '+ Приход', primary: true, run: (row, ctx) => move(row, 'in', ctx) },
      { label: '− Списание', run: (row, ctx) => move(row, 'out', ctx) },
      { label: 'Забронировать под заказ', run: (row, ctx) => move(row, 'reserve', ctx) },
      r.reservedQty > 0 && { label: 'Снять бронь', run: (row, ctx) => move(row, 'unreserve', ctx) },
      { label: 'Пересчитать (сколько лежит)', run: (row, ctx) => move(row, 'adjust', ctx) },
      { label: 'Заказать (новая заявка)', run: (row) => patch({ of: 'requests', new: '1', open: undefined, title: row.name, unit: row.unit || '', categoryName: row.categoryName || '' }) },
    ],
    extra: recentMoves,
  },

  form: {
    fields: async () => {
      const lk = await lookups().catch(() => ({ categories: [] }));
      return [
        { section: 'Что за позиция', tone: 'main', fixed: true },
        { key: 'name', label: 'Наименование', required: true, max: 300, span: 3, hint: 'Как называется на складе: «Болт мебельный, M8х40, DIN 603»' },
        { key: 'article', label: 'Артикул', max: 100, span: 1, hint: 'Пусто — присвоится сам' },
        { key: 'categoryName', label: 'Категория', type: 'combo', options: lk.categories.map((c) => c.name), max: 100 },
        { key: 'unit', label: 'Ед. изм.', type: 'combo', required: true, options: UNITS, max: 30 },
        { section: 'Запас', tone: 'info' },
        { key: 'minQuantity', label: 'Минимальный остаток', type: 'number', min: 0, hint: 'Станет меньше — позиция попадёт в «К закупке»' },
        { key: 'weightKg', label: 'Вес 1 шт., кг', type: 'number', min: 0 },
        { section: 'Фото и примечание', tone: 'who' },
        { key: 'photos', label: 'Фото', type: 'photos', hint: 'Перетащите, вставьте Ctrl+V или выберите файл' },
        { key: 'notes', label: 'Примечание', type: 'textarea', wide: true },
      ];
    },
    initial: () => ({ unit: 'шт', photos: [] }),
    toInitial: (r) => ({ ...r, photos: r.photos || [] }),
    toBody: (v) => {
      const b = { photoIds: v.photos || [], name: v.name, unit: v.unit || 'шт', categoryName: v.categoryName || '', notes: v.notes || '' };
      if (v.article) b.article = v.article;
      if (v.minQuantity !== null) b.minQuantity = v.minQuantity;
      if (v.weightKg !== null) b.weightKg = v.weightKg;
      return b;
    },
    create: async (body) => {
      const same = await api('/stock/items', { query: { search: body.name, limit: 20 } });
      const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
      const twin = same.items.find((i) => norm(i.name) === norm(body.name));
      if (twin) throw new Error(`Позиция «${twin.name}» уже есть на складе — найдите её поиском`);
      const { photoIds, ...rest } = body;
      let r = await api('/stock/items', { method: 'POST', body: rest });
      for (const photoId of photoIds || []) r = await api(`/stock/items/${r.id}/photos`, { method: 'POST', body: { photoId } });
      lookups.reset();
      return r;
    },
    update: async (id, body) => {
      const { photoIds, ...rest } = body;
      let r = await api(`/stock/items/${id}`, { method: 'PATCH', body: rest });
      const have = new Set((r.photos || []).map((p) => p.id));
      for (const photoId of photoIds || []) if (!have.has(photoId)) r = await api(`/stock/items/${id}/photos`, { method: 'POST', body: { photoId } });
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

