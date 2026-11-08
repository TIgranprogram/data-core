import { Types } from 'mongoose';
import { taskBars } from './task-bars';

/** Мок базы: коллекция → строки; find(...).toArray() отдаёт строки, прошедшие простой фильтр по incomeId/$in и deletedAt. */
const fakeDb = (data: Record<string, Array<Record<string, unknown>>>) => ({
  collection: (name: string) => ({
    find: (f: Record<string, any> = {}) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      toArray: async () => (data[name] ?? []).filter((r) => {
        const inc = f.incomeId?.$in as Types.ObjectId[] | undefined;
        if (inc && !inc.some((x) => String(x) === String(r.incomeId))) return false;
        const ids = f._id?.$in as Types.ObjectId[] | undefined;
        if (ids && !ids.some((x) => String(x) === String(r._id))) return false;
        return true;
      }),
    }),
  }),
});

describe('C053: задания без плана позиции — полосы Ганта', () => {
  const wt1 = new Types.ObjectId(), wt2 = new Types.ObjectId(), inc1 = new Types.ObjectId(), inc2 = new Types.ObjectId();
  const task = (incomeId: Types.ObjectId, stepIndex: number) => ({
    _id: new Types.ObjectId(), incomeId, stepIndex, route: [{ workTypeId: wt1, name: 'Резка' }, { workTypeId: wt2, name: 'Сварка' }],
    startedAt: new Date('2026-11-02T00:00:00Z'), deletedAt: null, status: 'work',
  });
  const base = { today: new Date('2026-11-08T00:00:00Z'), deadline: () => null, overdue: () => false, hueOf: () => 3 };

  it('шаги маршрута — цепочкой, статус по stepIndex, сделанный шаг не двигается', async () => {
    const db = fakeDb({ worktasks: [task(inc1, 1)], orderlineplans: [], incomes: [{ _id: inc1, title: 'Скамья', qty: 1, orderNo: '11-26' }], worktypes: [{ _id: wt1, days: 2 }, { _id: wt2, days: 3 }], salesorders: [] });
    const bars = await taskBars(db as never, base);
    expect(bars.map((b) => [b.workTypeName, b.status, b.start, b.end, b.locked])).toEqual([
      ['Резка', 'done', '2026-11-02', '2026-11-03', true],
      ['Сварка', 'work', '2026-11-04', '2026-11-06', false],
    ]);
    expect(bars[0]).toMatchObject({ orderNo: '11-26', productName: 'Скамья', hue: 3, planId: '' });
  });

  it('у позиции есть план — задание не дублируется', async () => {
    const db = fakeDb({ worktasks: [task(inc1, 0), task(inc2, 0)], orderlineplans: [{ incomeId: inc1 }], incomes: [{ _id: inc2, title: 'Урна' }], worktypes: [], salesorders: [] });
    const bars = await taskBars(db as never, base);
    expect(new Set(bars.map((b) => b.incomeId))).toEqual(new Set([String(inc2)]));
  });
});
