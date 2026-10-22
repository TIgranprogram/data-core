import { api, apiFile, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { normSearch } from '../core/facets.js';
import { date, isoDay } from '../core/format.js';
import { current, go, patch } from '../core/router.js';
import { photoDrop } from '../ui/photos.js';
import { rowsTable } from '../ui/rows-table.js';
import { tagPick } from '../ui/tag-pick.js';
import { flag } from '../core/flags.js';
import { toast, toastError } from '../ui/toast.js';
import { confirmDlg } from '../ui/dialog.js';

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
/** Виды картинок паспорта v2 (БЗ-6 §3.6) — в форме и карточке только при флаге passports.v2. */
const KINDS_V2 = [
  ['overview_callouts', 'Общий вид с выносками', 'раздел «Описание»'],
  ['nameplate', 'Место таблички', 'раздел «Описание»'],
  ['foundation', 'Схема фундамента / опор', 'приложение «Установка»'],
  ['holes', 'Схема скважин / разметки', 'приложение «Установка»'],
  ['assembly', 'Сборка', 'приложение «Инструкция по сборке»'],
];
let V2 = false;
flag('passports.v2').then((v) => { V2 = v; });
const kinds = () => (V2 ? [...KINDS, ...KINDS_V2] : KINDS);
/** Категории паспорта v2 и подсказки норм (решения по умолчанию — TASKS БЗ-6). */
const V2_CATS = [
  { value: '', label: 'Без категории (как раньше)' }, { value: 'TRN', label: 'Тренажёр' }, { value: 'WRK', label: 'Воркаут' },
  { value: 'DSP', label: 'Детское спортивное' }, { value: 'DIO', label: 'Детское игровое' }, { value: 'MAF', label: 'МАФ' },
];
const V2_NUMS = [
  ['ageFrom', 'Возраст от, лет', 'Детское: от 3 (игровое), от 7 (спортивное)'], ['ageTo', 'Возраст до, лет', ''],
  ['heightMin', 'Рост пользователя от, мм', 'Тренажёр: обычно от 1400'], ['heightMax', 'Рост до, мм', ''],
  ['weightMax', 'Вес пользователя до, кг', 'Тренажёр: обычно до 120–150'], ['maxUsers', 'Пользователей одновременно', ''],
  ['fallHeight', 'Высота свободного падения, мм', 'Детское игровое'], ['siteLength', 'Площадка: длина, мм', 'С зоной безопасности'],
  ['siteWidth', 'Площадка: ширина, мм', ''], ['serviceLifeYears', 'Срок службы, лет', 'По умолчанию: 10, МАФ — 5'],
];
const dictOpts = async (key) => ((await api(`/dicts/${key}`).catch(() => ({ items: [] }))).items || []).map((d) => ({ value: d.id, label: d.name, sub: d.categories || '' }));
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
    productId: r.productId || null,
    label: r.name, cat: r.category || '', pic: r.thumb ? PREFIX + r.thumb : null,
    sub: [r.article && 'арт. ' + r.article, dims(r), r.weight && num(r.weight) + ' кг', `${r.n} ${r.n % 10 === 1 && r.n % 100 !== 11 ? 'паспорт' : 'паспорт.'}`, (r.images || []).length ? `картинок ${(r.images || []).length}` : 'без картинок'].filter(Boolean).join(' · '),
    search: normSearch([r.name, r.article, r.category].filter(Boolean).join(' ')),
    values: { _copyFrom: r.id, name: r.name, category: r.category || '', article: r.article || '', height: num(r.height), length: num(r.length), width: num(r.width), weight: num(r.weight),
      materials: r.materials || '', installationMethod: r.installationMethod || '', purpose: r.purpose || '', description: r.description || '', supplierOrgId: r.supplierOrgId || '', warrantyMonths: num(r.warrantyMonths ?? 12),
      bom: JSON.stringify(bomRows(r.bom)) },
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
    cat: '', search: normSearch([o.orderNo, o.customer, o.title].filter(Boolean).join(' ')), values: { orderNo: o.orderNo, customerName: o.customer || '', salesOrderId: o.id } }));
}

/**
 * «Выпустить паспорт» из изделия или позиции заказа (БЗ-5): открывает «Новый паспорт» в правой панели. Модель ищется
 * по ссылке на изделие, затем по артикулу, затем по названию — подставляются её поля и картинки; номер и талон — сервер.
 * Возвращает true, если модель нашлась.
 */
