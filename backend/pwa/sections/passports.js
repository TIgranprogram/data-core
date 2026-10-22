import { api, apiFile, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { normSearch } from '../core/facets.js';
import { date, isoDay } from '../core/format.js';
import { current, go } from '../core/router.js';
import { photoDrop } from '../ui/photos.js';
import { toast, toastError } from '../ui/toast.js';

/**
 * Раздел «Паспорта изделий» (TASKS ПС.4–ПС.5): паспорт = экземпляр (№, талон, номер изделия, дата, заказчик/объект),
 * модель — общие поля (наименование, габариты, материалы, описание, картинки). Номера выдаёт сервер.
 * Новый паспорт: начните печатать наименование — выберите модель, подставится всё, кроме заказчика и даты.
 * Смотреть — менеджер и выше, создавать и менять — директор и админ (как на сервере).
 */
const KINDS = [
  ['overview', 'Общий вид', 'на титуле'],
  ['dimensions', 'Габариты', 'приложение «Габариты изделия»'],
  ['safety', 'Зона безопасности', 'приложение «Монтаж»'],
  ['mounting', 'Монтаж', 'рисунки монтажа'],
];
/** Единый список категорий (решение 2026-10-21: без дублей и грамотно) — дополняется тем, что уже есть в паспортах. */
const CATEGORIES = ['Уличный тренажёр', 'Спортивное оборудование', 'Воркаут', 'Благоустройство', 'МАФ', 'Качели', 'Карусель', 'Детский игровой комплекс'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const canEdit = () => ['admin', 'director'].includes(session.user?.role) || session.user?.isOwner === true;
const num = (v) => (v === undefined || v === null || v === '' ? '' : String(v).replace('.', ','));
const dims = (r) => (r.height || r.length || r.width ? `${num(r.height) || '—'} × ${num(r.length) || '—'} × ${num(r.width) || '—'} мм` : '');
const heading = (r) => `Паспорт № ${r.passportNumber || '—'}`;

let facetsCache = null; let facetsAt = 0;
const facets = async () => {
  if (facetsCache && Date.now() - facetsAt < 60000) return facetsCache;
  facetsCache = await api('/passports/facets').catch(() => ({ years: [], categories: [], customers: [], suppliers: [] }));
  facetsAt = Date.now();
  return facetsCache;
};
let oursCache = null;
const ourCompanies = async () => (oursCache ??= await api('/partners', { query: { type: 'our' } }).then((r) => r.items).catch(() => []));
const categories = async () => [...new Set([...CATEGORIES, ...(await facets()).categories.map((c) => c.value)])];

/** Модели для «выберите модель» (GET /passports/models: артикул + наименование, поля и фото последнего паспорта), кэш на минуту. */
let modelsCache = null; let modelsAt = 0;
async function models() {
  if (modelsCache && Date.now() - modelsAt < 60000) return modelsCache;
  const items = await api('/passports/models');
  modelsCache = items.map((r) => ({
    label: r.name, cat: r.category || '', pic: r.thumb ? PREFIX + r.thumb : null,
    sub: [r.article && 'арт. ' + r.article, dims(r), r.weight && num(r.weight) + ' кг', `${r.n} ${r.n % 10 === 1 && r.n % 100 !== 11 ? 'паспорт' : 'паспорт.'}`, (r.images || []).length ? `картинок ${(r.images || []).length}` : 'без картинок'].filter(Boolean).join(' · '),
    search: normSearch([r.name, r.article, r.category].filter(Boolean).join(' ')),
    values: { _copyFrom: r.id, name: r.name, category: r.category || '', article: r.article || '', height: num(r.height), length: num(r.length), width: num(r.width), weight: num(r.weight),
      materials: r.materials || '', installationMethod: r.installationMethod || '', purpose: r.purpose || '', description: r.description || '', supplierOrgId: r.supplierOrgId || '', warrantyMonths: num(r.warrantyMonths ?? 12) },
  }));
  modelsAt = Date.now();
  return modelsCache;
}

/** Готовые тексты «Описания» (GET /passports/phrases) — один запрос на форму. */
let phrasesP = null; let phrasesAt = 0;
const phrases = (field) => async () => {
  if (!phrasesP || Date.now() - phrasesAt > 60000) { phrasesP = api('/passports/phrases'); phrasesAt = Date.now(); }
  return (await phrasesP)[field] || [];
};

/** Заказы для «№ заказа»: выбор подставляет и заказчика. */
async function orders() {
  const items = (await api('/salesorders', { query: { limit: 500, sort: '-createdAt' } }).catch(() => ({ items: [] }))).items;
  return items.filter((o) => o.orderNo).map((o) => ({ label: `№ ${o.orderNo}${o.customer ? ' · ' + o.customer : ''}`, sub: [o.title, o.shipDate && 'отгрузка ' + date(o.shipDate)].filter(Boolean).join(' · '),
    cat: '', search: normSearch([o.orderNo, o.customer, o.title].filter(Boolean).join(' ')), values: { orderNo: o.orderNo, customerName: o.customer || '' } }));
}

/** «<Наименование> (в дальнейшем именуемое «Изделие»), изготовленное из <материалы>. <Установка> <Назначение>» — как на сервере. */
function buildDescription(v) {
  const t = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const sentence = (s) => (t(s) ? (/[.!?]$/.test(t(s)) ? t(s) : t(s) + '.') : '');
  const name = t(v.name).replace(/[.\s]+$/, '');
  if (!name) return '';
  const mat = t(v.materials).replace(/^изготовлен\S*\s+из\s+/i, '');
  return [`${name} (в дальнейшем именуемое «Изделие»)${mat ? ', изготовленное из ' + sentence(mat) : '.'}`, sentence(v.installationMethod), sentence(v.purpose)].filter(Boolean).join(' ');
}

const imgsOf = (r, kind) => (r.images || []).filter((i) => i.kind === kind).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const imagesBody = (list) => list.map((i, k) => ({ kind: i.kind, photoId: String(i.photoId), order: k, ...(i.caption ? { caption: i.caption } : {}) }));

async function download(r, query, what) {
  try { toast(`Готовлю ${what}…`); const name = await apiFile(`/passports/${r.id}/pdf`, { query, fallback: `Паспорт_${r.passportNumber}.pdf` }); toast(`Скачан: ${name}`); } catch (e) { toastError(e); }
}

/** Картинки по видам в карточке: миниатюры (клик — открыть, × — убрать) и своя зона «перетащите / Ctrl+V» у каждого вида. */
function imagesBlock(r, ctx) {
  const save = async (images) => {
    try { ctx.setRow(await api(`/passports/${r.id}`, { method: 'PATCH', body: { images: imagesBody(images) } }).then(() => api(`/passports/${r.id}`))); } catch (e) { toastError(e); }
  };
  return h('div', { class: 'pp-images' }, h('div', { class: 'section-title' }, 'Картинки паспорта'),
    ...KINDS.map(([kind, label, where]) => {
      const list = imgsOf(r, kind);
      return h('div', { class: 'pp-kind' },
        h('div', { class: 'pp-kind-head' }, h('b', null, label), h('span', { class: 'muted' }, ` · ${where}${list.length ? ' · ' + list.length : ''}`)),
        list.length ? h('div', { class: 'pf-strip' }, ...list.map((i) => h('div', { class: 'pf-item' },
          i.url ? h('img', { src: PREFIX + i.url, alt: '', title: i.caption || 'Открыть', onclick: () => window.open(PREFIX + i.url, '_blank') }) : h('span', { class: 'muted' }, 'нет файла'),
          canEdit() ? h('button', { type: 'button', class: 'pf-del', title: 'Убрать картинку', 'aria-label': 'Убрать картинку', onclick: () => save((r.images || []).filter((x) => x !== i)) }, '×') : null))) : null,
        canEdit() ? photoDrop({ attach: async (photoId) => { r.images = [...(r.images || []), { kind, photoId, order: list.length }]; return r; }, done: () => save(r.images) }) : null);
    }));
}

function bomBlock(r) {
  const rows = r.bom?.length ? r.bom : [{ pos: 1, code: 'И-1', name: 'Изделие в сборе', qty: 1, unit: 'шт.' }];
  return h('div', null, h('div', { class: 'section-title' }, 'Комплектность (приложение)'),
    h('table', { class: 'so-lines' }, h('thead', null, h('tr', null, ...['Поз.', 'Обозначение', 'Наименование', 'Кол-во', 'Ед.', 'Примечание'].map((x) => h('th', null, x)))),
      h('tbody', null, ...rows.map((b) => h('tr', null, h('td', null, b.pos ?? ''), h('td', null, b.code ?? ''), h('td', null, b.name ?? ''), h('td', { class: 'num' }, b.qty ?? ''), h('td', null, b.unit ?? ''), h('td', { class: 'muted' }, b.note ?? ''))))));
}

/** Комплектность в форме — строками «обозначение | наименование | кол-во | ед. | примечание». */
const bomText = (bom) => (bom?.length ? bom : []).map((b) => [b.code, b.name, b.qty, b.unit, b.note].map((x) => x ?? '').join(' | ').replace(/( \| )+$/, '')).join('\n');
const parseBom = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
  const [code, name, q, unit, note] = l.split('|').map((x) => x.trim());
  return { pos: i + 1, code: code || '', name: name || '', qty: Number(String(q || '').replace(',', '.')) || 1, unit: unit || 'шт.', ...(note ? { note } : {}) };
});

