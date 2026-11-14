import { api, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { KINDS, KINDS_V2, catNames } from '../../core/passport-kinds.js';
import { cachedFetch } from '../../core/cache.js';
import { hint, link, stack } from '../../ui/kit/index.js';

/** Общее для раздела «Паспорта»: категории, поля, статусы, справочники, комплектность (ПР-1: разрезан passports.js). */
/** 1 паспорт, 2 паспорта, 5 паспортов. */
export const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
/** Виды картинок: обязательные для типа паспорта — первыми (порядок справочника), остальные — как были. */
export const kinds = (r) => {
  const all = [...KINDS, ...KINDS_V2];
  const req = (r?.requiredImages || []).filter((k) => all.some(([x]) => x === k));
  return [...req.map((k) => all.find(([x]) => x === k)), ...all.filter(([x]) => !req.includes(x))];
};
export const isRequired = (r, kind) => (r?.requiredImages || []).includes(kind);
/** Типы, отложенные пользователем (2026-10-22: «детские пока не делаем») — в выборе не предлагаются. */
export const LATER_CATS = ['DIO', 'DSP'];
/** Типы паспорта v2 и подсказки норм (решения по умолчанию — TASKS БЗ-6). */
export const V2_CATS = [
  { value: '', label: 'Без типа' }, { value: 'TRN', label: 'Тренажёр' }, { value: 'WRK', label: 'Воркаут' },
  { value: 'DSP', label: 'Детское спортивное' }, { value: 'DIO', label: 'Детское игровое' }, { value: 'BLG', label: 'Благоустройство' },
];
export const V2_NUMS = [
  ['ageFrom', 'Возраст от, лет', ''], ['ageTo', 'Возраст до, лет', ''],
  ['heightMin', 'Рост пользователя от, мм', ''], ['heightMax', 'Рост до, мм', ''],
  ['weightMax', 'Вес пользователя до, кг', ''], ['maxUsers', 'Пользователей одновременно', ''],
  ['fallHeight', 'Высота свободного падения, мм', ''], ['siteLength', 'Площадка: длина, мм', 'С зоной безопасности'],
  ['siteWidth', 'Площадка: ширина, мм', ''], ['serviceLifeYears', 'Срок службы, лет', ''],
];
/** Метка пустой переменной «[{имя} не заполнено]» / «[{std:КОД} не найден]» → русскими словами: служебное имя на экран не идёт
 *  (сторож core/garbage.js иначе прячет весь пункт). Только показ; правка и сервер работают с исходным текстом. */
const BLANK_LABELS = { dimensions: 'габариты и вес', images: 'рисунки', materials: 'материалы', joints: 'конструкция', warrantyMonths: 'гарантия, мес.', name: 'наименование' };
export const humanBlanks = (s) => String(s ?? '').replace(/\[\{([^}]+)\} (не заполнено|не найден)\]/g, (_, k, w) =>
  `[${w}: ${k.startsWith('std:') ? 'норматив ' + k.slice(4) : (V2_NUMS.find((n) => n[0] === k)?.[1] || BLANK_LABELS[k] || 'значение').toLowerCase()}]`);
export const dictRows = async (key) => (await api(`/dicts/${key}`).catch(() => ({ items: [] }))).items || [];
/** Сотрудники (/dicts/persons) целиком, ответ кэшируется на минуту: форма изделия, проектирование, выдача делят один запрос. */
export const persons = () => cachedFetch('dicts:persons', 60000, () => api('/dicts/persons'));
const fio = (p) => [p.lastName, p.firstName, p.patronymic].filter(Boolean).join(' ') || p.name;
/** Сотрудники для выбора: { value: id, label: ФИО, sub: должность, fired }; уволенных отсеивает вызывающий. */
export const staffOptions = async () => ((await persons().catch(() => null))?.items || []).map((p) => ({ value: p.id, label: fio(p), name: p.name, sub: p.position || '', fired: p.status === 'fired' }));
/** Типы паспорта (без «ALL») для выбора: { value: код, label: название }; кэш — минута. */
export const passportCategoryOptions = async () => (await cachedFetch('dicts:passportCategories', 60000, () => dictRows('passportCategories')))
  .filter((c) => c.code && c.code !== 'ALL').map((c) => ({ value: String(c.code), label: c.name }));