let draft = null;
export async function issuePassport({ productId, name, article, orderNo, salesOrderId, customerName }) {
  const all = await models().catch(() => []);
  const n = (s) => normSearch(s || '');
  const m = (productId && all.find((x) => x.productId === productId))
    || (article && all.find((x) => x.values.article && n(x.values.article) === n(article)))
    || (name && all.find((x) => n(x.values.name) === n(name)));
  // значения паспорта по умолчанию у изделия каталога (БЗ-6 Э4b) — поверх полей модели; форма v1 берёт только свои поля
  const defaults = productId ? (await api(`/showcase/${productId}`).catch(() => null))?.passportDefaults || {} : {};
  draft = { ...(m ? m.values : { name: name || '', article: article || '' }), ...defaults, productId, salesOrderId, orderNo, customerName };
  patch({ of: 'passports', new: '1', open: undefined });
  return !!m;
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
  // «с печатью»: нет печати/подписи у поставщика — предупредить, а не молча отдать PDF без них (БЗ-6 ЭФ6)
  if (query.stamp) {
    const o = r.supplierOrg;
    const lack = !o ? ['поставщик не выбран'] : [!o.hasSeal && 'печать', !o.hasSignature && 'подпись'].filter(Boolean);
    if (lack.length && !(await confirmDlg('Нет печати или подписи', o
      ? `У «${o.name}» не загружены: ${lack.join(', ')}. PDF будет без них. Загрузить: «Контрагенты → Наши компании → карточка → Печать и подпись».`
      : 'В паспорте не выбран поставщик (наша компания) — печати и подписи не будет. Выберите его в «Изменить».', { okText: 'Скачать без них' }))) return;
  }
  try { toast(`Готовлю ${what}…`); const name = await apiFile(`/passports/${r.id}/pdf`, { query, fallback: `Паспорт_${r.passportNumber}.pdf` }); toast(`Скачан: ${name}`); } catch (e) { toastError(e); }
}

/** Картинки по видам в карточке: миниатюры (клик — открыть, × — убрать) и своя зона «перетащите / Ctrl+V» у каждого вида. */
function imagesBlock(r, ctx) {
  const save = async (images) => {
    try { ctx.setRow(await api(`/passports/${r.id}`, { method: 'PATCH', body: { images: imagesBody(images) } }).then(() => api(`/passports/${r.id}`))); } catch (e) { toastError(e); }
  };
  return h('div', { class: 'pp-images' }, h('div', { class: 'section-title' }, 'Картинки паспорта'),
    ...kinds().map(([kind, label, where]) => {
      const list = imgsOf(r, kind);
      return h('div', { class: 'pp-kind', 'data-kind': kind },
        h('div', { class: 'pp-kind-head' }, h('b', null, label), h('span', { class: 'muted' }, ` · ${where}${list.length ? ' · ' + list.length : ''}`)),
        list.length ? h('div', { class: 'pf-strip' }, ...list.map((i) => h('div', { class: 'pf-item' },
          i.url ? h('img', { src: PREFIX + i.url, alt: '', title: i.caption || 'Открыть', onclick: () => window.open(PREFIX + i.url, '_blank') }) : h('span', { class: 'muted' }, 'нет файла'),
          canEdit() ? h('button', { type: 'button', class: 'pf-del', title: 'Убрать картинку', 'aria-label': 'Убрать картинку', onclick: () => save((r.images || []).filter((x) => x !== i)) }, '×') : null))) : null,
        canEdit() ? photoDrop({ attach: async (photoId) => { r.images = [...(r.images || []), { kind, photoId, order: list.length }]; return r; }, done: () => save(r.images) }) : null);
    }));
}

/** Паспорт v2 (БЗ-6 Э5a2): «Проверка» — чего не хватает; у рисунка — «Загрузить» (переход к его зоне загрузки ниже). */
const IMG_BY_LABEL = { 'Общий вид': 'overview', 'Габариты': 'dimensions', 'Зона безопасности': 'safety', 'Схема фундамента': 'foundation', 'Схема скважин': 'holes', 'Схема сборки': 'assembly', 'Общий вид с выносками': 'overview_callouts', 'Табличка': 'nameplate' };
function checkBlock(r) {
  const miss = r.missing || [];
  const warn = r.standardWarnings || [];
  if (!miss.length && !warn.length) return h('div', null, h('div', { class: 'section-title' }, 'Проверка'), h('p', { class: 'muted' }, 'Всё заполнено — паспорт можно выдавать.'));
  const goTo = (kind) => {
    const zone = document.querySelector(`.pp-kind[data-kind="${kind}"]`);
    if (!zone) return;
    zone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    zone.classList.add('fill-here'); setTimeout(() => zone.classList.remove('fill-here'), 2500);
  };
  return h('div', null, h('div', { class: 'section-title' }, `Проверка — не хватает: ${miss.length}`),
    h('ul', { class: 'timeline pp-check' }, ...miss.map((m) => {
      const img = m.startsWith('Рисунок: ') || m === 'Общий вид' ? IMG_BY_LABEL[m.replace(/^Рисунок: /, '')] : null;
      return h('li', null, m, img && canEdit() ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => goTo(img) }, 'Загрузить') : null);
    }),
    ...warn.map((w) => h('li', { class: 'muted' }, 'Норматив — ' + w))));
}