/** Параметры фильтров списка из адреса — для «PDF пакетом». */
function listQuery() {
  const p = current().params || {};
  const q = { search: p.q, year: p.year, month: p.month, category: p.category, supplierOrgId: p.supplierOrgId, customer: p.customer };
  if (p.state === 'incomplete') q.incomplete = 1;
  if (p.state === 'noImages') q.noImages = 1;
  return q;
}

export const passports = {
  id: 'passports',
  title: 'Паспорта',
  newTitle: 'Новый паспорт',
  entityType: 'ProductPassport',
  canEdit,
  historyLabels: { 'passport.created': 'Создан', 'passport.updated': 'Изменён', 'passport.copied': 'Копия', 'passport.deleted': 'Удалён', 'passport.restored': 'Восстановлен', create: 'Создан', update: 'Изменён' },
  get: (id) => api(`/passports/${id}`),

  list: {
    path: '/passports',
    sortDefault: '-passportNo',
    createLabel: 'Паспорт',
    searchPlaceholder: 'Поиск: № паспорта, талон, номер изделия, наименование, заказчик, объект…',
    emptyText: 'Паспортов пока нет.',
    query: (P) => ({ ...(P.state === 'incomplete' ? { incomplete: 1 } : {}), ...(P.state === 'noImages' ? { noImages: 1 } : {}) }),
    filters: [
      { key: 'state', label: 'Показать', type: 'chips', options: () => [{ value: 'incomplete', label: 'Неполные' }, { value: 'noImages', label: 'Без картинок' }],
        count: (resp, v) => (v === '' ? undefined : v === 'incomplete' ? resp.incomplete : undefined) },
      { key: 'category', label: 'Категория', type: 'hidden' }, // выбирается плитками над списком
      { key: 'year', label: 'Год', type: 'select', options: async () => (await facets()).years.map((y) => ({ value: String(y.value), label: `${y.value} (${y.n})` })) },
      { key: 'month', label: 'Месяц', type: 'select', options: async () => MONTHS.map((m, i) => ({ value: String(i + 1), label: m })) },
      { key: 'supplierOrgId', label: 'Поставщик', type: 'select', options: async () => (await facets()).suppliers.map((s) => ({ value: s.value, label: `${s.label} (${s.n})` })) },
      { key: 'customer', label: 'Заказчик', type: 'select', options: async () => (await facets()).customers.map((c) => ({ value: c.value, label: `${c.value} (${c.n})` })) },
    ],
    // все паспорта по категориям с фото (основной вид); «Таблица» — для поиска и сортировки
    gallery: {
      default: true, limit: 400, sort: 'category', lastGroup: 'Без категории',
      groupBy: (r) => r.category || 'Без категории',
      card: (r) => ({
        pic: r.thumb ? PREFIX + r.thumb : null,
        title: r.name || 'без названия',
        meta: [`№ ${r.passportNumber}`, date(r.date), r.customerName || r.objectName].filter(Boolean).join(' · '),
        badge: r.missing?.length ? h('span', { class: 'badge warn gc-badge', title: 'Не хватает: ' + r.missing.join(', ') }, `не хватает ${r.missing.length}`) : null,
      }),
    },
    tiles: { key: 'category', load: async () => (await facets()).categories.map((c) => ({ value: c.value, label: c.value, n: c.n })) },
    hints: {
      '': 'Паспорт — на каждое выданное изделие: свой номер, талон и номер изделия (их выдаёт система). Клик — карточка: картинки, «Скачать PDF», «Копия на ту же модель».',
      incomplete: 'Не хватает данных для выдачи: в строке видно, чего именно. Откройте и заполните — PDF соберётся полным.',
      noImages: 'Паспорта без картинок: перетащите или вставьте (Ctrl+V) общий вид в карточке.',
    },
    hintKey: 'state',
    headActions: () => [h('button', { class: 'btn btn-ghost', type: 'button', title: 'Все паспорта по текущим фильтрам — PDF в одном архиве (до 200)', onclick: async () => {
      try { toast('Собираю архив — это может занять минуту…'); const name = await apiFile('/passports/zip', { query: { ...listQuery(), stamp: 1 }, fallback: 'Паспорта.zip' }); toast(`Скачан: ${name}`); } catch (e) { toastError(e); }
    } }, '⇩ PDF пакетом')],
    columns: [
      { key: 'pic', label: '', cls: 'pic-cell', render: (r) => (r.thumb ? h('img', { class: 'pic so-pic', src: PREFIX + r.thumb, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null) },
      { key: 'passportNumber', label: '№', sort: 'passportNo', cls: 'nowrap', render: (r) => h('b', null, r.passportNumber || '—') },
      { key: 'date', label: 'Дата', sort: 'date', cls: 'nowrap', render: (r) => date(r.date) },
      { key: 'name', label: 'Наименование', sort: 'name', cls: 'clip', render: (r) => h('span', { title: r.name || '' }, r.name || h('span', { class: 'muted' }, 'без названия')) },
      { key: 'category', label: 'Категория', sort: 'category', cls: 'md-hide', render: (r) => r.category || h('span', { class: 'muted' }, '—') },
      { key: 'customerName', label: 'Заказчик / объект', sort: 'customerName', cls: 'clip md-hide', render: (r) => h('span', { title: [r.customerName, r.orderNo && 'заказ ' + r.orderNo, r.objectName].filter(Boolean).join(' · ') }, [r.customerName, r.orderNo && '№' + r.orderNo, r.objectName].filter(Boolean).join(' · ') || h('span', { class: 'muted' }, '—')) },
      { key: 'warrantyCode', label: 'Талон', cls: 'nowrap md-hide muted', render: (r) => r.warrantyCode || '' },
      { key: 'missing', label: 'Заполнено', cls: 'nowrap', render: (r) => (r.missing?.length ? h('span', { class: 'badge warn', title: 'Не хватает: ' + r.missing.join(', ') }, `нет ${r.missing.length}`) : h('span', { class: 'badge ok' }, 'всё')) },
    ],
    card: {
      thumb: (r) => (r.thumb ? h('img', { class: 'thumb', src: PREFIX + r.thumb, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null),
      title: (r) => `№ ${r.passportNumber} · ${r.name || 'без названия'}`,
      sub: (r) => [date(r.date), r.customerName || r.objectName, r.missing?.length ? `не хватает: ${r.missing.length}` : ''].filter(Boolean).join(' · '),
      side: () => [],
    },
  },

  card: {
    heading,
    editTop: true,
    subheading: (r) => [r.name, r.category].filter(Boolean).join(' · '),
    stats: (r) => [['Талон', r.warrantyCode || '—'], ['Номер изделия', `${r.productCode || '—'}${r.productCodeDuplicate ? ' (дубль)' : ''}`], ['Дата', date(r.date)], ['Гарантия', `${r.warrantyMonths ?? 12} мес.`]],
    view: (r) => [
      ['Наименование', r.name],
      ['Категория', r.category],
      ['Артикул', r.article],
      ['Габариты (В × Д × Ш)', dims(r)],
      ['Вес', r.weight ? num(r.weight) + ' кг' : ''],
      ['Материалы', r.materials],
      ['Установка', r.installationMethod],
      ['Назначение', r.purpose],
      ['Описание', r.description],
      ['Заказчик', r.customerName],
      ['№ заказа', r.orderNo],
      ['Объект', r.objectName],
      ['Поставщик', r.supplierOrg ? `${r.supplierOrg.name}${r.supplierOrg.hasSeal ? '' : ' (печать не загружена)'}` : r.supplier],
      ['PDF скачан', r.pdfIssuedAt ? date(r.pdfIssuedAt) : ''],
    ],
    actions: (r) => [
      { label: '⇩ PDF с печатью', run: (row) => download(row, { stamp: 1 }, 'PDF с печатью и подписью') },
      { label: '⇩ PDF без печати', run: (row) => download(row, {}, 'PDF без печати') },
      { label: '⇩ В печать (буклет A4)', run: (row) => download(row, { stamp: 1, mode: 'print' }, 'буклет для печати') },
      canEdit() && { label: 'Копия на ту же модель', run: async (row, ctx) => {
        try { const c = await api(`/passports/${row.id}/copy`, { method: 'POST', body: {} }); toast(`Создан паспорт № ${c.passportNumber} — укажите заказчика и дату`); ctx.changed(); go('passports', { ...current().params, open: c.id }); } catch (e) { toastError(e); }
      } },
    ],
    extra: (r, ctx) => h('div', null,
      r.missing?.length ? h('div', { class: 'fill-note' }, 'Не хватает для выдачи: ', h('b', null, r.missing.join(', '))) : null,
      imagesBlock(r, ctx), bomBlock(r)),
  },

  form: {
    fields: async (r) => {
      const [cats, ours, f] = await Promise.all([categories(), ourCompanies(), facets()]);
      return [
        { section: 'Изделие (модель)', tone: 'main', fixed: true },
        { key: '_copyFrom', type: 'hidden' },
        { key: 'name', label: 'Наименование', required: true, wide: true, max: 500,
          hint: r ? undefined : 'Начните печатать и выберите модель — подставятся габариты, материалы, описание и картинки',
          suggest: r ? undefined : models, suggestTitle: 'Модели: выберите — подставится всё, кроме заказчика и даты', suggestFocus: 'customerName' },
        { key: 'category', label: 'Категория', type: 'select', options: cats },
        { key: 'article', label: 'Артикул', max: 50 },
        { key: 'height', label: 'Высота, мм', type: 'number', min: 0, span: 1 },
        { key: 'length', label: 'Длина, мм', type: 'number', min: 0, span: 1 },
        { key: 'width', label: 'Ширина, мм', type: 'number', min: 0, span: 1 },
        { key: 'weight', label: 'Вес, кг', type: 'number', min: 0, span: 1 },
        { section: 'Кому и когда', tone: 'who', fixed: !r },
        { key: 'customerName', label: 'Заказчик', type: 'combo', options: f.customers.map((c) => c.value), max: 300 },
        { key: 'orderNo', label: '№ заказа', max: 50, suggest: orders, suggestTitle: 'Заказы — выбор подставит заказчика', hint: 'Начните печатать номер или заказчика' },
        { key: 'objectName', label: 'Объект / адрес', wide: true, max: 500 },
        ...(r ? [] : [{ key: 'date', label: 'Дата', type: 'date', required: true, hint: 'По дате и номеру строится гарантийный талон' }]),
        { key: 'supplierOrgId', label: 'Поставщик (наша компания)', type: 'select', options: ours.map((o) => ({ value: o.id, label: o.name })), hint: 'Реквизиты, печать и подпись в PDF — из карточки компании' },
        { key: 'warrantyMonths', label: 'Гарантия, мес.', type: 'number', min: 0, span: 1 },
        { section: 'Описание (раздел 1)', tone: 'info', collapsed: !!r },
        { key: 'materials', label: 'Материалы («изготовленное из …»)', type: 'textarea', wide: true, max: 2000, phrases: { load: phrases('materials'), by: 'category', title: 'Варианты' } },
        { key: 'installationMethod', label: 'Установка', type: 'textarea', wide: true, rows: 2, max: 1000, phrases: { load: phrases('installationMethod'), by: 'category', title: 'Варианты' } },
        { key: 'purpose', label: 'Назначение', type: 'textarea', wide: true, rows: 2, max: 1000, phrases: { load: phrases('purpose'), by: 'category', title: 'Варианты' } },
        { key: 'description', label: 'Описание целиком (раздел 1.1 паспорта)', type: 'textarea', wide: true, rows: 5, max: 4000, compose: { from: ['name', 'materials', 'installationMethod', 'purpose'], build: buildDescription },
          hint: 'Собирается само из наименования, материалов, установки и назначения; можно поправить вручную' },
        { section: 'Картинки', tone: 'info', collapsed: !!r },
        ...KINDS.map(([kind, label, where]) => ({ key: 'img_' + kind, label: `${label} (${where})`, type: 'photos', hint: r || kind !== 'overview' ? undefined : 'У выбранной модели картинки подставятся сами; свои — добавятся к ним' })),
        { section: 'Комплектность', tone: 'who', collapsed: true },
        { key: 'bom', label: 'Строками: обозначение | наименование | кол-во | ед. | примечание', type: 'textarea', wide: true, rows: 3, hint: 'Пусто — «И-1 | Изделие в сборе | 1 | шт.»' },
      ];
    },
    // поставщик по умолчанию — наша компания, у которой больше всего паспортов (у модели свой — подставится при выборе)
    initial: async () => ({ date: isoDay(), warrantyMonths: '12', supplierOrgId: (await facets()).suppliers[0]?.value || '' }),
    toInitial: (r) => ({ ...r, height: num(r.height), length: num(r.length), width: num(r.width), weight: num(r.weight), warrantyMonths: num(r.warrantyMonths ?? 12), bom: bomText(r.bom),
      ...Object.fromEntries(KINDS.map(([kind]) => ['img_' + kind, imgsOf(r, kind).filter((i) => i.url).map((i) => ({ id: String(i.photoId), url: i.url, thumb: i.url }))])) }),
    toBody: (v, r) => {
      const s = (x) => (x === null || x === undefined ? '' : String(x));
      const body = {
        name: s(v.name), category: s(v.category), article: s(v.article), materials: s(v.materials), installationMethod: s(v.installationMethod), purpose: s(v.purpose),
        customerName: s(v.customerName), orderNo: s(v.orderNo), objectName: s(v.objectName),
        ...(v.supplierOrgId ? { supplierOrgId: v.supplierOrgId } : {}),
        ...Object.fromEntries(['height', 'length', 'width', 'weight', 'warrantyMonths'].filter((k) => v[k] !== null && v[k] !== undefined).map((k) => [k, v[k]])),
      };
      body.description = s(v.description) || buildDescription(body);
      const bom = parseBom(v.bom);
      if (bom.length) body.bom = bom;
      const images = KINDS.flatMap(([kind]) => (v['img_' + kind] || []).map((photoId, k) => ({ kind, photoId, order: k })));
      if (images.length || r) body.images = images;
      if (!r && v.date) body.date = v.date;
      if (!r && v._copyFrom) body._copyFrom = v._copyFrom;
      return body;
    },
    create: async (body) => {
      const { _copyFrom, ...rest } = body;
      if (!_copyFrom) return api('/passports', { method: 'POST', body: rest });
      // модель выбрана: сервер берёт её поля и картинки; свои картинки добавляются к картинкам модели
      if (rest.images?.length) { const m = await api(`/passports/${_copyFrom}`); rest.images = [...imagesBody(m.images || []), ...rest.images]; }
      return api(`/passports/${_copyFrom}/copy`, { method: 'POST', body: rest });
    },
    update: (id, body) => api(`/passports/${id}`, { method: 'PATCH', body }),
  },

  remove: {
    text: (r) => `Удалить ${heading(r).toLowerCase()} (${r.name || 'без названия'}) в корзину? Номер не освободится — новый паспорт получит следующий.`,
    run: (r) => api(`/passports/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/passports/${r.id}/restore`, { method: 'POST' }),
  },

  searchRow: (r) => ({ title: `${heading(r)} · ${r.name || ''}`, sub: [date(r.date), r.customerName || r.objectName, r.warrantyCode].filter(Boolean).join(' · '), side: '' }),
  open: (id) => go('passports', { open: id }),
};

