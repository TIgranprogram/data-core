import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, money, qty } from '../core/format.js';
import { go } from '../core/router.js';
import { table, section, stack, card, badge, hint, readonlyGroup, stats, miniChart, button } from '../ui/kit/index.js';
import { busyBlock, failBlock } from '../ui/kit/busy.js';

/**
 * Правая панель «Каталог номенклатуры» (C040): паспорт позиции склада одним запросом GET /materials/:id/summary.
 * Шапка — «Позиция номенклатуры» / «Предложение поставщика»; ключевые числа; блоки: где лежит, поставщики, история цен,
 * заявки, выдачи; «Аналитика» — только чтение (столбики по месяцам + заказчики). Деньги без галочки сервер отдаёт null.
 */
export const SRC = { excel: 'Excel', request: 'Заявка', stock: 'Склад', manual: 'Вручную' };
const PRICE_SRC = { purchase: 'Закупка', catalog: 'Прайс' };
const STALE_MS = 183 * 86400000;
export const isMaterial = (r) => r.kind === 'material'; // позиция склада без предложений поставщика
export const isStale = (r) => r.priceHint != null && (!r.priceDate || Date.now() - new Date(r.priceDate).getTime() > STALE_MS);
export const staleBadge = (priceDate) => { const b = badge(priceDate ? 'от ' + date(priceDate) + ' — устарела' : 'устарела', 'warn'); b.title = 'Цене больше 6 месяцев'; return b; };
const manual = (a) => !a || String(a).startsWith('manual:');
const dash = () => h('span', { class: 'muted' }, '—');
const put = (x, f = (v) => v) => (x === null || x === undefined || x === '' ? dash() : f(x));
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Название открытого: строка для шапки панели (card.js: section.kind может быть функцией). */
export const kindOf = (r) => (r && isMaterial(r) ? 'Позиция номенклатуры' : r ? 'Предложение поставщика' : 'Каталог номенклатуры');

// ---------- сводка: один запрос, общий для верха и блоков, кэш 15 с ----------
const cache = new Map();
function summaryOf(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 15000) return hit.p;
  const p = api(`/materials/${encodeURIComponent(id)}/summary`).catch((e) => { cache.delete(id); throw e; });
  cache.set(id, { at: Date.now(), p });
  return p;
}
/** Сброс после правки позиции (цена, связь). */
export const dropSummary = () => cache.clear();

const sum = (list, key) => (list || []).reduce((a, x) => a + (Number(x[key]) || 0), 0);
const lastOf = (list) => (list && list.length ? list[list.length - 1] : null);

// ---------- блоки ----------
function placesBlock(s) {
  const places = s.stock?.places || [];
  const body = places.length
    ? table({ columns: [{ label: 'Склад' }, { label: 'Место' }, { label: 'Количество', num: true }],
        rows: places.map((p) => ({ cells: [p.warehouseName || '—', put(p.place), `${qty(p.qty)}${s.unit ? ' ' + s.unit : ''}`] })) })
    : hint('На складе этой позиции нет.');
  return section({ title: 'Где лежит', tone: 'info', count: places.length, open: places.length > 0, body });
}

function suppliersBlock(s) {
  const list = s.suppliers || [];
  const body = list.length
    ? table({ columns: [{ label: 'Поставщик' }, { label: 'Раз', num: true }, { label: 'Всего', num: true }, { label: 'Последний раз' }, { label: 'Последняя цена', num: true, money: true }, { label: 'Мин – макс', num: true, money: true }],
        rows: list.map((x) => ({ cells: [
          x.name || '—',
          x.count ? qty(x.count) : { v: 'не закупали', cls: 'muted' },
          x.count ? `${qty(x.totalQty)}${s.unit ? ' ' + s.unit : ''}` : dash(),
          put(x.lastDate, date),
          put(x.lastPrice, money),
          x.minPrice != null && x.maxPrice != null && x.minPrice !== x.maxPrice ? `${money(x.minPrice)} – ${money(x.maxPrice)}` : dash(),
        ] })) })
    : hint('Поставщиков пока нет: закупок не было, прайса нет.');
  return section({ title: 'Поставщики', tone: 'who', count: list.length, open: list.length > 0, body });
}

