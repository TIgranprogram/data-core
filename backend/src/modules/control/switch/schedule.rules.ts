import type { JobState, SwitchDoc, SwitchJob } from './switch.rules';

export const SCHEDULE_TIMEZONE = 'Europe/Moscow';
export const SCHEDULE_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MOSCOW_OFFSET = 3 * 60 * MINUTE;
const DAILY_WINDOW = 30 * MINUTE;
const RETRY_DELAY = 3 * MINUTE;
const MAX_ATTEMPTS = 2;

export type ScheduleLane = 'data' | 'code';
export type RefreshScope = 'data' | 'both';
export type DailySchedule = { enabled: boolean; time: string; days: number[] };
export type DataSchedule = DailySchedule & { mode: 'interval' | 'daily'; intervalMinutes: number };
export interface ScheduleConfig {
  revision: number;
  timezone: typeof SCHEDULE_TIMEZONE;
  data: DataSchedule;
  code: DailySchedule;
  savedAt: string;
}

export interface ScheduleRun {
  slot?: string;
  slotAt?: string;
  attempts?: number;
  expiresAt?: string;
  slotAttemptAt?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastState?: JobState;
  lastError?: string | null;
  lastWarning?: string | null;
  lastSource?: 'manual' | 'schedule';
  nextRetryAt?: string | null;
}

export type ScheduleRuntime = Partial<Record<ScheduleLane, ScheduleRun>>;
export type ScheduleKeys = Partial<Record<ScheduleLane, string>>;
export const SCHEDULE_LANES: readonly ScheduleLane[] = ['code', 'data'];
const everyDay = [1, 2, 3, 4, 5, 6, 7];
const iso = (timestamp: number) => new Date(timestamp).toISOString();
const timestamp = (value?: string | null) => value ? Date.parse(value) : NaN;

export function scheduleConfig(doc: SwitchDoc, legacyMinutes: number): ScheduleConfig {
  return doc.scheduleConfig ?? {
    revision: 0,
    timezone: SCHEDULE_TIMEZONE,
    data: { enabled: legacyMinutes > 0, mode: 'interval', intervalMinutes: legacyMinutes || 15, time: '03:00', days: everyDay },
    code: { enabled: false, time: '03:00', days: everyDay },
    savedAt: '',
  };
}

type Slot = { key: string; at: number; expiresAt: number };
export type ScheduleDecision = { slot?: Slot; nextRunAt: string | null };

function dailySlots(rule: DailySchedule, revision: number, savedAt: number, now: number) {
  // Расписание рассчитано для современных дат Europe/Moscow (UTC+03:00 круглый год).
  const [h, m] = rule.time.split(':').map(Number);
  const localMidnight = Math.floor((now + MOSCOW_OFFSET) / DAY) * DAY;
  let slot: Slot | undefined;
  let next: number | undefined;
  for (let day = -1; day <= 7; day++) {
    const localDay = localMidnight + day * DAY;
    const weekday = new Date(localDay).getUTCDay() || 7;
    if (!rule.days.includes(weekday)) continue;
    const at = localDay - MOSCOW_OFFSET + (60 * h + m) * MINUTE;
    if (at < savedAt) continue;
    if (at <= now && now < at + DAILY_WINDOW) {
      slot = { key: revision + ':daily:' + iso(at), at, expiresAt: at + DAILY_WINDOW };
    }
    if (at > now) { next = at; break; }
  }
  return { slot, next };
}

function intervalSlots(period: number, revision: number, anchor: number, now: number) {
  const at = anchor + Math.floor((now - anchor) / period) * period;
  return {
    slot: at > anchor ? { key: revision + ':interval:' + iso(at), at, expiresAt: at + period } : undefined,
    next: Math.max(anchor, at) + period,
  };
}

