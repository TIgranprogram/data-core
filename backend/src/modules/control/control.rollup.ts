import { METRIC_KEYS } from './control.catalog';

/** Показатели дня: ключ → число; null = «не знаем» (не 0). */
export type Metrics = Record<string, number | null>;

export interface MonthStat { min: number; max: number; avg: number; last: number; n: number }

export const DAILY_KEEP_DAYS = 400;
export const RUN_KEEP_DAYS = 90;
export const RUN_FAIL_KEEP_DAYS = 365;
export const DAY_MS = 86_400_000;

const p2 = (n: number) => String(n).padStart(2, '0');
/** Дата по времени сервера: ГГГГ-ММ-ДД. */
export const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const monthOf = (day: string) => day.slice(0, 7);
export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isMonth = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);

/** Все ключи каталога, значения по умолчанию null — в день пишутся все показатели, «нет данных» видно сразу. */
export function emptyMetrics(): Metrics {
  return Object.fromEntries(METRIC_KEYS.map((k) => [k, null]));
}

/** Свёртка месяца из дневных точек: min/max/avg/last/n по каждому показателю; null-значения не считаются. */
export function rollupMonth(days: { _id: string; m?: Metrics }[]): Record<string, MonthStat> {
  const sorted = [...days].sort((a, b) => (a._id < b._id ? -1 : 1));
  const out: Record<string, MonthStat> = {};
  for (const d of sorted) {
    for (const [k, v] of Object.entries(d.m ?? {})) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const s = out[k];
      if (!s) { out[k] = { min: v, max: v, avg: v, last: v, n: 1 }; continue; }
      s.avg = (s.avg * s.n + v) / (s.n + 1);
      s.n += 1;
      s.min = Math.min(s.min, v);
      s.max = Math.max(s.max, v);
      s.last = v;
    }
  }
  for (const s of Object.values(out)) s.avg = Math.round(s.avg * 100) / 100;
  return out;
}

/** Строка `disk_usage_history` → показатели диска дня. */
export function diskHistoryToMetrics(h: { usedBytes?: unknown; totalBytes?: unknown }): Metrics {
  const used = Number(h.usedBytes), total = Number(h.totalBytes);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return {};
  return { 'storage.disk_used_bytes': used, 'storage.disk_used_pct': Math.round((used / total) * 1000) / 10 };
}
