import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { oid } from '../../common/list-query';
import { WorkFactsService } from '../order-line-plan/work-facts.service';
import type { MyTaskActionDto } from './dto/my-task.dto';
import { buildTasks, cleanReason, clickTime, deferDate, ownStepFilter, stepState, type TaskAction, type TaskItem } from './my-tasks';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const NOT_YOURS = 'Это задание назначено не вам';
/** Что стирается со шага, когда он снова в работе или закончен. */
const CLEAR_STATUS = { 'steps.$.status': '', 'steps.$.statusReason': '', 'steps.$.deferUntil': '', 'steps.$.statusAt': '' };

/**
 * «Мои задания» (C050): шаги планов позиций, назначенные сотруднику, чей вход — текущий пользователь (`persons.userId`).
 * Действия — одна атомарная запись `updateOne` с фильтром «шаг принадлежит этому сотруднику» и позиционным `steps.$`.
 * `rev` плана НЕ растёт (иначе у мастера каждое «Начал» давало бы 409 в Ганте), `updatedAt` тоже не трогаем
 * (иначе план выглядит «изменённым после запуска»).
 */
@Injectable()
export class MyTasksService {
  constructor(@InjectConnection() private readonly connection: Connection, private readonly facts: WorkFactsService) {}

  private db() { return this.connection.db!; }
  private plans() { return this.db().collection('orderlineplans'); }

  /** Сотрудник текущего входа (`persons.userId`, по уникальному индексу); нет связи — null. */
  async personOf(userId: string | undefined): Promise<Types.ObjectId | null> {
    if (!userId || !Types.ObjectId.isValid(userId)) return null;
    const p = await this.db().collection('persons').findOne({ userId: new Types.ObjectId(userId), deletedAt: null, status: { $ne: 'fired' } }, { projection: { _id: 1 } });
    return p ? (p._id as Types.ObjectId) : null;
  }

  /** Список заданий: `linked: false` — вход не привязан к сотруднику (экран пишет «скажите директору»). */
  async list(userId: string | undefined): Promise<{ linked: boolean; items: TaskItem[] }> {
    const pid = await this.personOf(userId);
    if (!pid) return { linked: false, items: [] };
    return { linked: true, items: await this.itemsOf(await this.livePlans({ 'steps.assigneeId': pid }), pid) };
  }

  /** Начал / закончил / отложил / проблема. Чужой или несуществующий шаг — 403. Повтор безопасен. */
  async act(userId: string | undefined, planId: string, stepId: string, what: TaskAction, dto: MyTaskActionDto): Promise<TaskItem> {
    const pid = await this.personOf(userId);
    if (!pid) throw new ForbiddenException('Ваш вход не привязан к сотруднику — скажите директору');
    const plan = oid(planId, 'плана'), step = oid(stepId, 'шага');
    const own = (cond: Doc = {}) => ownStepFilter(plan, step, pid, cond);
    const cur = (await this.plans().findOne(own())) as Doc | null;
    if (!cur) throw new ForbiddenException(NOT_YOURS);
    const row = cur.steps.find((s: Doc) => String(s._id) === String(step));
    const now = new Date();
    const at = clickTime(dto.clientTime, now);
    const upd = (set: Doc, unset: Doc = {}, cond: Doc = {}) =>
      this.plans().updateOne(own(cond), { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });

    if (what === 'start') {
      if (stepState(row) !== 'working') await this.assertNoOther(pid, step);
      if (!row.finishedAt) {
        await upd({ 'steps.$.startedAt': at }, {}, { startedAt: { $exists: false } });
        await upd({}, CLEAR_STATUS, { finishedAt: { $exists: false } });
      }
    } else if (what === 'finish') {
      await upd({ 'steps.$.startedAt': at }, {}, { startedAt: { $exists: false } }); // закончил без «начал» — начало = сейчас
      await upd({ 'steps.$.finishedAt': at }, CLEAR_STATUS, { finishedAt: { $exists: false } });
      await this.facts.recordStep((await this.plans().findOne({ _id: plan })) as Doc, String(step)); // факт-часы шага
    } else if (what === 'defer') {
      const reason = cleanReason(dto.reason);
      await upd({ 'steps.$.status': 'deferred', 'steps.$.statusReason': reason, 'steps.$.deferUntil': deferDate(dto.until, now), 'steps.$.statusAt': at }, {}, { finishedAt: { $exists: false } });
    } else {
      const reason = cleanReason(dto.reason);
      await upd({ 'steps.$.status': 'problem', 'steps.$.statusReason': reason, 'steps.$.statusAt': at }, { 'steps.$.deferUntil': '' }, { finishedAt: { $exists: false } });
    }
    const fresh = (await this.plans().findOne({ _id: plan })) as Doc;
    const item = (await this.itemsOf([fresh], pid, true)).find((t) => t.stepId === String(step));
    if (!item) throw new NotFoundException('Задание не найдено');
    return item;
  }

  /** Одновременно в работе одно задание: второе «Начал» — подсказка. */
  private async assertNoOther(pid: Types.ObjectId, step: Types.ObjectId) {
    const busy = await this.plans().countDocuments(
      { deletedAt: null, steps: { $elemMatch: { assigneeId: pid, _id: { $ne: step }, startedAt: { $exists: true }, finishedAt: { $exists: false }, status: { $exists: false } } } },
      { limit: 1 },
    );
    if (busy) throw new ConflictException('Сначала закончите текущее задание');
  }

  /** Запущенные планы живых позиций; поля — только нужные для списка (без rev, цен, истории). */
  private async livePlans(extra: Doc): Promise<Doc[]> {
    return (await this.plans().find({ deletedAt: null, launchedAt: { $type: 'date' }, ...extra }, { projection: { incomeId: 1, parts: 1, steps: 1 } }).limit(500).toArray()) as Doc[];
  }

  /** Плюс к планам — позиции (название, № заказа, срок, количество) и названия видов работ. `keepDone` — не прятать готовые (ответ на действие). */
  private async itemsOf(plans: Doc[], pid: Types.ObjectId, keepDone = false): Promise<TaskItem[]> {
    if (!plans.length) return [];
    const [incomes, types] = await Promise.all([
      this.db().collection('incomes').find({ _id: { $in: plans.map((p) => p.incomeId) }, deletedAt: null }, { projection: { orderNo: 1, title: 1, qty: 1, shipDate: 1 } }).toArray(),
      this.db().collection('worktypes').find({ deletedAt: null }, { projection: { name: 1 } }).toArray(),
    ]);
    return buildTasks(plans, pid, {
      incomes: new Map(incomes.map((i) => [String(i._id), i as Doc])),
      typeNames: new Map(types.map((t) => [String(t._id), String(t.name ?? '')])),
      now: new Date(), keepDone,
    });
  }
}
