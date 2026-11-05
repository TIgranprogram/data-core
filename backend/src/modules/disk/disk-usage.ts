/**
 * Место на диске сервера (TASKS ДИ.1) — чистые функции: уровень заполнения и «на сколько хватит» по росту за 30 дней.
 * Снимки (по одному в день) хранит сервис в `disk_usage_history`.
 */

import { capacityLimits } from '../productattachments/attachment-capacity';
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

const GIB = 1024 ** 3;

/**
 * Предупреждение про вложения изделий (ВЛ-1): жёлтое, когда свободно < 15 % или < 10 ГБ; красное — свободно < 10 % или < 5 ГБ,
 * либо вложения заняли больше потолка. Нет вложений или размер неизвестен — `null`.
 */
export function attachmentsWarning(attachmentsBytes: number | null, totalBytes: number, freeBytes: number, ceilingBytes: number = capacityLimits().ceilingBytes): { level: DiskLevel; text: string } | null {
  if (!attachmentsBytes) return null;
  const freePct = totalBytes > 0 ? (freeBytes / totalBytes) * 100 : 100;
  const over = attachmentsBytes > ceilingBytes;
  const head = `Вложения изделий занимают ${gb(attachmentsBytes)}, свободно ${gb(freeBytes)}.`;
  if (over) return { level: 'danger', text: `${head} Это больше предела (${gb(ceilingBytes)}): новые файлы не принимаются. Удалите лишнее или увеличьте место.` };
  if (freePct < 10 || freeBytes < 5 * GIB) return { level: 'danger', text: `${head} Места почти нет — освободите диск.` };
  if (freePct < 15 || freeBytes < 10 * GIB) return { level: 'warn', text: `${head} Места остаётся мало.` };
  return null;
}
