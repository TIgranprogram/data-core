import { Types } from 'mongoose';
import { clean, type Doc } from './showcase-common';

/** Поля изделия, которые переходят в клон (всё остальное — служебное: номер, корзина, склад, связи с заказами). */
const COPY = ['kind', 'unit', 'status', 'series', 'description', 'listPrice', 'basePrice', 'costPrice', 'defaultMarkupPercent', 'categoryId', 'colors', 'sizes', 'dimensions', 'weightKg', 'ralCode',
  'purpose', 'installation', 'designerId', 'materialsSpec', 'photoIds', 'mainPhotoId', 'composition', 'productModuleIds', 'passportDefaults'] as const;

/**
 * Клон изделия (ПВ): документ для вставки — копия значимых полей (фото, состав, таблица материалов, `passportDefaults` вместе с
 * `textChoices`), наименование «… (копия)», новый артикул. Паспорта, заказы и склад исходного изделия в клон не идут.
 */
export function cloneDoc(src: Doc, sku: string, now = new Date()): Record<string, unknown> {
  const out: Record<string, unknown> = { sku, name: `${clean(src.name)} (копия)` };
  for (const k of COPY) if (src[k] !== undefined && src[k] !== null) out[k] = src[k]; // только вставка в базу — объекты не правятся, глубокая копия не нужна (ObjectId её не переживёт)
  return { stockQty: 0, isActive: true, hasPassport: false, hasDrawing: false, photoIds: [], mainPhotoId: null, productModuleIds: [], composition: [], ...out, deletedAt: null, source: 'showcase', createdAt: now, updatedAt: now,
    ...(out.photoIds && !out.mainPhotoId ? { mainPhotoId: (out.photoIds as Types.ObjectId[])[0] ?? null } : {}) };
}
