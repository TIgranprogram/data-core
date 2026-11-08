/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkScheduleService, personDayHours } from './work-schedule.service';

type Row = Record<string, any>;
const same = (a: unknown, b: unknown) => String(a ?? null) === String(b ?? null);

/** Мини-коллекция: равенство, $in, $nin, $ne (достаточно для people и patchStep). */
class Coll {
  rows: Row[] = [];
  private ok(d: Row, f: Row) {
    return Object.entries(f).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Types.ObjectId) && '$in' in v) return v.$in.some((x: unknown) => same(d[k], x));
      if (v && typeof v === 'object' && !(v instanceof Types.ObjectId) && '$nin' in v) return !v.$nin.some((x: unknown) => same(d[k], x));
      if (v && typeof v === 'object' && !(v instanceof Types.ObjectId) && '$ne' in v) return !same(d[k], v.$ne);
      return same(d[k], v);
    });
  }
  find = (f: Row = {}) => { const c: Row = { sort: () => c, limit: () => c, toArray: async () => this.rows.filter((d) => this.ok(d, f)) }; return c; };
  findOne = async (f: Row = {}) => this.rows.find((d) => this.ok(d, f)) ?? null;
  updateOne = async (f: Row, u: Row) => { const r = this.rows.find((d) => this.ok(d, f)); if (r) Object.assign(r, u.$set ?? {}); return { matchedCount: r ? 1 : 0 }; };
}

describe('WorkScheduleService: люди Ганта и вид работ исполнителя (C047 Э1)', () => {
  const id = () => new Types.ObjectId();
  let c: Record<string, Coll>, svc: WorkScheduleService;
  const weld = id(), cut = id(), inc = id(), planId = id(), stepId = id(), step2 = id();
  const welder = id(), acc = id(), old = id(), fired = id();

  beforeEach(() => {
    c = Object.fromEntries(['persons', 'worktypes', 'incomes', 'worktasks', 'orderlineplans'].map((n) => [n, new Coll()]));
    svc = new WorkScheduleService({ db: { collection: (n: string) => c[n] } } as never, {} as never);
    c.worktypes.rows.push({ _id: weld, name: 'Сварка', deletedAt: null }, { _id: cut, name: 'Резка', deletedAt: null });
    c.persons.rows.push(
      { _id: welder, lastName: 'Иванов', firstName: 'Иван', workTypeIds: [weld], hoursPerDay: 10, deletedAt: null },
      { _id: acc, lastName: 'Бухгалтерова', firstName: 'Анна', deletedAt: null },
      { _id: old, lastName: 'Старый', firstName: 'Сергей', workTypeId: cut, deletedAt: null },
      { _id: fired, lastName: 'Уволенов', firstName: 'Олег', workTypeIds: [weld], status: 'fired', deletedAt: null },
    );
    c.incomes.rows.push({ _id: inc, title: 'Беседка', qty: 1, deletedAt: null });
    c.orderlineplans.rows.push({ _id: planId, incomeId: inc, rev: 1, deletedAt: null, steps: [{ _id: stepId, workTypeId: weld, hours: 4 }, { _id: step2, workTypeId: cut, hours: 2 }] });
  });

  it('people: только с видами работ (новое и старое поле), уволенные и бухгалтер не попадают; ёмкость — hoursPerDay, пусто — 8', async () => {
    const r = await (svc as any).people();
    expect(r.map((p: Row) => p.name)).toEqual(['Иванов Иван', 'Старый Сергей']);
    expect(r.map((p: Row) => p.capacityHours)).toEqual([10, 8]);
  });

  it('personDayHours: целое 1–24, иначе 8', () => {
    expect([personDayHours({ hoursPerDay: 6 }), personDayHours({}), personDayHours({ hoursPerDay: 0 }), personDayHours({ hoursPerDay: 25 }), personDayHours({ hoursPerDay: 7.5 })]).toEqual([6, 8, 8, 8, 8]);
  });

  it('назначение: у человека нет вида работ шага — 400 с названием вида', async () => {
    await expect(svc.patchStep(String(planId), String(stepId), { assigneeId: String(old) } as never))
      .rejects.toThrow(new BadRequestException('У сотрудника нет вида работ «Сварка»'));
  });

  it('назначение: вид работ есть — проверка проходит', async () => {
    const r = await svc.patchStep(String(planId), String(stepId), { assigneeId: String(welder) } as never).catch((e) => e);
    expect(r).not.toBeInstanceOf(BadRequestException);
  });
});
