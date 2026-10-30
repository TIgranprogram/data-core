import { recordSlow, slowSummary } from './slow-request.interceptor';

describe('А4: медленные запросы', () => {
  it('быстрые не пишет, медленные сводит по маршруту', () => {
    recordSlow('GET /a', 200);
    recordSlow('GET /stock/items', 1500);
    recordSlow('GET /stock/items', 2500);
    const s = slowSummary().items.find((x) => x.route === 'GET /stock/items')!;
    expect(s).toMatchObject({ count: 2, maxMs: 2500, avgMs: 2000 });
    expect(slowSummary().items.some((x) => x.route === 'GET /a')).toBe(false);
  });
});

describe('CC-11: интерцептор считает задержки в гистограмму', () => {
  const run = async (handle: () => unknown, status = 200) => {
    const { SlowRequestInterceptor } = await import('./slow-request.interceptor');
    const { latency } = await import('./latency-histogram');
    const { of, throwError, lastValueFrom } = await import('rxjs');
    const { HttpException } = await import('@nestjs/common');
    const ctx = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ method: 'GET', route: { path: '/x' } }), getResponse: () => ({ statusCode: status }) }) };
    const before = latency.snapshot();
    const next = { handle: () => (handle() === 'fail' ? throwError(() => new HttpException('x', 503)) : of(1)) };
    await lastValueFrom(new SlowRequestInterceptor().intercept(ctx as never, next as never)).catch(() => undefined);
    const after = latency.snapshot();
    return { requests: after.requests - before.requests, e5: after.errors5xx - before.errors5xx };
  };

  it('успешный запрос — +1 запрос, без 5xx', async () => {
    expect(await run(() => 'ok')).toEqual({ requests: 1, e5: 0 });
  });
  it('исключение 503 из обработчика — считается как 5xx', async () => {
    expect(await run(() => 'fail')).toEqual({ requests: 1, e5: 1 });
  });
});
