import { claimSchedule, scheduleConfig, scheduleDecision, scheduleProgress, type ScheduleConfig, type ScheduleRun } from './schedule.rules';
import type { SwitchDoc, SwitchJob } from './switch.rules';

const time = Date.parse;
const min = 60_000;
const doc: SwitchDoc = { role: 'main', mode: 'normal', job: null };
const config: ScheduleConfig = {
  revision: 1,
  timezone: 'Europe/Moscow',
  savedAt: '2026-11-01T00:00:00.000Z',
  data: { enabled: true, mode: 'interval', intervalMinutes: 15, time: '03:00', days: [1, 2, 3, 4, 5, 6, 7] },
  code: { enabled: true, time: '03:00', days: [1] },
};

describe('Расписание обновлений запасного', () => {
  it('ночь считается по Москве и ISO-дням; дневное опоздание пропускается', () => {
    expect(scheduleDecision(config, 'code', undefined, time('2026-11-15T23:59:59Z'))).toEqual({ nextRunAt: '2026-11-16T00:00:00.000Z' });
    const opened = scheduleDecision(config, 'code', undefined, time('2026-11-16T00:29:59Z'));
    expect(opened.slot).toMatchObject({ at: time('2026-11-16T00:00:00Z'), expiresAt: time('2026-11-16T00:30:00Z') });
    expect(scheduleDecision(config, 'code', undefined, time('2026-11-16T00:30:00Z'))).toEqual({ nextRunAt: '2026-11-23T00:00:00.000Z' });
    expect(scheduleDecision(config, 'code', undefined, time('2026-11-16T12:00:00Z'))).toEqual({ nextRunAt: '2026-11-23T00:00:00.000Z' });
    const lateNight = { ...config, code: { enabled: true, time: '23:55', days: [7] } };
    expect(scheduleDecision(lateNight, 'code', undefined, time('2026-11-15T21:05:00Z')).slot?.at).toBe(time('2026-11-15T20:55:00Z'));
  });

  it('позднее сохранение не запускает только что прошедший слот, пауза не даёт следующую дату', () => {
    const now = time('2026-11-16T00:02:00Z');
    const saved = { ...config, savedAt: '2026-11-16T00:01:00.000Z' };
    expect(scheduleDecision(saved, 'code', undefined, now)).toEqual({ nextRunAt: '2026-11-23T00:00:00.000Z' });
    expect(scheduleDecision({ ...saved, code: { ...saved.code, enabled: false } }, 'code', undefined, now)).toEqual({ nextRunAt: null });
  });

  it('интервал берёт последний слот после простоя; та же ревизия после рестарта его не повторяет', () => {
    const now = time('2026-11-21T11:46:00Z');
    const due = scheduleDecision(config, 'data', undefined, now);
    expect(due.slot?.at).toBe(time('2026-11-21T11:45:00Z'));
    const claimed = claimSchedule(doc, 'data', due.slot!, now);
    expect(scheduleDecision(config, 'data', claimed, now + min)).toEqual({ nextRunAt: '2026-11-21T12:00:00.000Z' });
    expect(scheduleDecision(config, 'data', claimed, now - 10 * min)).toEqual({ nextRunAt: '2026-11-21T12:00:00.000Z' });
    const newRevision = { ...config, revision: 2, savedAt: '2026-11-21T11:45:45.000Z' };
    expect(scheduleDecision(newRevision, 'data', claimed, now)).toEqual({ nextRunAt: '2026-11-21T12:00:45.000Z' });
  });

  it('legacy env: до явного сохранения только данные, 0 выключает, свежая копия откладывает запуск', () => {
    const now = time('2026-11-21T11:44:00Z');
    const legacy = scheduleConfig(doc, 15);
    expect(scheduleDecision(legacy, 'code', undefined, now)).toEqual({ nextRunAt: null });
    expect(scheduleDecision(scheduleConfig(doc, 0), 'data', undefined, now)).toEqual({ nextRunAt: null });
    expect(scheduleDecision(legacy, 'data', undefined, now, '2026-11-21T11:30:00Z')).toEqual({ nextRunAt: '2026-11-21T11:45:00.000Z' });
    const due = scheduleDecision(legacy, 'data', undefined, now);
    const prior = claimSchedule(doc, 'data', due.slot!, now);
    expect(scheduleDecision(legacy, 'data', prior, now + min)).toEqual({ nextRunAt: '2026-11-21T11:59:00.000Z' });
  });

  it('повтор только после безопасного отказа, через 3 мин и не больше одного в окне', () => {
    const now = time('2026-11-16T00:15:00Z');
    const slot = scheduleDecision(config, 'code', undefined, now).slot!;
    const run = claimSchedule(doc, 'code', slot, now);
    const busy = { ...doc, scheduleRuntime: { code: run } };
    const job: SwitchJob = {
      id: 'abcde1', direction: 'refresh', step: 'preflight', state: 'running', startedAt: run.lastAttemptAt!,
      scheduleKeys: { code: slot.key },
    };
    const safe = scheduleProgress(busy, job, 'failed', now, 'нет связи', undefined, true);
    const retry = safe['scheduleRuntime.code.nextRetryAt'] as string;
    expect(retry).toBe('2026-11-16T00:18:00.000Z');
    const failed: ScheduleRun = { ...run, nextRetryAt: retry, lastState: 'failed' };
    expect(scheduleDecision(config, 'code', failed, now + 2 * min)).toEqual({ nextRunAt: retry });
    expect(scheduleDecision(config, 'code', failed, now + 3 * min).slot?.key).toBe(slot.key);
    expect(scheduleProgress(busy, job, 'failed', now, 'прервано восстановление')).not.toHaveProperty(['scheduleRuntime.code.nextRetryAt']);
    expect(scheduleProgress(busy, job, 'failed', now + 13 * min, 'нет связи', undefined, true)).not.toHaveProperty(['scheduleRuntime.code.nextRetryAt']);
    const second = { ...busy, scheduleRuntime: { code: claimSchedule({ ...busy, scheduleRuntime: { code: failed } }, 'code', slot, now + 3 * min) } };
    expect(scheduleProgress(second, job, 'failed', now + 3 * min, 'нет связи', undefined, true)).not.toHaveProperty(['scheduleRuntime.code.nextRetryAt']);
    expect(scheduleProgress(busy, job, 'done', now, undefined, 'CRM работает')).toEqual({
      'scheduleRuntime.code.lastState': 'done',
      'scheduleRuntime.code.lastSuccessAt': '2026-11-16T00:15:00.000Z',
      'scheduleRuntime.code.lastWarning': 'CRM работает',
    });
  });
});
