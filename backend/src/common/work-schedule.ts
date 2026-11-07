/**
 * Расчёт сроков плана позиции (C041 Э2), чистые функции без базы. Все даты — сутки по UTC (полночь).
 * Правила: рабочие дни пн–пт; шаги одной части идут по порядку, части — параллельно;
 * шаги «Изделие целиком» идут после всех частей (сборка); ручной срок шага главнее расчёта, цепочка продолжается после него.
 */

export const DAY_MS = 86_400_000;
/** Ёмкость рабочего дня по умолчанию, часов. */
export const DAY_HOURS = 8;

export const dayOf = (d: Date) => new Date(Math.floor(d.getTime() / DAY_MS) * DAY_MS);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const isWorkday = (d: Date) => { const w = d.getUTCDay(); return w !== 0 && w !== 6; };

/** Ближайший рабочий день, начиная с самого `d`. */
export function fromWorkday(d: Date): Date {
  let x = dayOf(d);
  while (!isWorkday(x)) x = new Date(x.getTime() + DAY_MS);
  return x;
}

/** Следующий рабочий день после `d`. */
export const nextWorkday = (d: Date) => fromWorkday(new Date(dayOf(d).getTime() + DAY_MS));

/** Последний день отрезка из `n` рабочих дней, начиная с рабочего дня `start` (n < 1 считается за 1). */
export function lastDay(start: Date, n: number): Date {
  let x = fromWorkday(start), left = Math.max(1, Math.floor(n));
  while (--left > 0) x = nextWorkday(x);
  return x;
}

/** Рабочие дни отрезка [start, end] включительно; отрезок только из выходных — его первый день. */
export function workDays(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  for (let x = dayOf(start); x.getTime() <= dayOf(end).getTime(); x = new Date(x.getTime() + DAY_MS)) if (isWorkday(x)) out.push(x);
  return out.length ? out : [dayOf(start)];
}

/** Сколько рабочих дней занимает шаг: часы ÷ ёмкость дня вверх, минимум 1. */
export const durationDays = (hours: number, dayHours = DAY_HOURS) => Math.max(1, Math.ceil(hours / dayHours - 1e-9));

export interface SchedIn {
  id: string;
  /** Часть (partRowId); null — «Изделие целиком». */
  part: string | null;
  /** Всего часов на шаг (норма × количество); нет нормы — 0. */
  hours: number;
  /** Ручной срок. */
  plan?: { start: Date; end: Date } | null;
}
export interface SchedOut { id: string; start: Date; end: Date; hours: number; manual: boolean }

/** Сроки шагов плана. `anchor` — с какого дня начинать (рабочий день берётся автоматически). */
export function scheduleSteps(steps: SchedIn[], anchor: Date, dayHours = DAY_HOURS): SchedOut[] {
  const start0 = fromWorkday(anchor);
  const cursor = new Map<string, Date>(); // конец последнего шага цепочки части
  const place = (s: SchedIn, key: string, from: Date): SchedOut => {
    if (s.plan) {
      cursor.set(key, dayOf(s.plan.end));
      return { id: s.id, start: dayOf(s.plan.start), end: dayOf(s.plan.end), hours: s.hours, manual: true };
    }
    const start = fromWorkday(from);
    const end = lastDay(start, durationDays(s.hours, dayHours));
    cursor.set(key, end);
    return { id: s.id, start, end, hours: s.hours, manual: false };
  };
  const out = new Map<string, SchedOut>();
  for (const s of steps.filter((x) => x.part)) {
    const key = s.part!, prev = cursor.get(key);
    out.set(s.id, place(s, key, prev ? nextWorkday(prev) : start0));
  }
  // «Изделие целиком» — после самой поздней части
  let after = start0;
  if (cursor.size) after = nextWorkday(new Date(Math.max(...[...cursor.values()].map((d) => d.getTime()))));
  for (const s of steps.filter((x) => !x.part)) {
    const prev = cursor.get('');
    out.set(s.id, place(s, '', prev ? nextWorkday(prev) : after));
  }
  return steps.map((s) => out.get(s.id)!);
}

/** Часы шага поровну по его рабочим дням: [{date:'YYYY-MM-DD', hours}]. */
export function spreadHours(start: Date, end: Date, hours: number): Array<{ date: string; hours: number }> {
  if (!(hours > 0)) return [];
  const days = workDays(start, end), each = Math.round((hours / days.length) * 100) / 100;
  return days.map((d) => ({ date: isoDay(d), hours: each }));
}

/** Занятость людей по дням: сумма часов шагов с исполнителем. */
export function loadByDay(bars: Array<{ assigneeId: string | null; startAt: Date; endAt: Date; hours: number }>): Array<{ personId: string; date: string; hours: number }> {
  const sum = new Map<string, number>();
  for (const b of bars) {
    if (!b.assigneeId) continue;
    for (const h of spreadHours(b.startAt, b.endAt, b.hours)) sum.set(`${b.assigneeId}|${h.date}`, (sum.get(`${b.assigneeId}|${h.date}`) ?? 0) + h.hours);
  }
  return [...sum].map(([k, hours]) => { const [personId, date] = k.split('|'); return { personId, date, hours: Math.round(hours * 100) / 100 }; })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.personId < b.personId ? -1 : 1));
}

/**
 * Факт-часы шага по отметкам «начал / закончил» (C041 Э3): по рабочим дням отрезка.
 * Один рабочий день — реальная разница во времени (0,25…8 ч); несколько дней — 8 ч за день
 * (точной почасовой отметки нет, а день в плане и Ганте — 8 ч).
 */
export function factSpan(start: Date, finish: Date): Array<{ date: string; hours: number }> {
  const a = Math.min(start.getTime(), finish.getTime()), b = Math.max(start.getTime(), finish.getTime());
  const from = dayOf(new Date(a)), to = dayOf(new Date(b));
  const days = workDays(from, to).map(isoDay);
  if (days.length <= 1) {
    const hours = Math.min(DAY_HOURS, Math.max(0.25, Math.round(((b - a) / 3_600_000) * 4) / 4));
    return [{ date: isoDay(from), hours }];
  }
  return days.map((date) => ({ date, hours: DAY_HOURS }));
}

/** Срок плана: рабочие дни от первого шага до последнего (включительно); пусто — 0 дней. */
export function leadDays(steps: SchedIn[], anchor: Date, dayHours = DAY_HOURS): { days: number; start: Date | null; end: Date | null } {
  if (!steps.length) return { days: 0, start: null, end: null };
  const rows = scheduleSteps(steps, anchor, dayHours);
  const start = new Date(Math.min(...rows.map((r) => r.start.getTime())));
  const end = new Date(Math.max(...rows.map((r) => r.end.getTime())));
  return { days: workDays(start, end).length, start, end };
}
