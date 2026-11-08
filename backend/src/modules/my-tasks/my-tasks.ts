import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DAY_MS, dayOf, isoDay } from '../../common/work-schedule';
import { WHOLE_PRODUCT, type StepRow } from '../../common/work-route-rows';

/**
 * «Мои задания» (C050): чистая логика. Задание рабочего = шаг плана позиции (`orderlineplans.steps[]`),
 * где `assigneeId` — его сотрудник (`persons._id`, найден по `persons.userId`).
 * В ответ рабочему идёт ЯВНЫЙ список полей (`TaskItem`) — без денег, ставок, часов к оплате и чужих людей.
 */
export type TaskState = 'waiting' | 'working' | 'deferred' | 'problem' | 'done';
export type TaskAction = 'start' | 'finish' | 'defer' | 'problem';

export interface TaskItem {
  planId: string;
  stepId: string;
  /** Изделие (название позиции заказа). */
  title: string;
  /** Часть изделия или «Изделие целиком». */
  partName: string;
  workTypeName: string;
  orderNo: string | null;
  /** Срок заказа (отгрузка), ГГГГ-ММ-ДД. */
  due: string | null;
  /** Ручной план шага из Ганта, ГГГГ-ММ-ДД. */
  planStart: string | null;
  planEnd: string | null;
  /** Норма времени на шаг, часов (норма на 1 шт. × количество) — не деньги. */
  normHours: number | null;
  state: TaskState;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** Причина «Отложено» или «Проблема». */
  reason: string | null;
  deferUntil: string | null;
  note: string | null;
}

/** Поля шага, которые видит рабочий. Нужны, чтобы запрос читал только их (и e2e мог сверить). */
export const TASK_ITEM_KEYS: ReadonlyArray<keyof TaskItem> = ['planId', 'stepId', 'title', 'partName', 'workTypeName', 'orderNo', 'due', 'planStart', 'planEnd', 'normHours', 'state', 'startedAt', 'finishedAt', 'reason', 'deferUntil', 'note'];

export function stepState(s: Pick<StepRow, 'startedAt' | 'finishedAt' | 'status'>): TaskState {
  if (s.finishedAt) return 'done';
  if (s.status === 'problem') return 'problem';
  if (s.status === 'deferred') return 'deferred';
  return s.startedAt ? 'working' : 'waiting';
}

/** Шаг «моё» — назначен этому сотруднику. */
export const isMine = (s: Pick<StepRow, 'assigneeId'>, personId: Types.ObjectId): boolean => !!s.assigneeId && String(s.assigneeId) === String(personId);

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Задания рабочего из запущенных планов: только его шаги; готовые — только за последние сутки. */
export function buildTasks(
  plans: Doc[],
  personId: Types.ObjectId,
  ctx: { incomes: Map<string, Doc>; typeNames: Map<string, string>; now: Date; /** не прятать давно готовые (ответ на действие) */ keepDone?: boolean },
): TaskItem[] {
  const doneSince = ctx.now.getTime() - DAY_MS;
  const out: TaskItem[] = [];
  for (const plan of plans) {
    const inc = ctx.incomes.get(String(plan.incomeId));
    if (!inc) continue; // позиция удалена
    const qty = Number(inc.qty) > 0 ? Number(inc.qty) : 1;
    const parts = new Map(((plan.parts as Doc[]) ?? []).map((p) => [String(p._id), String(p.name ?? '')]));
    for (const s of (plan.steps as StepRow[]) ?? []) {
      if (!isMine(s, personId) || !ctx.typeNames.has(String(s.workTypeId))) continue;
      if (!ctx.keepDone && s.finishedAt && new Date(s.finishedAt).getTime() < doneSince) continue;
      out.push({
        planId: String(plan._id), stepId: String(s._id), title: String(inc.title ?? ''),
        partName: s.partRowId ? parts.get(String(s.partRowId)) || WHOLE_PRODUCT : WHOLE_PRODUCT,
        workTypeName: ctx.typeNames.get(String(s.workTypeId))!,
        orderNo: inc.orderNo ? String(inc.orderNo) : null,
        due: inc.shipDate ? isoDay(new Date(inc.shipDate)) : null,
        planStart: s.plan?.start ? isoDay(new Date(s.plan.start)) : null,
        planEnd: s.plan?.end ? isoDay(new Date(s.plan.end)) : null,
        normHours: s.hours !== undefined && s.hours !== null ? Math.round(Number(s.hours) * qty * 100) / 100 : null,
        state: stepState(s), startedAt: s.startedAt ?? null, finishedAt: s.finishedAt ?? null,
        reason: s.statusReason ? String(s.statusReason) : null,
        deferUntil: s.deferUntil ? isoDay(new Date(s.deferUntil)) : null,
        note: s.note ? String(s.note) : null,
      });
    }
  }
  return out.sort(compareTasks);
}

const RANK: Record<TaskState, number> = { working: 0, problem: 1, waiting: 2, deferred: 3, done: 4 };
/** Порядок списка: в работе, потом ждущие по плану/сроку, отложенные, готовые. */
export function compareTasks(a: TaskItem, b: TaskItem): number {
  return RANK[a.state] - RANK[b.state]
    || (a.planStart ?? a.due ?? '9999').localeCompare(b.planStart ?? b.due ?? '9999')
    || a.title.localeCompare(b.title, 'ru');
}

/** Фильтр «шаг принадлежит этому сотруднику»: плюс условия состояния шага. Позиционный `steps.$` пишет именно в совпавший шаг. */
export function ownStepFilter(planId: Types.ObjectId, stepId: Types.ObjectId, personId: Types.ObjectId, stepCond: Doc = {}): Doc {
  return { _id: planId, deletedAt: null, steps: { $elemMatch: { _id: stepId, assigneeId: personId, ...stepCond } } };
}

/** Время нажатия с телефона (работа без связи, C051): не из будущего и не старше суток — иначе серверное. */
export function clickTime(client: string | undefined, now: Date): Date {
  const t = client ? Date.parse(client) : NaN;
  return Number.isFinite(t) && t <= now.getTime() + 5 * 60_000 && t >= now.getTime() - DAY_MS ? new Date(Math.min(t, now.getTime())) : now;
}

/** Причина обязательна, до 200 знаков. */
export function cleanReason(reason: unknown): string {
  const r = String(reason ?? '').trim();
  if (!r) throw new BadRequestException('Укажите причину');
  if (r.length > 200) throw new BadRequestException('Причина не длиннее 200 знаков');
  return r;
}

/** «На когда» отложено: пусто — завтра; прошлое — 400. Начало дня UTC. */
export function deferDate(until: string | undefined, now: Date): Date {
  const today = dayOf(now);
  if (!until) return new Date(today.getTime() + DAY_MS);
  const t = Date.parse(until);
  if (!Number.isFinite(t)) throw new BadRequestException('Дата указана неверно');
  const d = dayOf(new Date(t));
  if (d < today) throw new BadRequestException('Отложить можно только на сегодня или позже');
  if (d.getTime() - today.getTime() > 90 * DAY_MS) throw new BadRequestException('Отложить можно не дальше чем на 90 дней');
  return d;
}
