import { PartnersService } from './partners.service';

/** Скорость списка: вкладка «Заказчики» считает заказчиков один раз, счётчик на других вкладках совпадает с длиной списка. */
function setup() {
  const so = [{ _id: 'ООО Ромашка', n: 2, active: 1, last: null }, { _id: 'ИП Сахаджи', n: 1, active: 0, last: null }];
  const orgs = [{ _id: 'o1', name: 'ооо «ромашка»' }, { _id: 'o2', name: 'Без заказов' }];
  const agg = jest.fn(async (p: Array<Record<string, any>>) => (p[1].$group._id === '$customer' && 'n' in p[1].$group ? so : p[1].$group.sum ? [{ _id: 'ООО Ромашка', sum: 100 }] : so.map((x) => ({ _id: x._id }))));
  const coll = (n: string) => ({
    aggregate: (p: unknown[]) => ({ toArray: () => agg(p as never) }),
    find: () => ({ toArray: async () => (n === 'organizations' ? orgs : []) }),
    countDocuments: async () => 0,
  });
  const svc = new PartnersService({ db: { collection: coll } } as never);
  return { svc, agg };
}

describe('PartnersService.list — заказчики', () => {
  it('счётчик «заказчики» равен длине списка заказчиков', async () => {
    const t = setup();
    const c: any = await t.svc.list({ type: 'customer' });
    const s: any = await t.svc.list({ type: 'supplier' });
    expect(c.items.length).toBe(3);
    expect(c.counts.customer).toBe(3);
    expect(s.counts.customer).toBe(3);
  });
  it('на вкладке «Заказчики» агрегаты идут один раз (salesorders + incomes)', async () => {
    const t = setup();
    await t.svc.list({ type: 'customer' });
    expect(t.agg).toHaveBeenCalledTimes(2);
  });
});
