import { FULL_KINDS, kindName, kindNorm } from '../../../core/passport-kinds.js';
import { jointsText } from '../traits.js';

/** Куда в форме встаёт рисунок (те же разделы, что в паспорте). */
export const PLACE = {
  overview: 'general',
  dimensions: 'dims', view_front: 'dims', view_side: 'dims', view_top: 'dims', view_3d: 'dims',
  overview_callouts: 'struct', nameplate: 'struct',
  mounting: 'install', foundation: 'install', holes: 'install', safety: 'install',
  assembly: 'assembly',
};
export const SECTIONS = [
  ['general', 'Общие сведения'],
  ['purpose', 'Назначение и элементы'],
  ['dims', 'Габариты и виды'],
  ['struct', 'Конструкция и материалы'],
  ['install', 'Установка'],
  ['assembly', 'Сборка'],
  ['ops', 'Эксплуатация и гарантия'],
  ['other', 'Другие тексты'],
];
/** Числа паспорта в разделе «Эксплуатация». maxUsers — в «Общих сведениях». */
export const OPS = [
  ['serviceLifeYears', 'Срок службы', 'лет'],
  ['warrantyMonths', 'Гарантия', 'мес.'],
  ['ageFrom', 'Возраст от', 'лет'],
  ['ageTo', 'Возраст до', 'лет'],
  ['heightMin', 'Рост от', 'мм'],
  ['heightMax', 'Рост до', 'мм'],
  ['weightMax', 'Вес пользователя до', 'кг'],
  ['fallHeight', 'Высота падения', 'мм'],
  ['siteLength', 'Площадка: длина', 'мм'],
  ['siteWidth', 'Площадка: ширина', 'мм'],
];
const OPS_KEYS = new Set(OPS.map(([k]) => k));

export const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && String(v).trim() !== '' ? n : null;
};
export const imageKind = (m) => kindNorm(String(m?.key || '').replace(/^img_/, ''));
export const gapLabel = (m) => (m?.kind === 'image' || String(m?.key || '').startsWith('img_') ? kindName(imageKind(m)) : (m?.label || m?.key || 'поле'));

/** Раздел формы для пункта A3. */
export function gapSection(m) {
  const key = String(m?.key || '');
  if (m?.kind === 'image' || key.startsWith('img_')) return PLACE[imageKind(m)] || 'other';
  if (m?.kind === 'elements' || key === 'elements') return 'purpose';
  if (m?.kind === 'install' || key === 'installationTypeId' || key === 'installationMethod') return 'install';
  if (key === 'height' || key === 'weight' || key === 'weightKg') return 'dims';
  if (key === 'joints' || key === 'materials' || key === 'materialIds') return 'struct';
  if (key === 'maxUsers' || m?.kind === 'facet' || m?.kind === 'category') return 'general';
  if (OPS_KEYS.has(key)) return 'ops';
  return 'other';
}

/** Корень справочника текстов → раздел формы (по коду раздела или по названию). */
export function boxOf(s) {
  const name = s?.name || '';
  const sec = s?.section || '';
  if (sec === 'purpose' || /назначен/i.test(name)) return 'purpose';
  if (sec === 'installation' || sec === 'mounting' || /установ|монтаж/i.test(name)) return 'install';
  if (sec === 'assembly' || /сборк/i.test(name)) return 'assembly';
  if (/гарант|эксплуатац|уход|осмотр|обслужив|хранен/i.test(name) || ['warranty', 'maintenance', 'service', 'care'].includes(sec)) return 'ops';
  return 'other';
}

const STEMS = [/анкер/i, /бетон/i, /заклад/i, /свобод|без креп/i];
const stemOf = (s) => STEMS.findIndex((re) => re.test(String(s || '')));
/** Способ установки по варианту текста: привязка справочника, иначе по слову в названии. */
export function typeOfLeaf(leaf, instOpts) {
  if (!leaf) return '';
  if (leaf.installTypeId) return String(leaf.installTypeId);
  const i = stemOf(leaf.name);
  return i < 0 ? '' : (instOpts.find(([, n]) => stemOf(n) === i)?.[0] || '');
}

const pd = (p) => p.passportDefaults || {};
export function dimText(p) {
  const d = p.dimensions;
  return d?.length && d?.width && d?.height ? `${d.length}×${d.width}×${d.height} мм` : '';
}
export function matText(p) {
  const n = p.materialsSpec?.rows?.length || 0;
  const coat = (p.materialsSpec?.coatingIds || []).length;
  return n || coat ? `${n} строк${coat ? ', покрытие задано' : ''}` : '';
}
export function elText(p, names) {
  const ids = (pd(p).elements || []).map(String);
  return ids.length ? ids.map((id) => names.get(id) || 'элемент').join(', ') : '';
}
export function instText(p, names) {
  const id = String(pd(p).installationTypeId || '');
  return id ? (names.get(id) || 'выбран') : '';
}
export function opText(p, key, unit) {
  const v = pd(p)[key];
  if (v == null || v === '') return '';
  return unit ? `${v} ${unit}` : String(v);
}
export function jointsLine(p) { return jointsText(pd(p).joints); }
/** Пусто, пока человек сам не выбрал. false — «Цельное», не подстановка. */
export function kitText(p) {
  const v = pd(p).isKit;
  if (v === true) return 'Разобранное';
  if (v === false) return 'Цельное';
  return '';
}

/** Какие виды рисунков показать: пустые из A3, уже загруженные, в «Полном» — ещё виды только полного варианта. */
export function slotKinds(asked, byKind, full, kit) {
  const kinds = new Set([...asked, ...byKind.keys()]);
  if (full) for (const k of FULL_KINDS) if (PLACE[k]) kinds.add(k);
  if (kit) kinds.add('assembly');
  for (const k of [...kinds]) {
    if (!PLACE[k]) kinds.delete(k);
    else if (!full && FULL_KINDS.has(k) && !asked.has(k) && !byKind.has(k)) kinds.delete(k);
    else if (k === 'assembly' && !kit && !asked.has(k) && !byKind.has(k)) kinds.delete(k);
  }
  return [...kinds];
}
