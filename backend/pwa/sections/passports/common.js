import { api, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { KINDS, KINDS_V2, catNames } from '../../core/passport-kinds.js';

/** Общее для раздела «Паспорта»: категории, поля, статусы, справочники, комплектность (ПР-1: разрезан passports.js). */
/** 1 паспорт, 2 паспорта, 5 паспортов. */
export const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
/** Виды картинок: обязательные для категории паспорта — первыми (порядок справочника), остальные — как были. */
export const kinds = (r) => {
  const all = [...KINDS, ...KINDS_V2];
  const req = (r?.requiredImages || []).filter((k) => all.some(([x]) => x === k));
  return [...req.map((k) => all.find(([x]) => x === k)), ...all.filter(([x]) => !req.includes(x))];
};
export const isRequired = (r, kind) => (r?.requiredImages || []).includes(kind);
/** Категории, отложенные пользователем (2026-10-22: «детские пока не делаем») — в выборе не предлагаются. */
export const LATER_CATS = ['DIO', 'DSP'];
/** Категории паспорта v2 и подсказки норм (решения по умолчанию — TASKS БЗ-6). */
export const V2_CATS = [
  { value: '', label: 'Без категории' }, { value: 'TRN', label: 'Тренажёр' }, { value: 'WRK', label: 'Воркаут' },
  { value: 'DSP', label: 'Детское спортивное' }, { value: 'DIO', label: 'Детское игровое' }, { value: 'BLG', label: 'Благоустройство' },
];
export const V2_NUMS = [
  ['ageFrom', 'Возраст от, лет', ''], ['ageTo', 'Возраст до, лет', ''],
  ['heightMin', 'Рост пользователя от, мм', ''], ['heightMax', 'Рост до, мм', ''],
  ['weightMax', 'Вес пользователя до, кг', ''], ['maxUsers', 'Пользователей одновременно', ''],
  ['fallHeight', 'Высота свободного падения, мм', ''], ['siteLength', 'Площадка: длина, мм', 'С зоной безопасности'],
  ['siteWidth', 'Площадка: ширина, мм', ''], ['serviceLifeYears', 'Срок службы, лет', ''],
];
export const dictRows = async (key) => (await api(`/dicts/${key}`).catch(() => ({ items: [] }))).items || [];
export const codeList = (s) => String(s || '').split(/[,;\s]+/).filter(Boolean);
/** Записи справочника для выбора: cats — к каким категориям паспорта относится (пусто — ко всем; ФП — фильтр по категории). */
export const dictOpts = async (key) => (await dictRows(key)).map((d) => ({ value: d.id, code: d.code, label: d.name, sub: catNames(d.categories), cats: codeList(d.categories) }));
/** Обязательные виды картинок категории — как на сервере (requiredImageKinds): по строке, «(если разборное)» — только у разборных; safety_zone = safety. */
export const reqKinds = (cat, isKit) => {
  const out = [];
  for (const line of String(cat?.requiredImages || '').split(/\r?\n/)) {
    if (/если разборн/i.test(line) && !isKit) continue;
    for (const k of line.replace(/\([^)]*\)/g, ' ').split(/[\s,;]+/).filter((x) => /^[a-z_]+$/.test(x))) { const kk = k === 'safety_zone' ? 'safety' : k; if (!out.includes(kk)) out.push(kk); }
  }
  return out;
};
/** ПК: настройки полей категории из справочника «Категории паспортов» — строки «ключ — текст» / «ключ». */
export const keyLines = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s+[—-]\s+/)[0].trim());
export const kvLines = (s) => Object.fromEntries(String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [k, ...v] = l.split(/\s+[—-]\s+/); return [k.trim(), v.join(' - ').trim()]; }).filter(([k, v]) => k && v));
export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const canEdit = () => ['admin', 'director'].includes(session.role) || session.user?.isOwner === true;
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
let oursCache = null;
// SK-8d: наши компании — из /incomes/lookups (открыт всем); «Контрагенты» могут быть закрыты роли. Сбой — прежний /partners
export const ourCompanies = async () => (oursCache ??= await api('/incomes/lookups').then((r) => r.companies || [])
  .catch(() => api('/partners', { query: { type: 'our' } }).then((r) => r.items)).catch(() => []));
// ПК: категории каталога — из «Категорий каталога» справочника категорий паспортов и встречавшихся в паспортах (вшитого списка нет)
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
  { key: 'qty', label: 'Кол-во', width: '11%', num: true, placeholder: '1' },
  { key: 'unit', label: 'Ед.', width: '10%', placeholder: 'шт.' },
  { key: 'note', label: 'Примечание', width: '20%' },
];
export const bomRows = (bom) => (bom || []).map((b) => ({ code: b.code ?? '', name: b.name ?? '', qty: b.qty == null ? '' : num(b.qty), unit: b.unit ?? '', note: b.note ?? '' }));
export const parseBom = (rows) => (rows || []).filter((b) => b.name || b.code).map((b, i) => ({
  pos: i + 1, code: b.code || '', name: b.name || '', qty: Number(String(b.qty || '').replace(',', '.')) || 1, unit: b.unit || 'шт.', ...(b.note ? { note: b.note } : {}) }));

/** Состояние раздела между файлами: категория нового паспорта, паспорт «Новая редакция», черновик «Выпустить паспорт». */
export const st = { newCat: '', revisionFor: null, draft: null };