/** Таблица ТО одного периода: что проверить · где · мера. */
function periodBlock(m) {
  const row = (x) => h('li', null, x.what, h('span', { class: 'muted' }, [x.where, x.measure].filter(Boolean).map((v) => ' · ' + v).join('')));
  return h('div', null, h('b', null, m.period), h('ul', null, ...m.rows.map(row)));
}

/** Паспорт v2: текст из снимка (как будет в паспорте) и «Обновить текст по справочникам» (новый снимок). */
function previewBlock(r, ctx) {
  const t = r.textSnapshot;
  const refresh = canEdit() ? h('button', { type: 'button', class: 'btn btn-sm', title: 'Собрать текст заново по справочникам и шаблону категории (выданный текст заменится)', onclick: async (e) => {
    e.target.disabled = true; e.target.textContent = 'Собираю…';
    try { await api(`/passports/${r.id}/snapshot`, { method: 'POST' }); ctx.setRow(await api(`/passports/${r.id}`)); toast('Текст паспорта собран заново'); } catch (err) { toastError(err); e.target.disabled = false; e.target.textContent = 'Обновить текст по справочникам'; }
  } }, 'Обновить текст по справочникам') : null;
  if (!t) return h('div', null, h('div', { class: 'section-title' }, 'Текст паспорта'), h('p', { class: 'muted' }, 'Текст ещё не собран. '), refresh);
  const part = (title, body) => (body ? h('details', { class: 'month-group' }, h('summary', null, title), body) : null);
  return h('div', null, h('div', { class: 'section-title' }, 'Текст паспорта'),
    h('p', { class: 'muted' }, `Собран ${t.at ? date(t.at) : ''} · шаблон v${t.templateVersion ?? 0}${t.ownVersion != null ? ' + версия категории v' + t.ownVersion : ''}${t.missing?.length ? ' · в тексте не заполнено: ' + t.missing.join(', ') : ''}`),
    part('Описание и назначение', t.description || t.purpose ? h('div', null, t.description ? h('p', null, t.description) : null, t.purpose ? h('p', null, t.purpose) : null) : null),
    part(`Правила пользования (${(t.rules || []).length})`, t.rules?.length ? h('ol', null, ...t.rules.map((x) => h('li', null, x))) : null),
    part('Обслуживание по периодам', t.maintenance?.length ? h('div', null, ...t.maintenance.map(periodBlock)) : null),
    part('Монтаж', t.install?.text ? h('p', null, t.install.text) : null),
    ...(t.sections || []).map((s) => part(`${s.number} ${s.title}`, h('div', null, ...s.items.map((i) => h('p', null, i.number ? h('b', null, i.number + ' ') : '— ', i.text))))),
    refresh);
}

function bomBlock(r) {
  const rows = r.bom?.length ? r.bom : [{ pos: 1, code: 'И-1', name: 'Изделие в сборе', qty: 1, unit: 'шт.' }];
  return h('div', null, h('div', { class: 'section-title' }, 'Комплектность (приложение)'),
    h('table', { class: 'so-lines' }, h('thead', null, h('tr', null, ...['Поз.', 'Обозначение', 'Наименование', 'Кол-во', 'Ед.', 'Примечание'].map((x) => h('th', null, x)))),
      h('tbody', null, ...rows.map((b) => h('tr', null, h('td', null, b.pos ?? ''), h('td', null, b.code ?? ''), h('td', null, b.name ?? ''), h('td', { class: 'num' }, b.qty ?? ''), h('td', null, b.unit ?? ''), h('td', { class: 'muted' }, b.note ?? ''))))));
}

