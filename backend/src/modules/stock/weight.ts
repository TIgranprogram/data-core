/**
 * Количество по весу (TASKS НО): как в листе «Склад» Google-таблицы — образец (N шт = M г) → вес 1 шт.,
 * партии на весах (весы вмещают не всё) − тара → общий вес → штук = общий вес ÷ вес 1 шт. (округление до целого).
 * Склад хранит ШТУКИ; вес — только способ ввода. Вес 1 шт. в позиции — `weightKg` (кг, поле общей схемы), ввод — в граммах.
 * Та же формула в браузере — `pwa/ui/weight-count.js` (предпросмотр); сервер считает сам и пишет движение.
 */
export interface ByWeight {
  /** Вес 1 шт., г — известен (из позиции) или задан вручную. */
  unitWeightG?: number;
  /** Образец: сколько штук и сколько весят, г — тогда вес 1 шт. = вес ÷ штук. */
  sampleCount?: number;
  sampleWeightG?: number;
  /** Вес партий на весах, г. */
  batchesG: number[];
  /** Тара / ящик, г — вычитается один раз из общего веса. */
  tareG?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Граммы → кг для поля `weightKg` (6 знаков — без потери долей грамма). */
export const gramsToKg = (g?: number) => (g === undefined || !Number.isFinite(g) ? undefined : Math.round(g * 1000) / 1e6);
/**
 * Вес 1 шт. в граммах из позиции (НО.0). `weightUnit: 'kg'` — записано в кг (приложение, синхронизация после 2026-10-21,
 * миграция); без пометки — старые записи: синхронизация писала туда граммы из листа «Склад» (проверено: 109 из 109).
 */
export function weightGOf(m: { weightKg?: unknown; weightUnit?: unknown } | null | undefined): number | null {
  const v = Number(m?.weightKg);
  if (!(v > 0)) return null;
  return m?.weightUnit === 'kg' ? Math.round(v * 1e6) / 1000 : v;
}
const pos = (n: unknown) => Number.isFinite(Number(n)) && Number(n) > 0;

export function weightCount(w: ByWeight) {
  const errors: string[] = [];
  let unitG: number | null = null;
  if (w.sampleCount !== undefined || w.sampleWeightG !== undefined) {
    if (!pos(w.sampleCount)) errors.push('Сколько штук в образце — больше нуля');
    else if (!pos(w.sampleWeightG)) errors.push('Вес образца — больше нуля');
    else unitG = Number(w.sampleWeightG) / Number(w.sampleCount);
  } else if (pos(w.unitWeightG)) unitG = Number(w.unitWeightG);
  else errors.push('Нет веса 1 шт. — взвесьте образец');
  const batches = (w.batchesG || []).map(Number).filter((x) => Number.isFinite(x) && x !== 0);
  if (batches.some((x) => x < 0)) errors.push('Вес партии не может быть меньше 0');
  const gross = batches.reduce((s, x) => s + x, 0);
  const tare = pos(w.tareG) ? Number(w.tareG) : 0;
  const totalG = r2(gross - tare);
  if (!batches.length) errors.push('Впишите вес хотя бы одной партии');
  else if (totalG <= 0) errors.push('Тара больше веса партий');
  const exact = unitG && totalG > 0 ? totalG / unitG : null;
  const count = exact === null ? null : Math.round(exact);
  return {
    unitWeightG: unitG === null ? null : r2(unitG), totalG, count, exact: exact === null ? null : r2(exact),
    errors, ok: !errors.length && count !== null && count > 0,
    /** Небольшой образец — вес 1 шт. неточный (как подсказка: «взвесьте 10 шт и больше»). */
    smallSample: pos(w.sampleCount) && Number(w.sampleCount) < 10,
  };
}

const ru = (n: number) => r2(n).toLocaleString('ru-RU').replace(/[  ]/g, ' ');
const g = (n: number) => ru(n) + ' г';

/** Примечание движения: «по весу: 5 970 г ÷ 8 г = 746 шт (образец 10 шт = 80 г; партии 4 930 + 1 040)». */
export function weightNote(w: ByWeight, r: ReturnType<typeof weightCount>) {
  const parts = [w.sampleCount ? `образец ${w.sampleCount} шт = ${g(Number(w.sampleWeightG))}` : '', `партии ${w.batchesG.filter((x) => Number(x)).map((x) => ru(Number(x))).join(' + ')}`, w.tareG ? `тара ${g(Number(w.tareG))}` : ''].filter(Boolean);
  return `по весу: ${g(r.totalG)} ÷ ${g(r.unitWeightG ?? 0)} = ${r.count} шт (${parts.join('; ')})`;
}
