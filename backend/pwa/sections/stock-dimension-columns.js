import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { badge } from '../ui/kit/index.js';
import { stockPositionCode, stockPositionName } from '../core/stock-display.js';

export const dimensionValue = value => Number(value) > 0 ? qty(value) : '—';
export const washValue = item => item.washed == null ? 'Не указано' : item.washed ? 'Мытая' : 'Не мытая';
export const stockZero = item => Number(item.quantity) === 0;
export const inlineCountAllowed = item => item.countMode === 'single';
export const stockCountRestriction = item => inlineCountAllowed(item) ? '' : item.countMode === 'multiple'
  ? 'Несколько мест хранения — пересчёт общего остатка недоступен'
  : 'Способ пересчёта не подтверждён — общий остаток доступен только для просмотра';
/** Общее количество нескольких ячеек нельзя пересчитывать как одну storageitem. */
export function stockCountCell(item, control) {
  const reason = stockCountRestriction(item);
  return reason ? h('div', { title: reason }, control, h('div', { class: 'muted small' }, reason)) : control;
}
export const materialValue = item => /^(?:нержавеющая|оцинкованная) сталь$|^алюминий$|^сталь$/i.test(item.materialGrade || '') ? item.materialGrade : 'Не указан';
export const gradeValue = item => materialValue(item) === item.materialGrade ? 'Не указана' : item.materialGrade || 'Не указана';
export function sectionValue(item) {
  const profile = item.sectionProfile;
  if (!profile) return item.metal === 'pipe' ? 'Уточнить размеры' : '—';
  const state = { incomplete: 'Уточнить размеры', conflict: 'Данные расходятся', unknown: 'Уточнить размеры' }[profile.state];
  return h('span', null, profile.label || '—', state ? h('span', { class: 'muted small' }, ' · ' + state) : null);
}
export const stockAvailability = item => stockZero(item) ? badge('Нет в наличии', 'dim') : item.reservedQty >= item.quantity ? badge('Всё в брони', 'warn') : badge('В наличии', 'ok');
const column = (key, label, sort, render, cls = '') => ({ key, label, sort, render, cls });
const dim = (key, label, scale = 1) => column(key, label, key, item => dimensionValue(item.dims?.[key] / scale), 'num right');
export const stockDimensions = {
  section: column('sectionProfile', 'Сортамент / сечение, мм', 'sectionSize', sectionValue),
  material: column('material', 'Материал', null, materialValue),
  grade: column('materialGrade', 'Марка', null, gradeValue),
  wash: column('washed', 'Мойка', null, washValue),
  thickness: dim('thickness', 'Толщина / стенка, мм'), width: dim('width', 'Ширина, мм'),
  height: dim('height', 'Высота, мм'), depth: dim('depth', 'Глубина, мм'),
  length: dim('length', 'Длина, мм'), pipeLength: dim('length', 'Длина единицы, м', 1000),
  diameter: dim('diameter', 'Диаметр, мм'),
  source: column('source', 'Название / код', 'name', item => {
    const code = stockPositionCode(item) || item.article;
    return h('span', { title: item.name }, stockPositionName(item), code ? h('span', { class: 'muted small' }, ' · ' + code) : null);
  }, 'clip name-2'),
  surface: column('surface', 'Поверхность', null, item => /рифл/i.test(item.assortment || '') ? 'Рифлёная' : 'Не указана'),
  offcut: column('offcut', 'Вид', null, item => item.offcutOf ? 'Обрезок' : 'Материал'),
};