export function scheduleDecision(config: ScheduleConfig, lane: ScheduleLane, run: ScheduleRun | undefined, now: number, copyAt?: string): ScheduleDecision {
  const rule = config[lane];
  if (!rule.enabled) return { nextRunAt: null };
  const savedAt = timestamp(config.savedAt);
  const cursor = run?.slot?.startsWith(config.revision + ':') ? timestamp(run.slotAt) : NaN;
  const slotNow = cursor > now ? cursor : now; // Коррекция часов назад не открывает предыдущий слот.
  let slots: { slot?: Slot; next?: number };
  if (lane === 'code' || config.data.mode === 'daily') {
    slots = dailySlots(rule, config.revision, savedAt, slotNow);
  } else {
    const period = config.data.intervalMinutes * MINUTE;
    if (config.revision === 0) {
      // Старый график отталкивался от возраста копии и последней попытки, даже без настроек.
      const sameLegacy = run?.slot?.startsWith('0:legacy:');
      const last = Math.max(timestamp(copyAt) || 0, sameLegacy ? timestamp(run?.slotAttemptAt ?? run?.lastAttemptAt) || 0 : 0);
      const at = last ? last + period : now;
      const slot = { key: '0:legacy:' + iso(at), at, expiresAt: now + period };
      if (sameLegacy && run?.nextRetryAt && run.expiresAt && now < timestamp(run.expiresAt)) {
        slots = { slot: { ...slot, key: run.slot!, expiresAt: timestamp(run.expiresAt) }, next: at };
      } else {
        slots = { slot: at <= now ? slot : undefined, next: at <= now ? now + period : at };
      }
    } else {
      slots = intervalSlots(period, config.revision, savedAt, slotNow);
    }
  }
  const { slot, next } = slots;
  const nextRunAt = next === undefined ? null : iso(next);
  if (!slot) return { nextRunAt };
  if (run?.slot !== slot.key) return { slot, nextRunAt: iso(slot.at) };
  const retry = timestamp(run.nextRetryAt);
  if (!(retry < slot.expiresAt)) return { nextRunAt };
  return { slot: now >= retry ? slot : undefined, nextRunAt: iso(retry) };
}

function latestAttempt(now: number, source: 'manual' | 'schedule') {
  return { lastAttemptAt: iso(now), lastState: 'queued' as const, lastError: null, lastWarning: null, lastSource: source };
}

export function claimSchedule(doc: SwitchDoc, lane: ScheduleLane, slot: Slot, now: number): ScheduleRun {
  const prior = doc.scheduleRuntime?.[lane];
  return {
    ...prior,
    ...latestAttempt(now, 'schedule'),
    slot: slot.key,
    slotAt: iso(slot.at),
    attempts: prior?.slot === slot.key ? (prior.attempts ?? 0) + 1 : 1,
    expiresAt: iso(slot.expiresAt),
    slotAttemptAt: iso(now),
    nextRetryAt: null,
  };
}

function includesLane(job: SwitchJob, lane: ScheduleLane): boolean {
  return !!job.scheduleKeys?.[lane] || (job.direction === 'refresh' &&
    (job.refreshScope === 'both' || (job.refreshScope === 'data' && lane === 'data')));
}

/** Ручной запуск обновляет последние результаты, сохраняя ключ и курсор расписания. */
export function refreshAttempt(job: SwitchJob, now: number): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const lane of SCHEDULE_LANES) {
    if (!includesLane(job, lane) || job.scheduleKeys?.[lane]) continue;
    const attempt = latestAttempt(now, job.scheduleKeys ? 'schedule' : 'manual');
    for (const [field, value] of Object.entries(attempt)) set['scheduleRuntime.' + lane + '.' + field] = value;
  }
  return set;
}

/** Результат сохраняется вместе с состоянием заявки и независим от хранения её курсора. */
export function scheduleProgress(
  doc: SwitchDoc, job: SwitchJob, state: JobState, now: number,
  error?: string, warning?: string, safeRetry = false,
): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const lane of SCHEDULE_LANES) {
    if (!includesLane(job, lane)) continue;
    const run = doc.scheduleRuntime?.[lane];
    const prefix = 'scheduleRuntime.' + lane + '.';
    set[prefix + 'lastState'] = state;
    if (warning) set[prefix + 'lastWarning'] = warning;
    if (state === 'done') set[prefix + 'lastSuccessAt'] = iso(now);
    if (state === 'failed') {
      set[prefix + 'lastError'] = error;
      const retry = now + RETRY_DELAY;
      if (safeRetry && run?.slot && run.slot === job.scheduleKeys?.[lane] &&
        (run.attempts ?? 0) < MAX_ATTEMPTS && retry < timestamp(run.expiresAt)) {
        set[prefix + 'nextRetryAt'] = iso(retry);
      }
    }
  }
  return set;
}

export function scheduleView(doc: SwitchDoc, legacyMinutes: number, canEdit: boolean, reason?: string, now = Date.now()) {
  const { revision, timezone, data, code, savedAt } = scheduleConfig(doc, legacyMinutes);
  const config = { revision, timezone, data, code, savedAt };
  const view = (lane: ScheduleLane) => {
    const run = doc.scheduleRuntime?.[lane];
    return {
      lastAttemptAt: run?.lastAttemptAt ?? null,
      lastSuccessAt: run?.lastSuccessAt ?? null,
      lastState: run?.lastState ?? null,
      lastError: run?.lastError ?? null,
      lastWarning: run?.lastWarning ?? null,
      lastSource: run?.lastSource ?? null,
      nextRunAt: doc.role === 'main' ? scheduleDecision(config, lane, run, now, doc.peerCopyAt).nextRunAt : null,
    };
  };
  return { revision, timezone, data, code, runs: { data: view('data'), code: view('code') }, canEdit, ...(reason ? { reason } : {}) };
}
