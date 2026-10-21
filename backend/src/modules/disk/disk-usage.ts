/**
 * Место на диске сервера (TASKS ДИ.1) — чистые функции: уровень заполнения и «на сколько хватит» по росту за 30 дней.
 * Снимки (по одному в день) хранит сервис в `disk_usage_history`.
 */
export interface DiskSnapshot { date: string; usedBytes: number; totalBytes: number }
export type DiskLevel = 'ok' | 'warn' | 'danger';

/** >90% — красный, >80% — жёлтый (ДИ.2). */
export const diskLevel = (usedPct: number): DiskLevel => (usedPct > 90 ? 'danger' : usedPct > 80 ? 'warn' : 'ok');

const DAY = 86400000;
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Итог по тому: всего / занято / свободно, %, уровень; рост в день и дней до заполнения — по самому старому снимку
 * не старше 30 дней (нужно ≥ 3 дней истории, иначе прогноза нет). Рост ≤ 0 — «не растёт» (daysLeft = null).
 */
export function diskState(totalBytes: number, freeBytes: number, history: DiskSnapshot[], today: string) {
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const usedPct = totalBytes > 0 ? r1((usedBytes / totalBytes) * 100) : 0;
  const t = Date.parse(today + 'T00:00:00Z');
  const base = history
    .filter((h) => h.date < today && t - Date.parse(h.date + 'T00:00:00Z') <= 30 * DAY)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const days = base ? Math.round((t - Date.parse(base.date + 'T00:00:00Z')) / DAY) : 0;
  const growthPerDay = base && days >= 3 ? Math.round((usedBytes - base.usedBytes) / days) : null;
  const daysLeft = growthPerDay && growthPerDay > 0 ? Math.floor(freeBytes / growthPerDay) : null;
  return { totalBytes, usedBytes, freeBytes, usedPct, level: diskLevel(usedPct), growthPerDay, daysLeft, historyDays: days };
}

/** «12,3 ГБ» — для сообщений и скриптов. */
export function gb(bytes: number) {
  return (Math.round((bytes / 1024 ** 3) * 10) / 10).toLocaleString('ru-RU') + ' ГБ';
}
