import { LatencyHistogram } from './latency-histogram';

describe('CC-11: гистограмма задержек', () => {
  it('без запросов процентилей нет (null, не 0)', () => {
    const s = new LatencyHistogram().snapshot();
    expect(s).toMatchObject({ requests: 0, p50: null, p95: null, slow: 0, errors5xx: 0 });
  });

  it('считает p50/p95 по верхней границе корзины, медленные и 5xx', () => {
    const h = new LatencyHistogram();
    for (let i = 0; i < 90; i++) h.observe(8); // корзина ≤ 10
    for (let i = 0; i < 8; i++) h.observe(400); // корзина ≤ 500
    h.observe(1500, 200); // медленный
    h.observe(3000, 503); // медленный и 5xx
    const s = h.snapshot();
    expect(s.requests).toBe(100);
    expect(s.p50).toBe(10);
    expect(s.p95).toBe(500);
    expect(s.slow).toBe(2);
    expect(s.errors5xx).toBe(1);
    expect(s.maxMs).toBe(3000);
  });

  it('запрос дольше последней границы: p95 = максимум', () => {
    const h = new LatencyHistogram();
    h.observe(20000);
    expect(h.snapshot().p95).toBe(20000);
  });

  it('снимок со сбросом обнуляет счётчик и сдвигает начало окна', () => {
    const h = new LatencyHistogram();
    h.observe(50, 500);
    const t = new Date('2026-10-31T20:30:00Z');
    expect(h.snapshot(true, t).requests).toBe(1);
    const second = h.snapshot();
    expect(second).toMatchObject({ requests: 0, p50: null, errors5xx: 0, maxMs: 0 });
    expect(second.since).toEqual(t);
  });
});