/** Комплектность в форме — таблица (ui/rows-table.js) ↔ bom [{ pos, code, name, qty, unit, note }]. */
const BOM_COLS = [
  { key: 'code', label: 'Обозначение', width: '16%', placeholder: 'И-1' },
  { key: 'name', label: 'Наименование', placeholder: 'Изделие в сборе' },
  { key: 'qty', label: 'Кол-во', width: '11%', num: true, placeholder: '1' },
  { key: 'unit', label: 'Ед.', width: '10%', placeholder: 'шт.' },
  { key: 'note', label: 'Примечание', width: '20%' },
];
const bomRows = (bom) => (bom || []).map((b) => ({ code: b.code ?? '', name: b.name ?? '', qty: b.qty == null ? '' : num(b.qty), unit: b.unit ?? '', note: b.note ?? '' }));
const parseBom = (rows) => (rows || []).filter((b) => b.name || b.code).map((b, i) => ({
  pos: i + 1, code: b.code || '', name: b.name || '', qty: Number(String(b.qty || '').replace(',', '.')) || 1, unit: b.unit || 'шт.', ...(b.note ? { note: b.note } : {}) }));

/** Параметры фильтров списка из адреса — для «PDF пакетом». */
function listQuery() {
  const p = current().params || {};
  const q = { search: p.q, year: p.year, month: p.month, category: p.category, supplierOrgId: p.supplierOrgId, customer: p.customer };
  if (p.state === 'incomplete') q.incomplete = 1;
  if (p.state === 'noImages') q.noImages = 1;
  return q;
}