function pricesBlock(s) {
  const list = [...(s.prices || [])].reverse(); // по дате: сверху самая свежая
  const body = list.length
    ? table({ columns: [{ label: 'Дата' }, { label: 'Цена', num: true, money: true }, { label: 'Поставщик' }, { label: 'Откуда' }],
        rows: list.map((x) => ({ cells: [put(x.date, date), put(x.price, money), put(x.supplierName), { v: PRICE_SRC[x.source] || '', cls: 'muted' }] })) })
    : hint('Истории цен пока нет.');
  return section({ title: 'История цен', tone: 'money', count: list.length, body });
}

function requestsBlock(s) {
  const q = s.requests || { items: [] };
  const body = q.items?.length
    ? table({ clickable: true, columns: [{ label: '№' }, { label: 'Дата' }, { label: 'Количество', num: true }, { label: 'Статус' }, { label: 'Поставщик' }],
        rows: q.items.map((x) => ({ onClick: () => go('requests', { open: x.id }), cells: [put(x.num), put(x.date, date), `${qty(x.qty)}${s.unit ? ' ' + s.unit : ''}`, x.statusLabel || '—', put(x.supplierName)] })) })
    : hint('Пока не заказывали.');
  const open = q.open ? ` · в пути ${qty(q.open)}` : '';
  return section({ title: `Заявки${open}`, tone: 'gold', count: q.total ?? q.items?.length ?? 0, body });
}

function issuedBlock(s) {
  const items = s.issued?.items || [];
  const body = items.length
    ? table({ clickable: true, columns: [{ label: 'Дата' }, { label: 'Количество', num: true }, { label: 'Заказ' }, { label: 'Заказчик' }, { label: 'Вид работ' }],
        rows: items.map((x) => ({ onClick: x.orderId ? () => go('salesorders', { open: x.orderId }) : undefined,
          cells: [put(x.date, date), `${qty(x.qty)}${s.unit ? ' ' + s.unit : ''}`, put(x.orderNum, (n) => '№ ' + n), put(x.customerName), put(x.workType)] })) })
    : hint('Со склада ещё не выдавали.');
  return section({ title: 'Выдачи', tone: 'main', count: items.length, body });
}

function monthLabel(m, i) {
  const [y, mm] = String(m.month).split('-');
  const name = MONTHS[Number(mm) - 1] || m.month;
  return i === 0 || mm === '01' ? `${name} ’${String(y).slice(2)}` : name;
}

/** «Аналитика»: только чтение — ни одной кнопки. */
function analyticsBlock(s) {
  const months = s.monthly || [];
  const chart = miniChart({ type: 'columns', label: 'Заказано, получено и выдано по месяцам', empty: 'Пока не заказывали и не выдавали.',
    legend: [{ label: 'Заказано', tone: 'info' }, { label: 'Получено', tone: 'ok' }, { label: 'Выдано', tone: 'warn' }],
    groups: months.map((m, i) => ({ label: monthLabel(m, i), values: [{ value: m.ordered, tone: 'info' }, { value: m.received, tone: 'ok' }, { value: m.issued, tone: 'warn' }] })) });
  const custs = s.customers || [];
  const top = custs.length
    ? table({ columns: [{ label: 'Заказчик' }, { label: 'Количество', num: true }, { label: 'Заказов', num: true }],
        rows: custs.map((c) => ({ cells: [c.name || '—', `${qty(c.qty)}${s.unit ? ' ' + s.unit : ''}`, qty(c.orders)] })) })
    : hint('Заказчиков пока нет: позицию ещё не выдавали под заказы.');
  const used = s.usedIn && (s.usedIn.products || s.usedIn.orders)
    ? h('p', { class: 'muted small' }, `Входит в изделий: ${qty(s.usedIn.products)} · в заказах: ${qty(s.usedIn.orders)}`) : null;
  return section({ title: 'Аналитика', tone: 'info', fixed: true, body: [chart, h('p', { class: 'muted small' }, 'Кому выдавали'), top, used] });
}

