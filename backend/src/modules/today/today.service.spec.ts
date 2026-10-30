import { Types } from 'mongoose';
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

  it('счётчики меню: все разделы админу; без денег — нет «ждём оплату»', async () => {
    const { svc } = make();
    expect(await svc.counters({ role: 'admin' })).toEqual({ requests: 0, stockLow: 3, awaiting: 0, salesorders: 0, design: 0, work: 0 });
    expect(await svc.counters({ role: 'user' })).not.toHaveProperty('awaiting');
  });

  it('неверный горизонт — 400', async () => {
    await expect(make().svc.get({ role: 'admin' }, { days: '99' }, NOW)).rejects.toThrow('Горизонт');
  });
  describe('«В работе»', () => {
    const oid = () => new Types.ObjectId();
    const ord = oid(), noDl = oid();
    const mk = (extra: Record<string, unknown>) => ({ _id: oid(), seq: 1, status: 'work', route: [{ name: 'Сварка' }, { name: 'Покраска' }], stepIndex: 0, incomeId: oid(), ...extra });
    const wdata = {
      salesorders: [
        { _id: ord, orderNo: '34', productionNo: '77', customer: 'ООО Ромашка', shipDate: new Date('2026-10-29T00:00:00Z') },
        { _id: noDl, orderNo: '35', customer: 'ООО' },
      ],
      worktasks: [mk({ orderId: ord, assigneeId: 'p1' }), mk({ orderId: ord, assigneeId: 'p2' }), mk({ orderId: noDl, assigneeId: 'p1' })],
    };
    const build = () => {
      const zones = { scopeOf: jest.fn().mockResolvedValue({ personId: 'p1', zoneCodes: [], management: false }) };
      const svc = new TodayService(fakeDb(wdata), { forecast: jest.fn() } as never, { listItems: jest.fn().mockResolvedValue({ counts: { ok: 0, low: 0, none: 0 } }) } as never, zones as never);
      return svc;
    };

    it('задание со сроком заказа — дело work с исполнителем; без срока — нет', async () => {
      const r = await build().get({ role: 'admin' }, { scope: 'all' }, NOW);
      const w = r.feed.filter((f) => f.kind === 'work');
      expect(w).toHaveLength(2);
      expect(w[0]).toMatchObject({ kind: 'work', personId: 'p1', due: '2026-10-29', actions: [], sub: 'ООО Ромашка · заказ № 77' });
      expect(w[0].title).toContain('· Сварка');
      expect(r.metrics.work).toBe(0);
    });

    it('«Моё» оставляет только свои задания', async () => {
      const r = await build().get({ role: 'user' }, { scope: 'mine' }, NOW);
      expect(r.feed.filter((f) => f.kind === 'work').map((f) => f.personId)).toEqual(['p1']);
    });
  });
});
