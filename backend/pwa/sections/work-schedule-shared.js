/* Общее для Ганта (work-schedule*.js): адрес сервера, даты, подписи шага и кэш шагов для правой панели. */
export const SCHEDULE = '/work-schedule';
export const NONE = '_none';
export const DAY = 864e5;
export const iso = (n) => new Date(n).toISOString().slice(0, 10);
export const startOfWeek = () => { const d = new Date(); const u = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); return u - ((new Date(u).getUTCDay() + 6) % 7) * DAY; };
export const day = (v) => String(v || '').slice(0, 10);
export const dmy = (v) => day(v).split('-').reverse().join('.');
export const round = (v) => Math.round((Number(v) || 0) * 10) / 10;

/** stepId → { bar, people } — для панели шага и переноса полосы. */
export const steps = new Map();

export const partOf = (b) => b.partName || 'Изделие целиком';
export const titleOf = (b) => `${partOf(b)} · ${b.workTypeName || 'работа'}`;

/** Запомненный вид (линза, масштаб, раскрытое): localStorage `dc-gantt-*`. */
export function pref(key, fallback) {
  try { const v = localStorage.getItem('dc-gantt-' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function savePref(key, value) {
  try { localStorage.setItem('dc-gantt-' + key, JSON.stringify(value)); } catch { /* приватный режим */ }
}
