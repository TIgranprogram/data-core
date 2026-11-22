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

/** Соседние занятые периоды идут вместе. До первой работы блока оставляем один день. */
function trimCalendarBands(scale, active) {
  const bands = [];
  for (const [start, end] of active) {
    const [first] = calendarPeriod(scale, start);
    const [, last] = calendarPeriod(scale, end);
    const previous = bands.at(-1);
    if (previous && first <= previous[1] + DAY) previous[1] = Math.max(previous[1], last);
    else bands.push([start - DAY, last]);
  }
  return bands;
}

/** Шкала состоит из отрезков с работами. Даты задач входят целиком в пределах загруженного набора. */
export function workFocus(scale, bars, window, fallback) {
  const min = Date.parse(window.from), max = Date.parse(window.to);
  const active = merge(bars.map((bar) => [
    Math.max(min, Date.parse(day(bar.start))),
    Math.min(max, Date.parse(day(bar.end))),
  ]).filter(([start, end]) => start <= end));
  let bands = active;
  if (scale === 'day') bands = active.map(([start, end]) => [start - DAY, end + DAY]);
  if (scale === 'week' || scale === 'month') bands = trimCalendarBands(scale, active);
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

export function shiftWorkFocus(scale, selection, periods, segments, direction) {
  const pivot = selection ? iso(calendarPeriod(scale, Date.parse(selection))[0]) : '';
  const target = pivot
    ? (direction > 0 ? periods.find((date) => date > pivot) : periods.findLast((date) => date < pivot))
    : (direction > 0 ? periods[0] : periods.at(-1));
  if (!target) return undefined;
  const segment = segments.find(({ to }) => to >= target);
  return segment && segment.from > target ? segment.from : target;
}

export function workFocusTitle(range) {
  if (!range.segments.length) return 'Работ нет';
  return range.from === range.to ? dmy(range.from) : dmy(range.from) + ' — ' + dmy(range.to);
}
