/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkScheduleService, personDayHours, barDeadline, barOverdue, workTypeHue } from './work-schedule.service';

type Row = Record<string, any>;
const same = (a: unknown, b: unknown) => String(a ?? null) === String(b ?? null);

/** Мини-коллекция: равенство, $in, $nin, $ne, steps.assigneeId (достаточно для people, patchStep и Ганта). */
class Coll {
  rows: Row[] = [];
  private ok(d: Row, f: Row) {
    return Object.entries(f).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Types.ObjectId) && '$in' in v) return v.$in.some((x: unknown) => same(d[k], x));
      if (v && typeof v === 'object' && !(v instanceof Types.ObjectId) && '$nin' in v) return !v.$nin.some((x: unknown) => same(d[k], x));
      if (v && typeof v === 'object' && !(v instanceof Types.ObjectId) && '$ne' in v) return !same(d[k], v.$ne);
      if (k === 'steps.assigneeId') return (d.steps ?? []).some((st: Row) => same(st.assigneeId, v));
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
    c = Object.fromEntries(['persons', 'worktypes', 'incomes', 'worktasks', 'orderlineplans', 'salesorders', 'designtasks'].map((n) => [n, new Coll()]));
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

describe('Гант-дерево (C053 Э1): фильтры в БД, поля, legend/hue', () => {
  const id = () => new Types.ObjectId();
  const mk = () => {
    const c = Object.fromEntries(['persons', 'worktypes', 'incomes', 'worktasks', 'orderlineplans', 'salesorders', 'designtasks', 'products'].map((n) => [n, new Coll()])) as Record<string, Coll>;
    const finds: Row[] = [];
    const orig = c.orderlineplans.find;
    c.orderlineplans.find = (f: Row = {}) => { finds.push(f); return orig(f); };
    return { c, finds, svc: new WorkScheduleService({ db: { collection: (n: string) => c[n] } } as never, {} as never) };
  };
  const weld = id(), cut = id(), ann = id(), bob = id(), ord1 = id(), ord2 = id(), inc1 = id(), inc2 = id(), prod = id(), part = id(), row = id();
  const seed = (c: Record<string, Coll>) => {
    c.worktypes.rows.push({ _id: weld, name: 'Сварка', accentHue: 180, deletedAt: null }, { _id: cut, name: 'Резка', deletedAt: null });
    c.persons.rows.push({ _id: ann, lastName: 'Анн', workTypeIds: [weld, cut], deletedAt: null }, { _id: bob, lastName: 'Боб', workTypeIds: [cut], deletedAt: null });
    c.products.rows.push({ _id: prod, name: 'Беседка-1' });
    c.incomes.rows.push({ _id: inc1, title: 'Поз1', qty: 1, orderId: ord1, productId: prod, deletedAt: null }, { _id: inc2, title: 'Поз2', qty: 1, orderId: ord2, deletedAt: null });
    c.orderlineplans.rows.push(
      { _id: id(), incomeId: inc1, rev: 1, deletedAt: null, parts: [{ _id: row, name: 'Рама', partId: part }], steps: [{ _id: id(), workTypeId: weld, hours: 4, assigneeId: ann, partRowId: row }] },
      { _id: id(), incomeId: inc2, rev: 1, deletedAt: null, steps: [{ _id: id(), workTypeId: cut, hours: 4, assigneeId: bob }] },
    );
  };

  it('поля полосы, people.workTypeIds и legend (только встречающиеся виды)', async () => {
    const { c, svc } = mk(); seed(c);
    const r = await svc.schedule({});
    const a = r.bars.find((b) => b.assigneeId === String(ann))!;
    expect([a.orderId, a.productName, a.partId, a.hue]).toEqual([String(ord1), 'Беседка-1', String(part), workTypeHue(String(weld), 180)]);
    expect(a.partRowId).toBe(String(row));
    const b = r.bars.find((x) => x.assigneeId === String(bob))!;
    expect(b.partRowId).toBeNull();
    expect([b.productName, b.partId]).toEqual(['Поз2', null]); // нет изделия — название позиции
    expect(r.people.find((p) => p.id === String(ann))!.workTypeIds).toEqual([String(weld), String(cut)]);
    expect(r.legend.map((l) => l.name)).toEqual(['Резка', 'Сварка']);
    expect(r.legend.find((l) => l.name === 'Сварка')!.hue).toBe(a.hue);
  });

  it('фильтры уходят в запрос к БД: чужие планы не загружаются', async () => {
    const { c, finds, svc } = mk(); seed(c);
    const r = await svc.schedule({ orderId: String(ord1) });
    expect(r.bars.map((x) => x.orderId)).toEqual([String(ord1)]);
    expect(finds[0]).toHaveProperty('incomeId');
    const m = mk(); seed(m.c);
    const p = await m.svc.schedule({ personId: String(bob) });
    expect(p.bars.map((x) => x.assigneeId)).toEqual([String(bob)]);
    expect(m.finds[0]).toHaveProperty(['steps.assigneeId']);
    expect(m.finds.every((f) => 'incomeId' in f || 'steps.assigneeId' in f || 'deletedAt' in f)).toBe(true);
  });

  it('workTypeHue: 1..7, стабильный; accentHue приоритетнее', () => {
    const ids = Array.from({ length: 50 }, () => String(new Types.ObjectId()));
    for (const x of ids) { const h = workTypeHue(x); expect(h).toBe(workTypeHue(x)); expect(h >= 1 && h <= 7).toBe(true); }
    expect(workTypeHue('x', 0)).toBe(1);
    expect(workTypeHue('x', 359)).toBe(7);
  });
});

