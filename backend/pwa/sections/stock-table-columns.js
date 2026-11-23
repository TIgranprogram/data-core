import { h } from '../core/dom.js';
import { qty, date } from '../core/format.js';
import { stockDimensions as d, stockAvailability, stockZero } from './stock-dimension-columns.js';

/** Разные параметры типов материала, общий учёт без преобразования единиц. */
export function stockTableColumns(kind, photo, scope) {
  const name = { ...d.source, key: 'name', label: 'Наименование' };
  const category = { key: 'categoryName', label: 'Категория / тип', sort: 'categoryName', render: item => item.categoryName || '—' };
  let params = kind === 'pipe' ? [d.section, d.material, d.grade, d.wash, d.pipeLength]
    : kind === 'sheet' ? [d.material, d.grade, d.surface, d.thickness, d.width, d.length, d.offcut]
      : kind === 'wood' ? [name, category, d.width, d.height, d.thickness, d.length]
        : [name, category, d.material, d.grade, d.section, d.thickness, d.width, d.height, d.length];
  if (kind === 'main' && scope) {
    params = params.filter(column => ['name', 'categoryName'].includes(column.key) || scope.some(item =>
      column.key === 'material' ? d.material.render(item) !== 'Не указан' : column.key === 'materialGrade' ? !!item.materialGrade
        : column.key === 'sectionProfile' ? !!item.sectionProfile : Number(item.dims?.[column.key]) > 0));
    if (!scope.some(item => Object.values(item.dims || {}).some(value => Number(value) > 0) || item.sectionProfile)
      && scope.some(item => /труб|лист|доск|брус|фанер|плит|профил/i.test(item.categoryName || ''))) {
      params.push({ key: 'dimensionsState', label: 'Размеры', render: item => /труб|лист|доск|брус|фанер|плит|профил/i.test(item.categoryName || '') ? 'Размеры не указаны' : '—' });
    }
  }
  return [{ key: 'pic', label: '', pic: true, render: item => photo(item.photos?.[0]) }, ...params,
    { key: 'unit', label: 'Ед. учёта', render: item => item.unit || '—' },
    { key: 'quantity', label: 'Остаток, ед. учёта', sort: 'quantity', cls: 'num right', render: item => qty(item.quantity) },
    { key: 'reservedQty', label: 'В брони, ед. учёта', sort: 'reservedQty', cls: 'num right', render: item => qty(item.reservedQty || 0) },
    { key: 'free', label: 'Свободно, ед. учёта', sort: 'free', cls: 'num right', render: item => qty(item.free ?? item.quantity - (item.reservedQty || 0)) },
    { key: 'status', label: 'Наличие', render: stockAvailability },
    ...(['pipe', 'sheet'].includes(kind) ? [name] : []),
    { key: 'minQuantity', label: 'Мин.', sort: 'minQuantity', cls: 'num right', render: item => item.minQuantity ? qty(item.minQuantity) : '' },
    { key: 'lastCountedAt', label: 'Пересчёт', sort: 'lastCountedAt', render: item => item.lastCountedAt ? date(item.lastCountedAt) : '' },
  ];
}
export const stockRowClass = item => stockZero(item) ? 'muted' : '';
