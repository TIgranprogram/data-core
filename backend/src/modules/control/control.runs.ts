import { createHash } from 'crypto';
import { DAY_MS, RUN_FAIL_KEEP_DAYS, RUN_KEEP_DAYS, type Metrics } from './control.rollup';

/** Шаг ночного прогона (формат tools/night.mjs → summary.json). */
export interface RunStep {
  step: string; code: number; ms: number; commit?: string; ok: boolean;
  timedOut?: boolean; signature?: string | null; tail?: string;
}

export interface RunDoc {
  _id: string;
  date: string;
  receivedAt: Date;
  /** Когда запись сотрёт сама база: через 90 дней, у прогонов с провалом — через год. */
  keepUntil: Date;
  node: string;
  commit?: string;
  quick?: boolean;
  durationMs?: number;
  total: number; green: number; red: number; failed: string[];
  steps: RunStep[];
}

/** Один и тот же прогон, присланный повторно, получает тот же `_id` — запись заменяется, а не дублируется. */
export function runId(date: string, commit: string | undefined, node: string): string {
  return createHash('sha1').update(`${date}|${commit ?? ''}|${node}`).digest('hex').slice(0, 24);
}

export function runKeepUntil(receivedAt: Date, red: number): Date {
  return new Date(receivedAt.getTime() + (red > 0 ? RUN_FAIL_KEEP_DAYS : RUN_KEEP_DAYS) * DAY_MS);
}

/** Показатели «Проверки кода» из прогона. Шаг не запускался — null, а не 0. */
export function runMetrics(run: Pick<RunDoc, 'green' | 'red' | 'durationMs' | 'steps'> | null | undefined): Metrics {
  if (!run) return {};
  const flag = (name: string): number | null => {
    const s = run.steps.find((x) => x.step === name);
    return s ? (s.ok ? 1 : 0) : null;
  };
  return {
    'code.steps_green': run.green,
    'code.steps_red': run.red,
    'code.run_duration_s': typeof run.durationMs === 'number' ? Math.round(run.durationMs / 1000) : null,
    'code.e2e_ok': flag('e2e'),
    'code.smoke_ok': flag('smoke'),
  };
}