describe('срок заказа и просрочка полосы (T6 ядро)', () => {
  it('barDeadline: изготовление, иначе отгрузка, иначе null', () => {
    const a = new Date('2026-11-02T00:00:00Z'), b = new Date('2026-11-10T00:00:00Z');
    expect(barDeadline({ productionDeadline: a, shipDate: b })).toBe(a);
    expect(barDeadline({ shipDate: b })).toBe(b);
    expect(barDeadline({})).toBeNull();
    expect(barDeadline(undefined)).toBeNull();
  });

  it('barOverdue: срок прошёл и не сделано — просрочен; сделано/нет срока/не наступил — нет', () => {
    const past = new Date('2026-11-02T00:00:00Z'), today = new Date('2026-11-08T00:00:00Z'), future = new Date('2026-11-20T00:00:00Z');
    expect(barOverdue(past, today, 'plan')).toBe(true);
    expect(barOverdue(past, today, 'work')).toBe(true);
    expect(barOverdue(past, today, 'done')).toBe(false);
    expect(barOverdue(null, today, 'plan')).toBe(false);
    expect(barOverdue(future, today, 'plan')).toBe(false);
  });

  it('полоса несёт deadline и overdue из заказа', async () => {
    const id = () => new Types.ObjectId();
    const c = Object.fromEntries(['persons', 'worktypes', 'incomes', 'worktasks', 'orderlineplans', 'salesorders', 'designtasks'].map((n) => [n, new Coll()])) as Record<string, Coll>;
    const svc2 = new WorkScheduleService({ db: { collection: (n: string) => c[n] } } as never, {} as never);
    const weld = id(), inc = id(), planId = id(), stepId = id(), orderId = id();
    const past = new Date(Date.now() - 10 * 86400000);
    c.worktypes.rows.push({ _id: weld, name: 'Сварка', deletedAt: null });
    c.incomes.rows.push({ _id: inc, title: 'Беседка', qty: 1, orderNo: '34', orderId, deletedAt: null });
    c.salesorders.rows.push({ _id: orderId, productionDeadline: past, deletedAt: null });
    c.orderlineplans.rows.push({ _id: planId, incomeId: inc, rev: 1, deletedAt: null, steps: [{ _id: stepId, workTypeId: weld, hours: 4 }] });
    c.designtasks.rows.push({ _id: id(), incomeId: inc, status: 'work', deletedAt: null });
    const bars = await (svc2 as any).barsOf([c.orderlineplans.rows[0]], new Date());
    const bar = bars.find((b: Row) => b.stepId === String(stepId));
    expect(bar.deadline).toBe(past.toISOString().slice(0, 10));
    expect(bar.overdue).toBe(true);
    expect(bar.inDesign).toBe(true);
  });
});