export const codeList = (s) => String(s || '').split(/[,;\s]+/).filter(Boolean);
/** Записи справочника для выбора: cats — к каким типам паспорта относится (пусто — ко всем; ФП — фильтр по категории). */
export const dictOpts = async (key) => (await dictRows(key)).map((d) => ({ value: d.id, code: d.code, label: d.name, sub: catNames(d.categories), cats: codeList(d.categories), kind: d.kind || '' }));
/** Обязательные виды картинок категории — как на сервере (requiredImageKinds): по строке, «(если разборное)» — только у разборных; safety_zone = safety. */
export const reqKinds = (cat, isKit) => {
  const out = [];
  for (const line of String(cat?.requiredImages || '').split(/\r?\n/)) {
    if (/если разборн/i.test(line) && !isKit) continue;
    for (const k of line.replace(/\([^)]*\)/g, ' ').split(/[\s,;]+/).filter((x) => /^[a-z_]+$/.test(x))) { const kk = k === 'safety_zone' ? 'safety' : k; if (!out.includes(kk)) out.push(kk); }
  }
  return out;
};
/** ПК: настройки полей типа паспорта из справочника «Типы паспортов» — строки «ключ — текст» / «ключ». */
export const keyLines = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s+[—-]\s+/)[0].trim());
export const kvLines = (s) => Object.fromEntries(String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [k, ...v] = l.split(/\s+[—-]\s+/); return [k.trim(), v.join(' - ').trim()]; }).filter(([k, v]) => k && v));
export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const canEdit = () => ['admin', 'director'].includes(session.role) || session.user?.isOwner === true;
// Работа с паспортом изделия; общие тексты и настройки по-прежнему canEdit.
export const canWorkPassport = () => canEdit() || session.role === 'manager';
export const num = (v) => (v === undefined || v === null || v === '' ? '' : String(v).replace('.', ','));
export const dims = (r) => (r.height || r.length || r.width ? `${num(r.height) || '—'} × ${num(r.length) || '—'} × ${num(r.width) || '—'} мм` : '');
// НМ: статус паспорта — черновик (без номера) / выпущен / аннулирован; старый без статуса с номером — выпущен
export const statusOf = (r) => r?.status || (r?.passportNumber && !String(r.passportNumber).startsWith('draft-') ? 'issued' : 'draft');
export const isIssued = (r) => statusOf(r) === 'issued';
export const STATUS_LABEL = { draft: 'Черновик', issued: 'Выпущен', annulled: 'Аннулирован' };
export const statusBadge = (r) => h('span', { class: 'badge ' + ({ draft: 'warn', issued: 'ok', annulled: 'dim' }[statusOf(r)]) }, STATUS_LABEL[statusOf(r)]);
/** НМ-1: у выпущенного без «Новой редакции» меняются только эти поля (как на сервере, AFTER_PRINT_FIELDS). */
export const AFTER_PRINT = ['saleDate', 'customerName', 'customerOrgId', 'orderNo', 'salesOrderId', 'objectName', 'installedBy', 'installedAt', 'note'];
/** Номер для показа: у черновика — служебная метка draft-…, её не показываем. */
export const numberOf = (r) => (r?.passportNumber && !String(r.passportNumber).startsWith('draft-') ? r.passportNumber : '');
export const heading = (r) => (numberOf(r) ? `Паспорт № ${numberOf(r)}` : 'Паспорт — черновик');
let facetsCache = null; let facetsAt = 0;
export const facets = async () => {
  if (facetsCache && Date.now() - facetsAt < 60000) return facetsCache;
  facetsCache = await api('/passports/facets').catch(() => ({ years: [], categories: [], customers: [], suppliers: [] }));
  facetsAt = Date.now();
  return facetsCache;
};
/** Б2: числа фильтров при уже выбранном (воронка) — без кэша: ответ зависит от выбора. */
export const facetsFor = (q) => api('/passports/facets', { query: q }).catch(() => ({ years: [], months: [], categories: [], customers: [], suppliers: [] }));
let oursCache = null;
// SK-8d: наши компании — из /incomes/lookups (открыт всем); «Контрагенты» могут быть закрыты роли. Сбой — прежний /partners
export const ourCompanies = async () => (oursCache ??= await api('/incomes/lookups').then((r) => r.companies || [])
  .catch(() => api('/partners', { query: { type: 'our' } }).then((r) => r.items)).catch(() => []));