/** Паспорт v2 (БЗ-6 Э5a1): поля формы ↔ тело запроса. */
function v2Initial(r) {
  return {
    passportCategory: r.passportCategory || '', elements: (r.elements || []).map(String), materialIds: (r.materialIds || []).map(String),
    installationTypeId: r.installationTypeId ? String(r.installationTypeId) : '', isKit: r.isKit ? 'yes' : 'no',
    ...Object.fromEntries(V2_NUMS.map(([k]) => [k, num(r[k])])),
  };
}
function v2Body(v) {
  const b = {
    elements: Array.isArray(v.elements) ? v.elements : [], materialIds: Array.isArray(v.materialIds) ? v.materialIds : [],
    isKit: v.isKit === 'yes',
    ...Object.fromEntries(V2_NUMS.filter(([k]) => v[k] !== null && v[k] !== undefined && v[k] !== '').map(([k]) => [k, v[k]])),
  };
  if (v.passportCategory) b.passportCategory = v.passportCategory;
  if (v.installationTypeId) b.installationTypeId = v.installationTypeId;
  return b;
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
      ['Заметки', r.note],
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
      V2 && r.passportCategory ? checkBlock(r) : (r.missing?.length ? h('div', { class: 'fill-note' }, 'Не хватает для выдачи: ', h('b', null, r.missing.join(', '))) : null),
      imagesBlock(r, ctx), bomBlock(r),
      V2 && r.passportCategory ? previewBlock(r, ctx) : null),
  },

  form: {
    fields: async (r) => {
      const [cats, ours, f, v2] = await Promise.all([categories(), ourCompanies(), facets(), flag('passports.v2')]);
      V2 = v2;
      const [els, mats, inst] = v2 ? await Promise.all([dictOpts('passportElements'), dictOpts('passportMaterials'), dictOpts('passportInstall')]) : [[], [], []];
      const v2Fields = !v2 ? [] : [
        { section: 'Паспорт v2: категория и состав', tone: 'main', collapsed: !!r && !r.passportCategory },
        { key: 'passportCategory', label: 'Категория паспорта', type: 'segment', options: V2_CATS, wide: true, hint: 'От категории зависят разделы, нормативы и обязательные рисунки' },
        { key: 'elements', label: 'Функциональные элементы', type: 'widget', wide: true, widget: (v) => tagPick({ options: els, value: v }) },
        { key: 'materialIds', label: 'Материалы', type: 'widget', wide: true, widget: (v) => tagPick({ options: mats, value: v }) },
        { key: 'installationTypeId', label: 'Способ установки', type: 'select', options: [{ value: '', label: '—' }, ...inst.map((o) => ({ value: o.value, label: o.label }))] },
        { key: 'isKit', label: 'Поставляется разобранным', type: 'segment', options: [{ value: 'no', label: 'Нет' }, { value: 'yes', label: 'Да — нужна схема сборки' }] },
        { section: 'Ограничения и техданные', tone: 'info', collapsed: !!r && !r.passportCategory },
        ...V2_NUMS.map(([key, label, hint]) => ({ key, label, type: 'number', min: 0, span: 1, hint: hint || undefined })),
      ];
      return [
        { section: 'Изделие (модель)', tone: 'main', fixed: true },
        { key: '_copyFrom', type: 'hidden' }, { key: 'productId', type: 'hidden' }, { key: 'salesOrderId', type: 'hidden' },
        { key: 'name', label: 'Наименование', required: true, wide: true, max: 500,
          hint: r ? undefined : 'Начните печатать и выберите модель — подставятся габариты, материалы, описание и картинки',
          suggest: r ? undefined : models, suggestTitle: 'Модели: выберите — подставится всё, кроме заказчика и даты', suggestFocus: 'customerName' },
        { key: 'category', label: 'Категория', type: 'select', options: cats },
        { key: 'article', label: 'Артикул', max: 50 },
        { key: 'height', label: 'Высота, мм', type: 'number', min: 0, span: 1 },
        { key: 'length', label: 'Длина, мм', type: 'number', min: 0, span: 1 },
        { key: 'width', label: 'Ширина, мм', type: 'number', min: 0, span: 1 },
        { key: 'weight', label: 'Вес, кг', type: 'number', min: 0, span: 1 },
        ...v2Fields,
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
        ...kinds().map(([kind, label, where]) => ({ key: 'img_' + kind, label: `${label} (${where})`, type: 'photos', hint: r || kind !== 'overview' ? undefined : 'У выбранной модели картинки подставятся сами; свои — добавятся к ним' })),
        { section: 'Комплектность и заметки', tone: 'who', collapsed: true },
        { key: 'bom', label: 'Комплектность изделия (таблица 5)', type: 'widget', wide: true,
          widget: (v) => rowsTable({ columns: BOM_COLS, rows: v, file: 'Шаблон комплектности', example: ['И-1', 'Изделие в сборе', 1, 'шт.', ''] }),
          hint: 'Пусто — «И-1 · Изделие в сборе · 1 шт.». Можно вставить строки из Excel (Ctrl+V в ячейку) или загрузить заполненный шаблон' },
        { key: 'note', label: 'Заметки', type: 'textarea', wide: true, rows: 3, max: 4000, hint: 'Попадут в паспорт на лист «Для заметок»; пусто — листа не будет' },
      ];
    },
    // поставщик по умолчанию — наша компания, у которой больше всего паспортов (у модели свой — подставится при выборе)
    // черновик «Выпустить паспорт» (issuePassport) — поверх, пустые значения не затирают умолчания
    initial: async () => {
      const d = draft; draft = null;
      return { date: isoDay(), warrantyMonths: '12', supplierOrgId: (await facets()).suppliers[0]?.value || '',
        ...Object.fromEntries(Object.entries(d || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined)) };
    },
    toInitial: (r) => ({ ...r, height: num(r.height), length: num(r.length), width: num(r.width), weight: num(r.weight), warrantyMonths: num(r.warrantyMonths ?? 12), bom: bomRows(r.bom),
      ...v2Initial(r),
      ...Object.fromEntries(kinds().map(([kind]) => ['img_' + kind, imgsOf(r, kind).filter((i) => i.url).map((i) => ({ id: String(i.photoId), url: i.url, thumb: i.url }))])) }),
    toBody: (v, r) => {
      const s = (x) => (x === null || x === undefined ? '' : String(x));
      const body = {
        name: s(v.name), category: s(v.category), article: s(v.article), materials: s(v.materials), installationMethod: s(v.installationMethod), purpose: s(v.purpose),
        customerName: s(v.customerName), orderNo: s(v.orderNo), objectName: s(v.objectName), note: s(v.note),
        ...(v.supplierOrgId ? { supplierOrgId: v.supplierOrgId } : {}),
        ...Object.fromEntries(['height', 'length', 'width', 'weight', 'warrantyMonths'].filter((k) => v[k] !== null && v[k] !== undefined).map((k) => [k, v[k]])),
      };
      body.description = s(v.description) || buildDescription(body);
      const bom = parseBom(v.bom);
      if (bom.length || r) body.bom = bom;
      const shown = new Set(kinds().map(([k]) => k));
      // виды, которых нет в форме (v2-картинки при выключенном флаге), сохраняются как были
      const kept = imagesBody((r?.images || []).filter((i) => !shown.has(i.kind)));
      const images = [...kinds().flatMap(([kind]) => (v['img_' + kind] || []).map((photoId, k) => ({ kind, photoId, order: k }))), ...kept];
      if (V2) Object.assign(body, v2Body(v));
      if (images.length || r) body.images = images;
      if (!r && v.date) body.date = v.date;
      if (!r && v._copyFrom) body._copyFrom = v._copyFrom;
      if (!r && v.productId) body.productId = v.productId;
      if (!r && v.salesOrderId) body.salesOrderId = v.salesOrderId;
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