/** Ключевые числа сверху: остаток · в пути · заказано за год · выдано за год · последняя цена. */
function kpiStats(s) {
  const last = lastOf(s.prices);
  const u = s.unit ? ' ' + s.unit : '';
  const items = [
    { value: `${qty(s.stock?.total ?? 0)}${u}`, label: 'Остаток' },
    { value: qty(s.requests?.open ?? 0), label: 'Заявок в пути' },
    { value: `${qty(sum(s.monthly, 'ordered'))}${u}`, label: 'Заказано за год' },
    { value: `${qty(sum(s.monthly, 'issued'))}${u}`, label: 'Выдано за год' },
  ];
  if (session.canMoney) items.push({ value: last?.price != null ? money(last.price) : '—', label: 'Последняя цена' });
  return stats(items);
}

// ---------- верх карточки ----------
function offerFields(r, ctx) {
  const art = manual(r.article) ? '' : r.article;
  const mat = r.materialId
    ? h('span', null, r.materialName, r.materialArticle ? h('span', { class: 'muted' }, ' · ' + r.materialArticle) : null)
    : h('span', null, h('span', { class: 'muted' }, 'нет связи'), session.canEdit ? button({ label: 'Связать с позицией', size: 'S', onClick: () => ctx.edit() }) : null);
  return card({ size: 'M', variant: 'fields',
    price: { value: r.priceHint != null ? `${money(r.priceHint)}${r.unit ? ' / ' + r.unit : ''}` : 'Цена не задана',
      note: r.priceHint != null && r.priceDate ? (isStale(r) ? staleBadge(r.priceDate) : 'от ' + date(r.priceDate)) : null },
    body: readonlyGroup({ rows: [
      ['Артикул у поставщика', art], ['Цвет', r.color], ['Группа', r.optGroup],
      ['Откуда', SRC[r.source] || ''], ['Наш материал', mat], ['Примечание', r.note]] }) });
}

function dimsText(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  const parts = ['length', 'width', 'height', 'thickness', 'diameter'].map((k) => (d[k] != null && d[k] !== '' ? String(d[k]) : '')).filter(Boolean);
  return parts.length ? parts.join(' × ') + (d.unit ? ' ' + d.unit : '') : '';
}

function materialFields(r) {
  const part = r.materialKind === 'part';
  const rows = [
    ['Артикул', r.article || '—'],
    ['Единица', r.unit || '—'],
    ['Категория', r.categoryName],
  ];
  if (part) {
    rows.push(
      ['Вид', 'Деталь'],
      ['Размеры', dimsText(r.dimensions) || '—'],
      ['Масса', r.weightKg != null ? `${qty(r.weightKg)} кг` : '—'],
      ['RAL', (r.colors || []).join(', ') || r.ralCode || '—'],
      ['Нужно название', r.needsName ? badge('да — впишите понятное имя', 'warn') : 'нет'],
    );
  }
  return card({ size: 'M', variant: 'fields', body: readonlyGroup({ rows }) });
}

/** C057 Э3: сырьё-заготовка детали + файлы PDM с версиями. */
function partBomBlock(comp) {
  const lines = comp?.items || comp?.composition || (Array.isArray(comp) ? comp : []);
  if (!lines.length) return section({ title: 'Заготовка и сырьё', tone: 'warn', body: hint('Размера заготовки нет — укажите в составе детали (сырьё + размеры).') });
  return section({
    title: 'Заготовка и сырьё', tone: 'gold', count: lines.length,
    body: table({
      columns: [{ label: 'Сырьё' }, { label: 'Заготовка' }, { label: 'Расход', num: true }],
      rows: lines.map((l) => ({
        cells: [
          l.name || l.materialName || '—',
          dimsText(l.overrideDimensions) || l.sizeText || '—',
          `${qty(l.quantity)}${l.unit ? ' ' + l.unit : ''}`,
        ],
      })),
    }),
  });
}

