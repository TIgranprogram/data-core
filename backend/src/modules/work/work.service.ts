import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { personWorkTypeIds } from '../../common/catalog/person-work-types';
import { oid, oids, parseList } from '../../common/list-query';
import { CounterService } from '../counter/counter.service';
import { personView } from '../design/design-present';
import type { CancelDto, LaunchDto, MoveDto, WorkTaskPatchDto } from './dto/work.dto';
import { DONE_DAYS, mergeColumns, nextIndex, planLaunch, positionAt, stepKeyOf, type LaunchProduct } from './work-flow';
import { presentWork } from './work-present';
import { WorkRouteService } from './work-route.service';
import { WORK_STATUSES, WorkTask, type WorkMove, type WorkStep, type WorkTaskDocument } from './work-task.schema';

type Doc = Record<string, unknown>;
const isDup = (e: unknown) => (e as { code?: number }).code === 11000;
const DAY = 86400000;

/**
 * «В работе»: задание = позиция заказа целиком; шаги — виды работ маршрута изделия (снимок при запуске).
 * Номер W-N сквозной. На позицию — одно открытое задание (замок `openIncomeId`, уникальный).
 * Карточку двигает мастер / менеджер; сдельной оплаты и часов нет.
 */
@Injectable()
export class WorkService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(WorkTask.name) private readonly model: Model<WorkTaskDocument>,
    private readonly counters: CounterService,
    private readonly routes: WorkRouteService,
  ) {}

  private db() { return this.connection.db!; }
  private userOid(userId?: string) { return userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined; }

  /** Поиск: код W-N, № заказа / заказчик, название и артикул изделия, название позиции заказчика. */
  private async searchClauses(text: string, re: RegExp): Promise<Doc[]> {
    const [orders, prods, lines] = await Promise.all([
      this.db().collection('salesorders').find({ deletedAt: null, $or: [{ orderNo: re }, { productionNo: re }, { customer: re }] }, { projection: { _id: 1 } }).limit(200).toArray(),
      this.db().collection('products').find({ deletedAt: null, $or: [{ name: re }, { sku: re }] }, { projection: { _id: 1 } }).limit(200).toArray(),
      this.db().collection('incomes').find({ deletedAt: null, title: re }, { projection: { _id: 1 } }).limit(200).toArray(),
    ]);
    const clauses: Doc[] = [];
    const num = text.match(/^w?-?(\d+)$/i);
    if (num) clauses.push({ seq: Number(num[1]) });
    if (orders.length) clauses.push({ orderId: { $in: orders.map((o) => o._id) } });
    if (prods.length) clauses.push({ productId: { $in: prods.map((x) => x._id) } });
    if (lines.length) clauses.push({ incomeId: { $in: lines.map((x) => x._id) } });
    return clauses.length ? clauses : [{ _id: null }]; // ничего не нашли — пустая выдача, а не весь список
  }

  /**
   * Доска: карточки + колонки (Ждёт запуска · виды работ маршрутов · Готово) со счётчиками.
   * Фильтры: workTypeId (колонка; `generic` — «Изготовление»), orderId, assigneeId, status, search.
   * Готовые старше `doneDays` (умолч. 7) с доски убираются; отменённые — только по status=cancelled.
   */
  async list(q: Record<string, unknown> = {}) {
    const p = parseList(q, { sortable: ['seq', 'completedAt', 'createdAt'], defaultSort: 'seq', defaultLimit: 200, maxLimit: 500 });
    const scope: Doc[] = [{ deletedAt: p.deleted ? { $ne: null } : null }];
    if (q.orderId) scope.push({ orderId: { $in: oids(q.orderId) } });
    if (q.assigneeId) scope.push({ assigneeId: { $in: oids(q.assigneeId) } });
    if (p.search) scope.push({ $or: await this.searchClauses(String(q.search).trim(), p.search) });
    const want = q.status ? String(q.status).split(',').map((s) => s.trim()).filter(Boolean) : null;
    const bad = want?.find((s) => !(WORK_STATUSES as readonly string[]).includes(s));
    if (bad) throw new BadRequestException(`Неизвестный статус «${bad}»: waiting, work, done или cancelled`);
    const doneDays = q.doneDays !== undefined ? Math.max(0, Math.floor(Number(q.doneDays) || 0)) : want ? 0 : DONE_DAYS;
    if (doneDays > 0) scope.push({ $or: [{ status: { $ne: 'done' } }, { completedAt: { $gte: new Date(Date.now() - doneDays * DAY) } }] });
    const filter: Doc[] = [...scope, want ? { status: { $in: want } } : { status: { $ne: 'cancelled' } }];
    if (q.workTypeId) filter.push({ stepKey: { $in: String(q.workTypeId).split(',').map((s) => s.trim()).filter(Boolean) } });
    const full = { $and: filter }, whole = { $and: [...scope, { status: { $ne: 'cancelled' } }] };
    const sort = want?.length === 1 && want[0] === 'done' && !q.sort ? { completedAt: -1, _id: -1 } : { ...p.sort, _id: Object.values(p.sort)[0] };
    const [docs, total, grouped, active] = await Promise.all([
      this.model.find(full).setOptions({ includeSoftDeleted: true }).sort(sort as never).skip(p.skip).limit(p.limit).lean().exec(),
      this.model.countDocuments(full).setOptions({ includeSoftDeleted: true }).exec(),
      this.model.aggregate([{ $match: whole }, { $group: { _id: { status: '$status', key: '$stepKey' }, n: { $sum: 1 } } }]).exec(),
      this.model.find({ $and: [...scope, { status: { $in: ['waiting', 'work'] } }] }, { route: 1 }).setOptions({ includeSoftDeleted: true }).limit(2000).lean().exec(),
    ]);
    const counts: Record<string, number> = { waiting: 0, work: 0, done: 0, all: 0 };
    const byStep: Record<string, number> = {};
    for (const r of grouped) {
      const { status, key } = r._id as { status: string; key: string };
      counts[status] = (counts[status] ?? 0) + r.n; counts.all += r.n;
      if (status === 'work' && key) byStep[key] = (byStep[key] ?? 0) + r.n;
    }
    const cols = mergeColumns(active.map((t) => ((t.route as Doc[] | undefined) ?? []).map((s) => ({ key: stepKeyOf(s as { workTypeId: Types.ObjectId | null }), name: String(s.name) }))));
    const columns = [
      { key: 'waiting', title: 'Ждёт запуска', workTypeId: null, count: counts.waiting },
      ...cols.map((c) => ({ key: c.key, title: c.name, workTypeId: c.key === 'generic' ? null : c.key, count: byStep[c.key] ?? 0 })),
      { key: 'done', title: 'Готово', workTypeId: null, count: counts.done },
    ];
    return { items: await presentWork(this.connection, docs as Doc[]), total, page: p.page, limit: p.limit, counts, columns };
  }

  private async findRaw(id: string, deleted = false) {
    const doc = await this.model.findOne({ _id: oid(id, 'задания'), deletedAt: deleted ? { $ne: null } : null }).setOptions({ includeSoftDeleted: true }).lean().exec();
    if (!doc) throw new NotFoundException(deleted ? 'Задания нет в корзине' : 'Задание не найдено');
    return doc as unknown as Doc;
  }

  async get(id: string) {
    return (await presentWork(this.connection, [await this.findRaw(id)]))[0];
  }

  /** Вторая открытая карточка на ту же позицию — 409 с кодом существующей. */
  private async ensureNoOpen(incomeId: Types.ObjectId, exceptId?: Types.ObjectId) {
    const dup = await this.model.findOne({ openIncomeId: incomeId, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }, { seq: 1 }).lean().exec();
    if (dup) throw new ConflictException(`Позиция уже в работе (W-${dup.seq})`);
  }

  /**
   * Запуск позиций в работу (заказ целиком или выбранные). Позиции без изделия и уже запущенные не запускаются —
   * в ответе `refused` с понятной причиной; изделие без маршрута запускается одной работой «Изготовление» (+ `warnings`).
   */
  async launch(dto: LaunchDto, userId?: string) {
    if (!dto.orderId && !dto.lineIds?.length) throw new BadRequestException('Укажите заказ или позиции для запуска');
    const filter: Doc = { deletedAt: null };
    if (dto.orderId) {
      const orderId = oid(dto.orderId, 'заказа');
      if (!(await this.db().collection('salesorders').findOne({ _id: orderId, deletedAt: null }, { projection: { _id: 1 } }))) throw new NotFoundException('Заказ не найден');
      filter.orderId = orderId;
    }
    const want = dto.lineIds?.length ? oids(dto.lineIds.join(',')) : undefined;
    if (want) filter._id = { $in: want };
    const lines = (await this.db().collection('incomes').find(filter, { projection: { orderId: 1, lineNo: 1, title: 1, productId: 1 } }).sort({ lineNo: 1, createdAt: 1, _id: 1 }).toArray());
    if (want && lines.length !== new Set(want.map(String)).size) throw new BadRequestException('Некоторые позиции не из этого заказа или удалены');
    if (!lines.length) throw new BadRequestException('В заказе нет позиций');
    const open = await this.model.find({ openIncomeId: { $in: lines.map((l) => l._id) } }, { seq: 1, openIncomeId: 1 }).lean().exec();
    const prodIds = [...new Map(lines.filter((l) => l.productId).map((l) => [String(l.productId), l.productId as Types.ObjectId])).values()];
    const prods = prodIds.length ? await this.db().collection('products').find({ _id: { $in: prodIds }, deletedAt: null }, { projection: { workTypes: 1 } }).toArray() : [];
    const steps = await this.routes.stepsOf(prods as Doc[]);
    const known = new Map<string, LaunchProduct>(prods.map((p) => [String(p._id), { _id: p._id as Types.ObjectId, routeSteps: steps.get(String(p._id)) ?? [] }]));
    const plan = planLaunch(lines.map((l) => ({ _id: l._id as Types.ObjectId, orderId: l.orderId as Types.ObjectId | undefined, lineNo: l.lineNo as number | undefined, title: l.title as string | undefined, productId: l.productId as Types.ObjectId | undefined })), known, new Map(open.map((t) => [String(t.openIncomeId), t.seq as number])));
    const created: Doc[] = [];
    const refused = [...plan.refused];
    for (const { line, route, generic } of plan.launch) {
      try {
        created.push(await this.insert(line._id, line.orderId, line.productId as Types.ObjectId, route, generic, userId));
      } catch (e) {
        if (!(e instanceof ConflictException)) throw e;
        refused.push({ incomeId: String(line._id), lineNo: line.lineNo ?? null, title: String(line.title ?? ''), reason: 'Уже в работе' }); // параллельный запрос успел раньше
      }
    }
    const warned = new Set(created.map((c) => String(c.incomeId)));
    return { created: created.length, skipped: refused.length, items: await presentWork(this.connection, created), refused, warnings: plan.warnings.filter((w) => warned.has(w.incomeId)) };
  }

  /** Вставка с номером W-N: сразу на первом шаге маршрута; гонка за позицию (уникальный замок) → 409. */
  private async insert(incomeId: Types.ObjectId, orderId: Types.ObjectId | undefined, productId: Types.ObjectId, route: WorkStep[], generic: boolean, userId?: string) {
    const seq = await this.counters.nextSeq('WorkTask', 'W');
    const by = this.userOid(userId);
    const pos = positionAt(route, 0);
    try {
      const doc = await this.model.create({
        seq, incomeId, ...(orderId ? { orderId } : {}), productId, route, generic, ...pos, openIncomeId: incomeId,
        startedAt: new Date(), ...(by ? { createdBy: by } : {}), moves: [{ at: new Date(), ...(by ? { by } : {}), from: null, to: 0 }],
      });
      return doc.toObject() as unknown as Doc;
    } catch (e) {
      if (isDup(e)) throw new ConflictException('Позиция уже в работе');
      throw e;
    }
  }

  /** Записать новое положение карточки (шаг; длина маршрута — «Готово»; null — «Ждёт запуска») и пополнить историю. */
  private async apply(cur: Doc, to: number | null, userId?: string) {
    const route = cur.route as never as Array<{ workTypeId: Types.ObjectId | null }>;
    const pos = positionAt(route as never, to);
    const from = (cur.stepIndex as number | null | undefined) ?? null;
    const by = this.userOid(userId);
    const set: Doc = { ...pos }, unset: Record<string, ''> = {};
    const incomeId = cur.incomeId as Types.ObjectId;
    if (pos.status === 'done') {
      set.completedAt = new Date(); if (by) set.completedBy = by;
      unset.openIncomeId = '';
    } else {
      unset.completedAt = ''; unset.completedBy = '';
      if (cur.status === 'done') await this.ensureNoOpen(incomeId, cur._id as Types.ObjectId);
      set.openIncomeId = incomeId;
      if (pos.status === 'work' && !cur.startedAt) set.startedAt = new Date();
    }
    const move: WorkMove = { at: new Date(), ...(by ? { by } : {}), from, to: pos.stepIndex };
    try {
      await this.model.updateOne({ _id: cur._id }, { $set: set, $unset: unset, $push: { moves: { $each: [move], $slice: -100 } } } as never).exec();
    } catch (e) {
      if (isDup(e)) throw new ConflictException('Позиция уже в работе');
      throw e;
    }
    return this.get(String(cur._id));
  }

  /** Перевод на номер шага, на следующий («next» — с последнего «Готово») или в «Ждёт запуска». Назад — тоже можно. */
  async move(id: string, dto: MoveDto, userId?: string) {
    if ((dto.stepIndex === undefined) === (dto.to === undefined)) throw new BadRequestException('Укажите stepIndex или to (next / waiting)');
    const cur = await this.findRaw(id);
    if (cur.status === 'cancelled') throw new BadRequestException('Задание отменено — запустите позицию заново');
    const route = cur.route as unknown[];
    const from = (cur.stepIndex as number | null | undefined) ?? null;
    let to: number | null;
    if (dto.to === 'waiting') to = null;
    else if (dto.to === 'next') {
      if (cur.status === 'done') throw new BadRequestException('Задание уже готово');
      to = nextIndex(route as never, from);
    } else {
      if (dto.stepIndex! >= route.length) throw new BadRequestException(`В маршруте ${route.length} шагов — шага ${dto.stepIndex} нет`);
      to = dto.stepIndex!;
    }
    if (to === from) return this.get(id);
    return this.apply(cur, to, userId);
  }

  /** «Готово»: весь маршрут пройден. */
  async finish(id: string, userId?: string) {
    const cur = await this.findRaw(id);
    if (cur.status === 'cancelled') throw new BadRequestException('Задание отменено — запустите позицию заново');
    if (cur.status === 'done') return this.get(id);
    return this.apply(cur, (cur.route as unknown[]).length, userId);
  }

  async cancel(id: string, dto: CancelDto, userId?: string) {
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Укажите причину отмены');
    const cur = await this.findRaw(id);
    if (cur.status === 'cancelled') return this.get(id);
    if (cur.status === 'done') throw new BadRequestException('Готовое задание отменить нельзя');
    const by = this.userOid(userId);
    const move: WorkMove = { at: new Date(), ...(by ? { by } : {}), from: (cur.stepIndex as number | null | undefined) ?? null, to: null };
    await this.model.updateOne({ _id: cur._id }, { $set: { status: 'cancelled', cancelReason: reason }, $unset: { openIncomeId: '' }, $push: { moves: { $each: [move], $slice: -100 } } } as never).exec();
    return this.get(id);
  }

  /** Исполнитель и примечание. Исполнитель — работающий сотрудник; вид работ шага не проверяем (назначает мастер). */
  async patch(id: string, dto: WorkTaskPatchDto) {
    const cur = await this.findRaw(id);
    const set: Doc = {}, unset: Record<string, ''> = {};
    if (dto.assigneeId !== undefined) {
      if (dto.assigneeId) {
        const pid = oid(dto.assigneeId, 'сотрудника');
        const p = await this.db().collection('persons').findOne({ _id: pid, deletedAt: null }, { projection: { status: 1 } });
        if (!p) throw new BadRequestException('Сотрудник не найден — выберите из списка');
        if (p.status === 'fired') throw new BadRequestException('Сотрудник уволен — выберите другого');
        set.assigneeId = pid;
      } else unset.assigneeId = '';
    }
    if (dto.note !== undefined) { if (dto.note.trim()) set.note = dto.note.trim(); else unset.note = ''; }
    if (Object.keys(set).length || Object.keys(unset).length) {
      await this.model.updateOne({ _id: cur._id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) } as never).exec();
    }
    return this.get(id);
  }

  /** Кого назначить: работающие сотрудники (не уволены, не в отпуске); с `workTypeId` — только с этим видом работ. */
  async people(q: Record<string, unknown> = {}) {
    const f: Doc = { deletedAt: null, status: { $nin: ['fired', 'vacation'] } };
    if (q.workTypeId) { const w = oid(q.workTypeId, 'вида работ'); f.$or = [{ workTypeIds: w }, { workTypeId: w }]; }
    const rows = await this.db().collection('persons').find(f, { projection: { lastName: 1, firstName: 1, position: 1, workTypeId: 1, workTypeIds: 1 } }).sort({ lastName: 1, firstName: 1 }).limit(500).toArray();
    return { items: rows.map((r) => ({ ...personView(r as Doc), position: (r.position as string | undefined) ?? null, workTypeIds: personWorkTypeIds(r as Doc).map(String) })) };
  }

  /** В корзину; замок позиции снимается — позицию можно запустить заново. */
  async remove(id: string) {
    const cur = await this.findRaw(id);
    await this.model.updateOne({ _id: cur._id }, { $set: { deletedAt: new Date() }, $unset: { openIncomeId: '' } }).exec();
    return { id, deleted: true };
  }

  async restore(id: string) {
    const cur = await this.findRaw(id, true);
    const lock = cur.status === 'waiting' || cur.status === 'work';
    if (lock) await this.ensureNoOpen(cur.incomeId as Types.ObjectId, cur._id as Types.ObjectId);
    try {
      await this.model.updateOne({ _id: cur._id }, { $set: { deletedAt: null, ...(lock ? { openIncomeId: cur.incomeId } : {}) } }).setOptions({ includeSoftDeleted: true }).exec();
    } catch (e) {
      if (isDup(e)) throw new ConflictException('Позиция уже в работе');
      throw e;
    }
    return this.get(id);
  }
}
