import { api } from '../core/api.js';

/** Справочники для форм и фильтров (поставщики, категории, «кто подал»): один запрос на сессию, сброс после сохранения. */
let cache = null;
export function lookups() {
  cache ??= api('/supply/lookups').catch((e) => { cache = null; throw e; });
  return cache;
}
lookups.reset = () => { cache = null; };

export const UNITS = ['шт', 'м', 'м²', 'м³', 'кг', 'т', 'л', 'уп', 'компл', 'рул', 'лист', 'пог. м'];

/** Единицы для выпадающего списка: из «Справочников» (СП.5), пока он пуст — обычный набор. */
export const unitList = (lk) => (lk?.units?.length ? lk.units : UNITS);
