import { api } from '../core/api.js';

/** В форме длина в метрах; склад сохраняет только указанную ось в миллиметрах. */
export async function saveCatalogPipeLength(materialId, metres) {
  const length = Number(metres) * 1000;
  if (!Number.isFinite(length) || length < 0.01) throw new Error('Укажите положительную длину хлыста в метрах');
  return api('/stock/items/' + encodeURIComponent(materialId), { method: 'PATCH', body: { dims: { length } } });
}
