import { DAY, day, dmy, iso } from './work-schedule-shared.js';

export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && iso(Date.parse(value)) === value;
}

function calendarPeriod(scale, time) {
  const d = new Date(time);
  if (scale === 'month') return [
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1),
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ];
  if (scale === 'week') {
    const monday = time - ((d.getUTCDay() + 6) % 7) * DAY;
    return [monday, monday + 6 * DAY];
  }
  return [time, time];
}

function merge(ranges) {
  const result = [];
  for (const [from, to] of ranges.sort((a, b) => a[0] - b[0])) {
    const last = result.at(-1);
    if (last && from <= last[1] + DAY) last[1] = Math.max(last[1], to);
    else result.push([from, to]);
  }
  return result;
}

/** Шкала состоит из отрезков с работами. Даты задач входят целиком в пределах загруженного набора. */
export function workFocus(scale, bars, window, fallback) {
  const min = Date.parse(window.from), max = Date.parse(window.to);
  const active = merge(bars.map((bar) => [
    Math.max(min, Date.parse(day(bar.start))),
    Math.min(max, Date.parse(day(bar.end))),
  ]).filter(([start, end]) => start <= end));
  const bands = scale === 'day' ? active.map(([start, end]) => [start - DAY, end + DAY])
    : active.map(([start, end]) => [calendarPeriod(scale, start)[0], calendarPeriod(scale, end)[1]]);
  const segments = merge(bands).map(([start, end]) => ({ from: iso(start), to: iso(end) }));
  const periods = [];
  for (const [start, end] of active) {
    for (let t = start; t <= end;) {
      const [first, last] = calendarPeriod(scale, t);
      if (periods.at(-1) !== iso(first)) periods.push(iso(first));
      t = last + DAY;
    }
  }
  return { segments, periods, from: segments[0]?.from || fallback, to: segments.at(-1)?.to || fallback };
}

export function shiftWorkFocus(scale, selection, periods, direction) {
  if (!selection) return direction > 0 ? periods[0] : periods.at(-1);
  const pivot = iso(calendarPeriod(scale, Date.parse(selection))[0]);
  return direction > 0 ? periods.find((date) => date > pivot) : periods.findLast((date) => date < pivot);
}

export function workFocusTitle(range) {
  if (!range.segments.length) return 'Работ нет';
  return range.from === range.to ? dmy(range.from) : dmy(range.from) + ' — ' + dmy(range.to);
}
