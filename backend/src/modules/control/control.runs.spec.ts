import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { runId, runKeepUntil, runMetrics, type RunStep } from './control.runs';
import { CreateRunDto, STEP_TAIL_MAX } from './dto/control.dto';

const step = (name: string, ok: boolean): RunStep => ({ step: name, code: ok ? 0 : 1, ms: 1000, ok, signature: ok ? null : `${name}:abc`, tail: 'x' });

describe('CC-13: прогоны', () => {
  it('runId один и тот же для того же прогона, другой — для другого узла', () => {
    expect(runId('2026-10-31T01:00:00Z', 'abc', 'pc')).toBe(runId('2026-10-31T01:00:00Z', 'abc', 'pc'));
    expect(runId('2026-10-31T01:00:00Z', 'abc', 'pc')).not.toBe(runId('2026-10-31T01:00:00Z', 'abc', 'vm'));
  });

  it('хранение: зелёный — 90 дней, с провалом — год', () => {
    const t = new Date('2026-01-01T00:00:00Z');
    expect(runKeepUntil(t, 0).getTime() - t.getTime()).toBe(90 * 86_400_000);
    expect(runKeepUntil(t, 2).getTime() - t.getTime()).toBe(365 * 86_400_000);
  });

  it('показатели прогона; шаг не запускался — null, не 0', () => {
    const m = runMetrics({ green: 2, red: 1, durationMs: 90_400, steps: [step('tsc', true), step('unit', true), step('e2e', false)] });
    expect(m).toEqual({ 'code.steps_green': 2, 'code.steps_red': 1, 'code.run_duration_s': 90, 'code.e2e_ok': 0, 'code.smoke_ok': null });
    expect(runMetrics(null)).toEqual({});
  });

  const okStep = { step: 'tsc', code: 0, ms: 5, commit: 'abc1234', ok: true, signature: null, tail: 'ok' };
  const body = (over: Record<string, unknown> = {}) => ({
    date: '2026-10-31T01:00:00.000Z', commit: 'abc1234', quick: false, durationMs: 1000, total: 1, green: 1, red: 0, failed: [],
    steps: [okStep], ...over,
  });
  const check = (o: unknown) => validate(plainToInstance(CreateRunDto, o), { whitelist: true, forbidNonWhitelisted: true });

  it('DTO принимает summary.json как есть', async () => {
    expect(await check(body())).toHaveLength(0);
  });

  it('DTO: лишнее поле, больше 30 шагов, не число в коде — отказ', async () => {
    expect((await check(body({ extra: 1 }))).length).toBeGreaterThan(0);
    expect((await check(body({ steps: Array.from({ length: 31 }, () => okStep) }))).length).toBeGreaterThan(0);
    expect((await check(body({ steps: [{ ...okStep, code: 'x' }] }))).length).toBeGreaterThan(0);
  });

  it('DTO: хвост шага длиннее 4 КБ обрезается с начала', async () => {
    const dto = plainToInstance(CreateRunDto, body({ steps: [{ ...okStep, tail: 'a'.repeat(5000) + 'КОНЕЦ' }] }));
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);
    expect(dto.steps[0].tail!.length).toBe(STEP_TAIL_MAX);
    expect(dto.steps[0].tail!.endsWith('КОНЕЦ')).toBe(true);
  });
});
