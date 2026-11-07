import { api } from '../core/api.js';
import { stockList } from '../core/stock-list.js';
import { facetValues, familyOf, index as facetIndex } from '../core/facets.js';
import { lookups, unitList } from './lookups.js';
import { openBulk } from './bulk-edit.js';

/*
 * C043: «Изменить выбранные» на «Остатках» и в «Каталоге номенклатуры» — тип, категория, ед. изм., марка стали, сортамент.
 * Эталон — «Продукция» (sections/bulk-edit.js openBulk): у поля галочка «менять», у записей меняется только отмеченное,
 * перед записью подтверждение, после — «Отменить» (вернуть как было).
 * Тип (typeName) — ручной: в core/facets.js index() он важнее вычисленного по названию; в списке — существующие типы с полкой.
 * Сервер: PATCH /stock/items/bulk { ids, set } → { updated, failed, before }; отмена — PATCH /stock/items/bulk/restore { items: before }.
 */

/** id позиции склада: строка каталога материала приходит с префиксом «m:» (supplier-catalog materialRow) — снимаем его. */
const stockId = (id) => String(id ?? '').trim().replace(/^m:/, '');

/** Поля панели: значения — из общего списка склада (после index) и справочников, чтобы не вводить тип руками. */
async function stockBulkFields() {
  const items = (await stockList().catch(() => [])) || [];
  facetIndex(items);
  const types = facetValues(items, 'type').map(([t]) => ({ value: t, label: t, sub: familyOf(t).label }));
  const grades = facetValues(items, 'grade').map(([v]) => ({ value: v, label: v }));
  const kinds = facetValues(items, 'section').map(([v]) => ({ value: v, label: v }));
  const lk = await lookups().catch(() => ({}));
  const cats = (lk.categories || []).map((c) => ({ value: c.id, label: c.name }));
  const catId = (v) => (cats.find((c) => c.label.trim().toLowerCase() === String(v || '').trim().toLowerCase()) || {}).value;
  const mapCat = (v) => {
    const id = catId(v);
    if (!id) throw new Error(`Категория «${v}» не найдена — выберите из списка`);
    return id;
  };
  return [
    { key: 'typeName', label: 'Тип', type: 'combo', options: types, hint: 'Нет нужного — впишите свой: он важнее типа, вычисленного по названию' },
    { key: 'categoryId', label: 'Категория', type: 'combo', options: cats, map: mapCat },
    { key: 'unit', label: 'Ед. изм.', type: 'combo', options: unitList(lk).map((u) => ({ value: u, label: u })) },
    { key: 'materialGrade', label: 'Марка стали', type: 'combo', options: grades },
    { key: 'assortment', label: 'Сортамент / сечение', type: 'combo', options: kinds },
  ];
}

/** openStockBulk({ ids, done }) — правая панель «Изменить выбранные» для позиций склада (одна пачка на сервер). */
export function openStockBulk({ ids = [], done } = {}) {
  const idsClean = [...new Set(ids.map(stockId).filter(Boolean))];
  openBulk({ noun: 'позиций', ids: idsClean, done, fields: stockBulkFields,
    apply: (set) => api('/stock/items/bulk', { method: 'PATCH', body: { ids: idsClean, set } }),
    restore: (before) => api('/stock/items/bulk/restore', { method: 'PATCH', body: { items: before } }) });
}
