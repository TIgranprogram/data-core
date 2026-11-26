import { api } from '../core/api.js';
import { catalogueStockList } from '../core/stock-list.js';
import { workerCategoryMatches, workerItemMatches, workerMaterialId, workerZoneName } from './stock-worker-model.js';

/** Необязательное UI-сужение приёмки; серверные права остаются источником доступа. */
export function workerReceiveScope(params) {
  if (!params.workerZone && !params.workerKind) return null;
  if (!params.workerZone || !['pipe', 'sheet'].includes(params.workerKind)) throw new Error('Не указан контекст рабочего склада.');
  const zoneId = params.workerZone, kind = params.workerKind;
  let categories, items;
  const scope = { zoneId, kind,
    async validateZone() {
      const { items = [] } = await api('/stock/zones');
      if (!items.some(zone => zone.id === zoneId && zone.name?.trim().toLowerCase() === workerZoneName(kind).toLowerCase())) {
        throw new Error('Зона приёмки не относится к этому рабочему экрану.');
      }
    },
    categories() {
      if (!categories) categories = api('/stock/categories', { query: { zoneId } }).then(response => (response.items || [])
        .filter(category => workerCategoryMatches(category, kind))).catch(error => { categories = null; throw error; });
      return categories;
    },
    items() {
      if (!items) items = Promise.all([catalogueStockList(zoneId), scope.categories()]).then(([all, allowed]) => all
        .filter(item => workerItemMatches(item, scope) && allowed.some(category => category.id === item.categoryId))).catch(error => { items = null; throw error; });
      return items;
    },
    async accepts(item) { return workerItemMatches(item, scope) && (await scope.items()).some(allowed => workerMaterialId(allowed) === workerMaterialId(item)); },
  };
  return scope;
}
