import { TodayService } from './today.service';

/** Поддельная база: каждая коллекция отдаёт заданные строки, любой запрос — как есть. */
function fakeDb(data: Record<string, Array<Record<string, unknown>>>) {
  const coll = (name: string) => ({
    find: () => ({ toArray: async () => data[name] ?? [] }),
    aggregate: () => ({ toArray: async () => [] }),
    countDocuments: async () => 0,
  });
  return { db: { collection: coll } } as never;
}

const NOW = new Date('2026-10-28T06:00:00Z');
const data = {
  supplyrequests: [{ _id: 's1', num: 7, title: 'Болт', neededBy: new Date('2026-10-26T00:00:00Z') }],
  salesorders: [{ _id: 'o1', orderNo: '34', customer: 'ООО', shipDate: new Date('2026-10-29T00:00:00Z') }],
};

function make() {
  const forecast = jest.fn().mockResolvedValue({ days: [{ date: '2026-10-28', expense: 1000, income: 0, closing: -1000 }, { date: '2026-10-29', expense: 0, income: 0, closing: -1000 }] });
  const stock = { listItems: jest.fn().mockResolvedValue({ counts: { ok: 5, low: 2, none: 1 } }) };
  const svc = new TodayService(fakeDb(data), { forecast } as never, stock as never);
  return { svc, forecast, stock };
}

describe('TodayService', () => {
  it('денежная роль: лента с просрочкой, платежом и деньги в метриках', async () => {
    const { svc, forecast } = make();
    const r = await svc.get({ role: 'admin' }, {}, NOW);
    expect(forecast).toHaveBeenCalledWith({ days: 14, today: '2026-10-28' });
    expect(r.feed[0]).toMatchObject({ kind: 'delivery', tone: 'danger', overdueDays: 2 });
    expect(r.feed.map((f) => f.kind)).toEqual(expect.arrayContaining(['delivery', 'payment', 'shipment']));
    expect(r.metrics.money).toEqual({ days: [{ date: '2026-10-28', balance: -1000 }, { date: '2026-10-29', balance: -1000 }] });
    expect(r.metrics.stock).toEqual({ ok: 5, low: 2, none: 1 });
    expect(r.week).toHaveLength(7);
  });

  it('не денежная роль: денег нет ни в ленте, ни в метриках, прогноз не считается', async () => {
    const { svc, forecast } = make();
    const r = await svc.get({ role: 'user' }, {}, NOW);
    expect(forecast).not.toHaveBeenCalled();
    expect(r.metrics.money).toBeUndefined();
    expect(r.feed.some((f) => f.kind === 'payment')).toBe(false);
    expect(r.week.some((d) => d.events.some((e) => e.kind === 'payment'))).toBe(false);
  });

  it('неверный горизонт — 400', async () => {
    await expect(make().svc.get({ role: 'admin' }, { days: '99' }, NOW)).rejects.toThrow('Горизонт');
  });
});
