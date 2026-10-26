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
