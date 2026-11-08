import { Types, type Connection } from 'mongoose';
import { WHOLE_PRODUCT } from '../../common/work-route-rows';
import { dayOf, isoDay } from '../../common/work-schedule';
import { computePlan } from '../work/work-plan';
import type { WorkStep } from '../work/work-task.schema';

type Db = NonNullable<Connection['db']>;
type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 86_400_000;

/**
 * Задания «В работе» без плана позиции (запущены по маршруту изделия, до C041) — тоже полосы Ганта (C053, регрессия v1.635:
 * на проде 8 заданий в работе, а новый Гант показывал «работ нет»). Шаги — маршрут задания, даты — `computePlan` (как в старом Ганте),
 * статус по `stepIndex`. Полоса только для просмотра (`locked`): переставлять — через план позиции («Состав» → «Запланировать»).
 */
export async function taskBars(db: Db, o: { incomeIds?: Types.ObjectId[] | null; person?: Types.ObjectId | null; today: Date;
  deadline: (order: Doc | undefined) => Date | null; overdue: (dl: Date | null, today: Date, status: 'plan' | 'work' | 'done') => boolean; hueOf: (id: string, accent?: number | null) => number }) {
  const f: Doc = { deletedAt: null, status: { $in: ['waiting', 'work'] } };
  if (o.incomeIds) f.incomeId = { $in: o.incomeIds };
  if (o.person) f.assigneeId = o.person;
  const tasks = ((await db.collection('worktasks').find(f, { projection: { seq: 1, incomeId: 1, orderId: 1, productId: 1, route: 1, stepIndex: 1, assigneeId: 1, startedAt: 1, createdAt: 1 } }).toArray()) as Doc[])
    .filter((t) => Array.isArray(t.route) && t.route.length);
  if (!tasks.length) return [];
  // у позиции уже есть план (C041) — её шаги рисуются из плана, задание не дублируем
  const planned = new Set((await db.collection('orderlineplans').find({ incomeId: { $in: tasks.map((t) => t.incomeId) }, deletedAt: null }, { projection: { incomeId: 1 } }).toArray()).map((x) => String(x.incomeId)));
  const live = tasks.filter((t) => !planned.has(String(t.incomeId)));
  if (!live.length) return [];
  const incomeIds = live.map((t) => t.incomeId as Types.ObjectId);
  const typeIds = [...new Set(live.flatMap((t) => (t.route as WorkStep[]).map((s) => String(s.workTypeId ?? ''))).filter((x) => Types.ObjectId.isValid(x)))].map((x) => new Types.ObjectId(x));
  const orderIds = [...new Set(live.map((t) => String(t.orderId ?? '')).filter((x) => Types.ObjectId.isValid(x)))].map((x) => new Types.ObjectId(x));
  const [incomes, types, orders] = await Promise.all([
    db.collection('incomes').find({ _id: { $in: incomeIds } }, { projection: { orderNo: 1, title: 1, qty: 1, orderId: 1 } }).toArray(),
    typeIds.length ? db.collection('worktypes').find({ _id: { $in: typeIds } }, { projection: { days: 1, accentHue: 1 } }).toArray() : Promise.resolve([] as Doc[]),
    orderIds.length ? db.collection('salesorders').find({ _id: { $in: orderIds } }, { projection: { productionDeadline: 1, shipDate: 1 } }).toArray() : Promise.resolve([] as Doc[]),
  ]);
  const order = new Map(orders.map((x) => [String(x._id), x as Doc]));
  const inc = new Map(incomes.map((i) => [String(i._id), i as Doc]));
  const days = new Map(types.map((t) => [String(t._id), Number(t.days) || 0] as [string, number]).filter(([, n]) => n > 0));
  const accent = new Map(types.map((t) => [String(t._id), (t as Doc).accentHue as number | null | undefined]));
  const out: Doc[] = [];
  for (const t of live) {
    const i = inc.get(String(t.incomeId)); const route = t.route as WorkStep[];
    const orderId = String(t.orderId ?? i?.orderId ?? '') || null;
    const dl = orderId ? o.deadline(order.get(orderId)) : null;
    const plan = computePlan(route, (i?.qty as number | undefined) ?? null, days, (t.startedAt as Date | undefined) ?? (t.createdAt as Date | undefined) ?? o.today);
    plan.forEach((p, k) => {
      const at = t.stepIndex as number | null;
      const status: 'plan' | 'work' | 'done' = at == null ? 'plan' : k < at ? 'done' : k === at ? 'work' : 'plan';
      const startAt = dayOf(p.start), endAt = new Date(dayOf(p.end).getTime() - DAY); // computePlan: end — начало следующего дня
      const wt = String(route[k].workTypeId ?? '') || null;
      out.push({
        stepId: `task:${String(t._id)}:${k}`, planId: '', taskId: String(t._id), locked: true, incomeId: String(t.incomeId), orderNo: (i?.orderNo as string | undefined) ?? null,
        title: String(i?.title ?? ''), partName: WHOLE_PRODUCT, workTypeName: route[k].name, workTypeId: wt, assigneeId: t.assigneeId ? String(t.assigneeId) : null,
        start: isoDay(startAt), end: isoDay(endAt < startAt ? startAt : endAt), hours: 0, status, startedAt: null, finishedAt: null, hoursPerUnit: null,
        deadline: dl ? isoDay(dl) : null, overdue: o.overdue(dl, o.today, status), inDesign: false,
        orderId, productName: String(i?.title ?? ''), partId: null, partRowId: null, hue: wt ? o.hueOf(wt, accent.get(wt)) : null,
        startAt, endAt: endAt < startAt ? startAt : endAt,
      });
    });
  }
  return out;
}
