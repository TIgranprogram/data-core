/**
 * Металл на складе (TASKS СМ.1–СМ.2): труба и лист — те же позиции `materials`, но с сортаментом, маркой и размерами
 * (поля общей схемы: `assortment`, `materialGrade`, `dimensions` в мм). Вид — по категории: «…труб…» / «…лист…».
 * Труба учитывается в метрах, лист — в листах. Обрезок, который ещё пригодится, — своя позиция «<позиция> — обрезок …»
 * (единица «шт», `offcutOf` → родитель; поле только data-core), чтобы в «Операциях» его брали первым.
 */
export type MetalKind = 'pipe' | 'sheet';
export type Dims = { length?: number | null; width?: number | null; thickness?: number | null; diameter?: number | null };
const DIM_TYPES = ['length', 'width', 'thickness', 'diameter'] as const;

export function metalKind(categoryName?: string | null, unit?: string | null): MetalKind | null {
  const c = String(categoryName ?? '').toLowerCase();
  if (/труб/.test(c)) return 'pipe';
  if (/лист/.test(c) || String(unit ?? '').toLowerCase() === 'лист') return 'sheet';
  return null;
}

/** dimensions (массив CRM-схемы) → { length, width, thickness, diameter } в мм. */
export function dimsOf(dimensions: unknown): Dims {
  const out: Dims = {};
  for (const d of Array.isArray(dimensions) ? dimensions as { type?: string; value?: number }[] : []) {
    if (d && DIM_TYPES.includes(d.type as (typeof DIM_TYPES)[number]) && Number(d.value) > 0) out[d.type as keyof Dims] = Number(d.value);
  }
  return out;
}

/** Слить правку размеров с текущими: null/0 — убрать, undefined — не трогать. Возвращает массив для `dimensions`. */
export function mergeDims(current: unknown, patch: Dims) {
  const cur = dimsOf(current);
  for (const k of DIM_TYPES) {
    if (patch[k] === undefined) continue;
    const v = Number(patch[k]);
    if (patch[k] === null || !(v > 0)) delete cur[k]; else cur[k] = Math.round(v * 100) / 100;
  }
  return DIM_TYPES.filter((k) => cur[k]).map((k) => ({ type: k, value: cur[k] as number, isImmutable: false }));
}

/** «1,2 м» из миллиметров. */
export const meters = (mm: number) => (Math.round(mm) / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 }) + ' м';

/** Название позиции-обрезка: труба — «… — обрезок 1,2 м», лист — «… — обрезок 1×0,5 м». */
export function offcutName(parent: string, kind: MetalKind, lengthMm: number, widthMm?: number | null) {
  const size = kind === 'sheet' && widthMm ? `${(lengthMm / 1000).toLocaleString('ru-RU')}×${(widthMm / 1000).toLocaleString('ru-RU')} м` : meters(lengthMm);
  return `${parent} — обрезок ${size}`;
}

/** Приход трубы хлыстами: «10 хлыстов по 6 м» = 60 м. */
export const pipeMeters = (pieces: number, lengthM: number) => Math.round(pieces * lengthM * 1000) / 1000;
