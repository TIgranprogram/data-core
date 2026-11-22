const civilDay = (date) => Math.floor(Date.parse(date) / 86_400_000);

function weekendBackground(days) {
  const stops = [];
  const stop = (color, index) => stops.push(`${color} ${100 * index / days.length}%`);
  stop('transparent', 0);
  let weekend = false;
  for (const [i, day] of days.entries()) {
    const next = [0, 6].includes(new Date(day * 86_400_000).getUTCDay());
    if (weekend === next) continue;
    stop(weekend ? 'var(--weekend)' : 'transparent', i);
    stop(next ? 'var(--weekend)' : 'transparent', i);
    weekend = next;
  }
  stop(weekend ? 'var(--weekend)' : 'transparent', days.length);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Связь между календарными днями и колонками. Пропуски обозначены границей между соседними колонками. */
export function plannerAxis(min, max, segments) {
  const parts = segments?.length ? segments.map(({ from, to }) => [civilDay(from), civilDay(to)]) : [[min, max - 1]];
  const dates = parts.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i));
  const gapBefore = new Map(parts.slice(1).map(([from], i) => [from, from - parts[i][1] - 1]));
  const known = new Set(dates);
  function column(day) {
    let left = 0, right = dates.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (dates[mid] < day) left = mid + 1; else right = mid;
    }
    return left;
  }
  function shift(day, slots) {
    if (!slots || !known.has(day)) return day + slots;
    const target = column(day) + slots;
    if (target < 0) return min + target;
    return dates[target] ?? (max + target - dates.length);
  }
  function pieces(start, end) {
    return parts.map(([from, to]) => [Math.max(from, start), Math.min(to, end)]).filter(([from, to]) => from <= to);
  }
  return { dates, gapBefore, has: (day) => known.has(day), column, shift, pieces, weekend: segments ? weekendBackground(dates) : null };
}
