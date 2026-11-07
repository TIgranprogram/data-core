import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { oid } from '../../common/list-query';
import type { PartRow, StepRow } from '../../common/work-route-rows';
import { WHOLE_PRODUCT } from '../../common/work-route-rows';
import { DAY_HOURS, DAY_MS, dayOf, fromWorkday, isoDay, lastDay, loadByDay, scheduleSteps, workDays } from '../../common/work-schedule';
import type { StepPatchDto } from './dto/order-line-plan.dto';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type BarStatus = 'plan' | 'work' | 'done';
export interface Bar {
  stepId: string; planId: string; incomeId: string; orderNo: string | null; title: string; partName: string; workTypeName: string;
  assigneeId: string | null; /** 'ГГГГ-ММ-ДД', end включительно */ start: string; end: string; hours: number; status: BarStatus;
  /** Факт-отметки шага и норма на 1 шт. */
  startedAt: Date | null; finishedAt: Date | null; hoursPerUnit: number | null;
}
const MAX_RANGE_DAYS = 366;
const idOf = (v: unknown) => (v ? String(v) : null);

/**
 * Гант-планирование (C041 Э2): полосы шагов планов позиций по людям и заказам и загрузка людей по дням.
 * Даты шагов без ручного срока считаются на лету (`common/work-schedule.ts`), ручной срок хранится в `orderlineplans.steps[].plan {start,end}`.
 */