// C114: фирма выпуска — из заказа (companyId), иначе единственная / последняя использованная этим менеджером (общий ключ с воронкой)
const firmKey = () => 'dc-passport-firm-' + (session.user?.id || 'u');
export const lastFirm = () => { try { return localStorage.getItem(firmKey()) || ''; } catch { return ''; } };
export const rememberFirm = (id) => { try { if (id) localStorage.setItem(firmKey(), String(id)); } catch { /* приватный режим */ } };
export async function firmFor(salesOrderId) {
  const ours = (await ourCompanies().catch(() => [])).map((o) => ({ id: String(o.id), name: o.name || 'Фирма' }));
  let orderFirm = '';
  if (salesOrderId) { try { orderFirm = String((await api(`/salesorders/${salesOrderId}`))?.companyId || ''); } catch { orderFirm = ''; } }
  const byId = (id) => ours.find((f) => f.id === id);
  if (orderFirm && byId(orderFirm)) return { id: orderFirm, name: byId(orderFirm).name, from: 'order' };
  if (ours.length === 1) return { id: ours[0].id, name: ours[0].name, from: 'single' };
  const mem = lastFirm();
  if (mem && byId(mem)) return { id: mem, name: byId(mem).name, from: 'memory' };
  return { id: '', name: '', from: '' };
}
// ПК: категории каталога — из «Категорий каталога» справочника типов паспортов и встречавшихся в паспортах (вшитого списка нет)
export const categories = async () => { const [rows, f] = await Promise.all([dictRows('passportCategories'), facets()]); return [...new Set([...rows.flatMap((c) => String(c.catalogNames || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean)), ...f.categories.map((c) => c.value)])]; };
export const api_get = (p) => api(p);
export const api_post = (p, body) => api(p, { method: 'POST', body });
/** «<Наименование> (в дальнейшем именуемое «Изделие»), изготовленное из <материалы>. <Установка> <Назначение>» — как на сервере. */
export function buildDescription(v) {
  const t = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const sentence = (s) => (t(s) ? (/[.!?]$/.test(t(s)) ? t(s) : t(s) + '.') : '');
  const name = t(v.name).replace(/[.\s]+$/, '');
  if (!name) return '';
  const mat = t(v.materials).replace(/^изготовлен\S*\s+из\s+/i, '');
  return [`${name} (в дальнейшем именуемое «Изделие»)${mat ? ', изготовленное из ' + sentence(mat) : '.'}`, sentence(v.installationMethod), sentence(v.purpose)].filter(Boolean).join(' ');
}
// safety_zone (v2) показываем в «Зоне безопасности» (safety); без вида — в «Общем виде»
export const kindOf = (i) => (i.kind === 'safety_zone' ? 'safety' : i.kind || 'overview');
export const imgsOf = (r, kind) => (r.images || []).filter((i) => kindOf(i) === kind).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
/** Комплектность в форме — таблица (ui/rows-table.js) ↔ bom [{ pos, code, name, qty, unit, note }]. */
export const BOM_COLS = [
  { key: 'code', label: 'Обозначение', width: '16%', placeholder: 'И-1' },
  { key: 'name', label: 'Наименование', placeholder: 'Изделие в сборе' },
  { key: 'size', label: 'Размер, мм', width: '14%', placeholder: '1300 × 1300' },
  { key: 'qty', label: 'Кол-во', width: '10%', num: true, placeholder: '1' },
  { key: 'unit', label: 'Ед.', width: '9%', placeholder: 'шт.' },
  { key: 'note', label: 'Примечание', width: '16%' },
];
/** Пример строки для шаблона — по порядку BOM_COLS. */
export const BOM_EXAMPLE = ['И-1', 'Изделие в сборе', '', 1, 'шт.', ''];
export const bomRows = (bom) => (bom || []).map((b) => ({ code: b.code ?? '', name: b.name ?? '', size: b.size ?? '', qty: b.qty == null ? '' : num(b.qty), unit: b.unit ?? '', note: b.note ?? '' }));
/** Строки таблицы → bom. Размер партии (size) сохраняется; масса и фото строки, которых нет в таблице, берутся из прежней строки с тем же обозначением и наименованием. */
export const parseBom = (rows, prev = []) => {
  const old = new Map((prev || []).map((b) => [`${b.code || ''}|${b.name || ''}`, b]));
  return (rows || []).filter((b) => b.name || b.code).map((b, i) => {
    const was = old.get(`${b.code || ''}|${b.name || ''}`) || {};
    const size = String(b.size ?? '').trim();
    return {
      pos: i + 1, code: b.code || '', name: b.name || '', qty: Number(String(b.qty || '').replace(',', '.')) || 1, unit: b.unit || 'шт.',
      ...(b.note ? { note: b.note } : {}), ...(size ? { size } : {}),
      ...(was.mass != null ? { mass: was.mass } : {}), ...(was.photoId ? { photoId: was.photoId } : {}),
    };
  });
};

