import { DAY, day, dmy, iso } from './work-schedule-shared.js';

const longDate = new Intl.DateTimeFormat('ru', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthName = new Intl.DateTimeFormat('ru', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const capitalize = (text) => text[0].toUpperCase() + text.slice(1);

export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && iso(Date.parse(value)) === value;
}

export function ganttPeriod(scale, date) {
  const t = Date.parse(date);
  const d = new Date(t);
  if (scale === 'month') return {
    from: iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)),
    to: iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)),
  };
  if (scale === 'week') {
    const monday = t - ((d.getUTCDay() + 6) % 7) * DAY;
    return { from: iso(monday), to: iso(monday + 6 * DAY) };
  }
  return { from: date, to: date };
}

export function shiftGanttPeriod(scale, date, direction) {
  const d = new Date(date);
  if (scale !== 'month') return iso(d.getTime() + direction * (scale === 'week' ? 7 : 1) * DAY);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + direction;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay)));
}

export function workExtent(bars, window, fallback) {
  if (!bars.length) return { from: fallback, to: fallback };
  const from = bars.reduce((date, bar) => day(bar.start) < date ? day(bar.start) : date, window.to);
  const to = bars.reduce((date, bar) => day(bar.end) > date ? day(bar.end) : date, window.from);
  return { from: from < window.from ? window.from : from, to: to > window.to ? window.to : to };
}

export function nearestWork(bars, date) {
  let closest = '', distance = Infinity;
  for (const bar of bars) {
    const start = day(bar.start), end = day(bar.end);
    const candidate = start > date ? start : end < date ? end : date;
    const offset = Math.abs(Date.parse(candidate) - Date.parse(date));
    if (offset < distance || (offset === distance && candidate > closest)) {
      closest = candidate;
      distance = offset;
    }
  }
  return closest;
}

export function periodTitle(scale, date, range, hasWork) {
  if (scale === 'day') return capitalize(longDate.format(Date.parse(date)));
  if (scale === 'month') return capitalize(monthName.format(Date.parse(date)));
  if (scale === 'fit' && !hasWork) return 'Обзор работ';
  return range.from === range.to ? dmy(range.from) : dmy(range.from) + ' — ' + dmy(range.to);
}