function pdmFilesBlock(ownerKind, ownerId) {
  const box = stack(busyBlock('файлы PDM'));
  const paint = () => {
    box.replaceChildren(busyBlock('файлы PDM', { retry: paint }));
    api('/pdm-files', { query: { ownerKind, ownerId } }).then((res) => {
      const items = res.items || res || [];
      if (!items.length) { box.replaceChildren(hint('Файлов из PDM пока нет.')); return; }
      box.replaceChildren(section({
        title: 'Файлы из PDM', tone: 'info', count: items.length,
        body: table({
          columns: [{ label: 'Файл' }, { label: 'Вид' }, { label: 'Версии' }, { label: 'Текущая' }],
          rows: items.map((f) => ({
            cells: [
              f.name || f.designation || '—',
              f.kind || f.role || '—',
              `Версии (${f.versions?.length || f.versionCount || 1})`,
              f.version != null ? String(f.version) : (f.isCurrent ? 'текущая' : '—'),
            ],
          })),
        }),
      }));
    }).catch((e) => box.replaceChildren(failBlock(e, paint, { text: 'Файлы PDM не загрузились' })));
  };
  paint();
  return box;
}

/** Шапка панели: подзаголовок. */
export const subheading = (r) => (isMaterial(r)
  ? [manual(r.article) ? '' : 'арт. ' + r.article, r.categoryName].filter(Boolean).join(' · ')
  : [r.supplierName, manual(r.article) ? '' : 'арт. ' + r.article, r.materialName].filter(Boolean).join(' · '));

/** Блок над сводкой: для предложения — «Это предложение»; ключевые числа подставляются, когда сводка пришла. */
export function cardTop(r, ctx) {
  const slot = h('div');
  const own = isMaterial(r) ? materialFields(r) : section({ title: 'Это предложение', tone: 'main', fixed: true, body: offerFields(r, ctx) });
  const box = stack(own, slot);
  if (r.materialId) summaryOf(r.materialId).then((s) => slot.replaceChildren(kpiStats(s))).catch(() => {});
  return box;
}

/** Блоки паспорта позиции (после верха). Нет позиции склада — только история цен предложения. */
export function cardExtra(r) {
  if (!r.materialId) {
    if (isMaterial(r) && r.materialKind === 'part') {
      const mid = r.id;
      const box = stack();
      const load = () => {
        box.replaceChildren(busyBlock('состав детали'));
        Promise.all([
          api(`/materials/${mid}/composition`).catch(() => ({ items: [] })),
          api(`/materials/${mid}`).catch(() => r),
        ]).then(([comp, full]) => {
          box.replaceChildren(
            partBomBlock(comp),
            pdmFilesBlock('material', mid),
            full?.needsName ? hint('Нужно название: сейчас в карточке обозначение — впишите понятное имя менеджера.') : null,
          );
        }).catch((e) => box.replaceChildren(failBlock(e, load, { text: 'Состав детали не загрузился' })));
      };
      load();
      return box;
    }
    if (isMaterial(r)) return hint('Поставщика нет, цены нет. Чтобы появились — загрузите прайс поставщика кнопкой «Загрузить Excel» или сопоставьте его строку с этой позицией.');
    const hist = [...(r.priceHistory || [])].reverse();
    return stack(section({ title: 'История цен', tone: 'money', count: hist.length,
      body: hist.length ? table({ columns: [{ label: 'Дата' }, { label: 'Цена', num: true, money: true }, { label: 'Откуда' }],
        rows: hist.map((x) => ({ cells: [x.date ? date(x.date) : '—', money(x.price), { v: SRC[x.source] || x.source || '', cls: 'muted' }] })) }) : hint('Истории цен пока нет.') }));
  }
  const box = stack();
  const load = () => {
    box.replaceChildren(busyBlock('сводку по позиции'));
    summaryOf(r.materialId).then((s) => box.replaceChildren(placesBlock(s), suppliersBlock(s), pricesBlock(s), requestsBlock(s), issuedBlock(s), analyticsBlock(s)))
      .catch((e) => box.replaceChildren(failBlock(e, load, { text: 'Сводка по позиции не загрузилась' })));
  };
  load();
  return box;
}