/** Ссылка в справочник: где задаётся тип паспорта (новая вкладка). */
export const groupHref = (groupId) => '#dicts?d=productGroups&of=dict' + (groupId ? '&open=' + encodeURIComponent(groupId) : '');

/**
 * C103: «Тип паспорта» только для чтения, с подписью, откуда он взят. Выбора здесь нет: тип задаётся в группе или в виде изделия.
 * name — название типа (пусто — не задан); from — «группа «…»» / «вид «…»» / «раздел «…»» (пусто и own=false — подпись не нужна);
 * own — тип записан в самом изделии (старые данные); onReset — снять своё («Брать из группы»).
 */
export function passportTypeLine({ name, from, own, groupId, onReset } = {}) {
  if (!name) {
    return stack(
      hint('Тип паспорта не задан. Он задаётся в группе изделия или в виде изделия — без него паспорт не собрать.', 'warn'),
      link({ label: 'Задать в группе ↗', href: groupHref(groupId), target: '_blank', title: 'Откроется группа изделий в справочнике' }),
    );
  }
  // «из …» — родительный падеж: источник приходит и как «вид «…»», и как «группа «…»» (сервер, ppInherited.via)
  const gen = String(from || '').replace(/^вида?\s/, 'вида ').replace(/^группа\s/, 'группы ').replace(/^раздел\s/, 'раздела ');
  const text = own ? `Тип паспорта: ${name} — своё у изделия` : `Тип паспорта: ${name}${gen ? ` — из ${gen}` : ''}`;
  // «Брать из группы» — ссылкой в той же строке (дизайнер C103: не ряд кнопок подвала)
  return own && onReset
    ? h('p', { class: 'hint' }, text, ' · ', link({ label: 'Брать из группы', title: 'Убрать своё значение у изделия: тип будет по группе или виду', onClick: onReset }))
    : hint(text);
}

/** C103: тип паспорта изделия по данным карточки (`r.passportCategory`): своё у изделия, из группы/вида/раздела, не задан. */
export function productTypeLine(r, { onReset } = {}) {
  const pc = r?.passportCategory;
  const lbl = (c) => (c ? String(c.name || c.code || '') : '');
  // группа: groupId (список) или categoryId — объект с id (карточка /showcase/:id) либо строка
  const cat = r?.categoryId;
  const groupId = r?.groupId || (cat && typeof cat === 'object' ? cat.id || cat._id : cat) || '';
  if (pc?.own) return passportTypeLine({ name: lbl(pc.own), own: true, groupId, onReset });
  const cur = pc?.inherited || (pc && pc.code ? pc : null);
  if (cur) return passportTypeLine({ name: lbl(cur), from: cur.via || '', groupId });
  return passportTypeLine({ groupId });
}

/** Состояние раздела между файлами: категория нового паспорта, черновик «Выпустить паспорт». */
export const st = { newCat: '', revisionFor: null, draft: null };
