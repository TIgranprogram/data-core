import { facetsOf, normSearch } from '../core/facets.js';
import { addPurchasePipe } from './request-cart-pipes.js';

export const pipeArt = new Map([
  ['Круглые трубы', 'pipe-round'],
  ['Квадратные трубы', 'pipe-square'],
  ['Прямоугольные трубы', 'pipe-rect'],
  ['Сечение не указано', 'pipes'],
]);
function pipeSection(item) {
  const dims = item.dims || {};
  const sides = (a, b) => Number(a) === Number(b) ? 'Квадратные трубы' : 'Прямоугольные трубы';
  if (Number(dims.diameter) > 0) return 'Круглые трубы';
  if (dims.width > 0 && dims.height > 0) return sides(dims.width, dims.height);
  const spec = normSearch([item.typeName, item.assortment, item.name, item.invoiceName].filter(Boolean).join(' '));
  if (/кругл|[ø⌀ф]\s*\d/iu.test(spec)) return 'Круглые трубы';
  if (/квадрат/u.test(spec)) return 'Квадратные трубы';
  if (/прямоугольн/u.test(spec)) return 'Прямоугольные трубы';
  const size = spec.match(/(\d+(?:\.\d+)?)х(\d+(?:\.\d+)?)(х\d+)?/u);
  if (size && (size[3] || /профильн/u.test(spec) || size[1] === size[2])) return sides(size[1], size[2]);
  return 'Сечение не указано';
}

export function catalogRows(items) {
  const rows = [], pipes = new Map(), seen = new Set();
  for (const item of items) {
    const id = item.materialId || item.id;
    if (!id || seen.has(String(id))) continue;
    const materialId = String(id);
    seen.add(materialId);
    const name = item.invoiceName || item.name || 'Позиция';
    const category = item.categoryName?.trim() || 'Без категории';
    const group = item.metal === 'pipe' ? 'Трубы' : item.metal === 'sheet' ? 'Листы' : category;
    const type = group === 'Трубы' ? pipeSection(item) : item.typeName?.trim() || (item.metal === 'sheet' ? item.materialGrade?.trim() : null)
      || (group !== category ? category : facetsOf(name).type) || 'Без уточнения';
    const row = { materialId, name, article: item.article, unit: item.unit, category: group, type,
      lastPurchase: item.lastPurchase, openPurchases: item.openPurchases || [], grade: item.materialGrade, size: item.assortment, thickness: item.dims?.thickness, quantity: item.quantity };
    if (group === 'Трубы') addPurchasePipe(pipes, item, row);
    else rows.push(row);
  }
  for (const { row } of pipes.values()) rows.push(row);
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }) || (a.pipe?.lengthM ?? 0) - (b.pipe?.lengthM ?? 0));
}