@Injectable()
export class WorkScheduleService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private db() { return this.connection.db!; }

  /** Полосы всех планов (с позициями «жив») — в порядке плана, с названиями и статусом по заданию «В работе». */
  private async barsOf(plans: Doc[], today: Date): Promise<Array<Bar & { startAt: Date; endAt: Date }>> {
    if (!plans.length) return [];
    const incomeIds = plans.map((p) => p.incomeId as Types.ObjectId);
    const [incomes, tasks, types] = await Promise.all([
      this.db().collection('incomes').find({ _id: { $in: incomeIds }, deletedAt: null }, { projection: { orderNo: 1, title: 1, qty: 1 } }).toArray(),
      this.db().collection('worktasks').find({ incomeId: { $in: incomeIds }, deletedAt: null, status: { $ne: 'cancelled' } }, { projection: { incomeId: 1, status: 1, stepIndex: 1, route: 1, createdAt: 1 } }).sort({ createdAt: 1 }).toArray(),
      this.db().collection('worktypes').find({ deletedAt: null }, { projection: { name: 1 } }).toArray(),
    ]);
    const income = new Map(incomes.map((i) => [String(i._id), i as Doc]));
    const task = new Map(tasks.map((t) => [String(t.incomeId), t as Doc])); // последнее задание перекрывает прежние
    const typeName = new Map(types.map((t) => [String(t._id), String(t.name ?? '')]));
    const out: Array<Bar & { startAt: Date; endAt: Date }> = [];
    for (const plan of plans) {
      const inc = income.get(String(plan.incomeId));
      if (!inc) continue;
      const qty = Number(inc.qty) > 0 ? Number(inc.qty) : 1;
      const partName = new Map(((plan.parts as PartRow[]) ?? []).map((p) => [String(p._id), p.name]));
      const steps = ((plan.steps as StepRow[]) ?? []).filter((s) => typeName.has(String(s.workTypeId)));
      const anchor = plan.launchedAt ? dayOf(new Date(plan.launchedAt)) : today;
      const sched = scheduleSteps(steps.map((s) => ({
        id: String(s._id), part: s.partRowId ? String(s.partRowId) : null, hours: (s.hours ?? 0) * qty,
        plan: s.plan ? { start: new Date(s.plan.start), end: new Date(s.plan.end) } : null,
      })), anchor);
      const t = task.get(String(plan.incomeId));
      const route = (t?.route as Array<{ stepId?: unknown }> | undefined) ?? [];
      steps.forEach((s, i) => {
        let status: BarStatus = 'plan';
        if (t?.status === 'done') status = 'done';
        else if (t?.status === 'work' && typeof t.stepIndex === 'number') {
          const at = route.findIndex((r) => String(r.stepId) === String(s._id));
          if (at >= 0) status = at < t.stepIndex ? 'done' : at === t.stepIndex ? 'work' : 'plan';
        }
        out.push({
          stepId: String(s._id), planId: String(plan._id), incomeId: String(plan.incomeId), orderNo: (inc.orderNo as string | undefined) ?? null, title: String(inc.title ?? ''),
          partName: s.partRowId ? partName.get(String(s.partRowId)) ?? WHOLE_PRODUCT : WHOLE_PRODUCT, workTypeName: typeName.get(String(s.workTypeId))!,
          assigneeId: idOf(s.assigneeId), start: isoDay(sched[i].start), end: isoDay(sched[i].end),
          startedAt: s.startedAt ?? null, finishedAt: s.finishedAt ?? null, hoursPerUnit: s.hours ?? null, hours: Math.round(sched[i].hours * 100) / 100, status,
          startAt: sched[i].start, endAt: sched[i].end,
        });
      });
    }
    return out;
  }

  private async livePlans(extra: Doc = {}): Promise<Doc[]> {
    return (await this.db().collection('orderlineplans').find({ deletedAt: null, ...extra }).toArray()) as Doc[];
  }

  private async people(ids?: string[]) {
    const f: Doc = { deletedAt: null, status: { $nin: ['fired'] } };
    if (ids) f._id = { $in: ids.map((i) => oid(i, 'сотрудника')) };
    const rows = await this.db().collection('persons').find(f, { projection: { lastName: 1, firstName: 1 } }).sort({ lastName: 1, firstName: 1 }).limit(500).toArray();
    return rows.map((r) => ({ id: String(r._id), name: [r.lastName, r.firstName].map((x) => String(x ?? '').trim()).filter(Boolean).join(' '), capacityHours: DAY_HOURS }));
  }

  private strip(b: Bar & { startAt: Date; endAt: Date }): Bar {
    const { startAt, endAt, ...bar } = b; // eslint-disable-line @typescript-eslint/no-unused-vars
    return bar;
  }

  private range(from?: string, to?: string) {
    const today = dayOf(new Date());
    const f = from ? dayOf(new Date(from)) : new Date(today.getTime() - 14 * DAY_MS);
    const t = to ? dayOf(new Date(to)) : new Date(f.getTime() + 75 * DAY_MS);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw new BadRequestException('Дата периода указана неверно');
    if (t < f) throw new BadRequestException('Конец периода раньше начала');
    if ((t.getTime() - f.getTime()) / DAY_MS > MAX_RANGE_DAYS) throw new BadRequestException('Период не длиннее года');
    return { from: f, to: t, today };
  }

  /** Гант: полосы за период (фильтры — человек, заказ, позиция) и загрузка людей по дням. Загрузка считается по всем планам. */
  async schedule(q: { from?: string; to?: string; personId?: string; orderId?: string; incomeId?: string }) {
    const { from, to, today } = this.range(q.from, q.to);
    const all = await this.barsOf(await this.livePlans(), today);
    let scope = all;
    if (q.orderId) {
      const inc = await this.db().collection('incomes').find({ orderId: oid(q.orderId, 'заказа'), deletedAt: null }, { projection: { _id: 1 } }).toArray();
      const ids = new Set(inc.map((i) => String(i._id)));
      scope = scope.filter((b) => ids.has(b.incomeId));
    }
    if (q.incomeId) scope = scope.filter((b) => b.incomeId === String(oid(q.incomeId, 'позиции')));
    if (q.personId) scope = scope.filter((b) => b.assigneeId === String(oid(q.personId, 'сотрудника')));
    const inRange = (b: { startAt: Date; endAt: Date }) => b.endAt >= from && b.startAt <= to;
    const load = loadByDay(all.filter(inRange)).filter((l) => l.date >= isoDay(from) && l.date <= isoDay(to) && (!q.personId || l.personId === q.personId));
    return {
      people: await this.people(q.personId ? [q.personId] : undefined),
      bars: scope.filter(inRange).map((b) => this.strip(b)),
      load,
    };
  }

  /** «Отметить начало / конец» шага: ставит `startedAt` / `finishedAt` (повтор — не перезаписывает). */
  async mark(planId: string, stepId: string, what: 'start' | 'finish') {
    const plans = this.db().collection('orderlineplans');
    const plan = (await plans.findOne({ _id: oid(planId, 'плана'), deletedAt: null })) as Doc | null;
    if (!plan) throw new NotFoundException('План не найден');
    const sid = String(oid(stepId, 'шага'));
    const at = ((plan.steps as StepRow[]) ?? []).findIndex((s) => String(s._id) === sid);
    if (at < 0) throw new NotFoundException('Шага нет в плане');
    const row = (plan.steps as StepRow[])[at];
    const now = new Date();
    const key = what === 'start' ? 'startedAt' : 'finishedAt';
    const set: Doc = { updatedAt: now };
    if (!row[key]) set[`steps.${at}.${key}`] = now;
    if (what === 'finish' && !row.startedAt) set[`steps.${at}.startedAt`] = now; // закончил без «начал» — начало = сейчас
    await plans.updateOne({ _id: plan._id }, { $set: set, $inc: { rev: 1 } });
    const fresh = (await plans.findOne({ _id: plan._id })) as Doc;
    const bar = (await this.barsOf([fresh], dayOf(new Date()))).find((b) => b.stepId === sid)!;
    return { bar, rev: fresh.rev as number };
  }

  /** Назначить исполнителя и/или сдвинуть шаг. Нет `end` — длительность сохраняется; `rev` старый — 409. Ответ: полоса и загрузка затронутых людей. */
  async patchStep(planId: string, stepId: string, dto: StepPatchDto) {
    const plans = this.db().collection('orderlineplans');
    const plan = (await plans.findOne({ _id: oid(planId, 'плана'), deletedAt: null })) as Doc | null;
    if (!plan) throw new NotFoundException('План не найден');
    if (dto.rev !== undefined && dto.rev !== plan.rev) throw new ConflictException('План изменил другой человек — обновите');
    const sid = String(oid(stepId, 'шага'));
    const steps = (plan.steps as StepRow[]) ?? [];
    const at = steps.findIndex((s) => String(s._id) === sid);
    if (at < 0) throw new NotFoundException('Шага нет в плане');
    const today = dayOf(new Date());
    const before = (await this.barsOf([plan], today)).find((b) => b.stepId === sid);
    if (!before) throw new NotFoundException('Позиция плана удалена или вид работ шага удалён');

    const set: Doc = {}, unset: Doc = {};
    if (dto.assigneeId !== undefined) {
      if (dto.assigneeId === null) unset[`steps.${at}.assigneeId`] = '';
      else {
        const p = await this.db().collection('persons').findOne({ _id: oid(dto.assigneeId, 'сотрудника'), deletedAt: null }, { projection: { status: 1 } });
        if (!p) throw new BadRequestException('Сотрудник не найден — выберите из списка');
        if (p.status === 'fired') throw new BadRequestException('Сотрудник уволен — выберите другого');
        set[`steps.${at}.assigneeId`] = p._id;
      }
    }
    if (dto.hours !== undefined) set[`steps.${at}.hours`] = dto.hours; // норма часов на 1 шт.
    if (dto.start !== undefined || dto.end !== undefined) {
      const start = dto.start ? fromWorkday(new Date(dto.start)) : before.startAt;
      const end = dto.end ? dayOf(new Date(dto.end)) : dto.start ? lastDay(start, workDays(before.startAt, before.endAt).length) : before.endAt;
      if (end < start) throw new BadRequestException('Конец работы раньше начала');
      set[`steps.${at}.plan`] = { start, end };
    }
    if (!Object.keys(set).length && !Object.keys(unset).length) throw new BadRequestException('Укажите исполнителя или даты');
    const now = new Date();
    const res = await plans.updateOne({ _id: plan._id, rev: plan.rev }, { $set: { ...set, updatedAt: now }, ...(Object.keys(unset).length ? { $unset: unset } : {}), $inc: { rev: 1 } });
    if (!res.matchedCount) throw new ConflictException('План изменил другой человек — обновите');

    const fresh = (await plans.findOne({ _id: plan._id })) as Doc;
    const after = (await this.barsOf([fresh], today)).find((b) => b.stepId === sid)!;
    const who = [...new Set([before.assigneeId, after.assigneeId].filter(Boolean))] as string[];
    const from = new Date(Math.min(before.startAt.getTime(), after.startAt.getTime())), to = new Date(Math.max(before.endAt.getTime(), after.endAt.getTime()));
    const all = who.length ? await this.barsOf(await this.livePlans({ 'steps.assigneeId': { $in: who.map((w) => new Types.ObjectId(w)) } }), today) : [];
    const load = loadByDay(all.filter((b) => b.endAt >= from && b.startAt <= to)).filter((l) => who.includes(l.personId) && l.date >= isoDay(from) && l.date <= isoDay(to));
    return { bar: this.strip(after), load, rev: fresh.rev as number };
  }
}
