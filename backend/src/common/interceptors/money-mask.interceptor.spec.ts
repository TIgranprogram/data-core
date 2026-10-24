import { lastValueFrom, of } from 'rxjs';
import { MoneyMaskInterceptor } from './money-mask.interceptor';

const run = async (role: string, data: unknown, query: Record<string, unknown> = {}) => {
  const req = { user: { role }, body: {}, query };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as never;
  const out = await lastValueFrom(new MoneyMaskInterceptor().intercept(ctx, { handle: () => of(data) }));
  return { out: out as Record<string, unknown>, query };
};

describe('MoneyMaskInterceptor — статус оплаты (2026-10-24)', () => {
  const resp = { items: [{ status: 'paid', amount: 5 }, { status: 'awaiting' }, { status: 'draft' }], counts: { all: 6, paid: 1, awaiting: 2, noamount: 1, draft: 2 } };

  it('роль без денег: оплачено / ждём оплату → «отгружено», счётчики без оплат, сумм нет', async () => {
    const { out } = await run('manager', resp);
    expect((out.items as Record<string, unknown>[]).map((x) => x.status)).toEqual(['shipped', 'shipped', 'draft']);
    expect((out.items as Record<string, unknown>[])[0].amount).toBeUndefined();
    expect(out.counts).toEqual({ all: 6, draft: 2, shipped: 4 });
  });

  it('роль без денег: фильтр по оплате → «отгружено», сортировка по денежному полю снимается', async () => {
    const { query } = await run('manager', {}, { status: 'paid', sort: '-paidDate' });
    expect(query).toEqual({ status: 'shipped' });
  });

  it('бухгалтер видит всё как было', async () => {
    const { out } = await run('accountant', resp);
    expect(out).toBe(resp);
  });
});
