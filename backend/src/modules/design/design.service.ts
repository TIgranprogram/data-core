import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { parseSheetDate } from '../../common/date-parse';
import { oid, oids, parseList } from '../../common/list-query';
import { CounterService } from '../counter/counter.service';
import type { DesignTaskDto, FromOrderDto } from './dto/design-task.dto';
import { DesignOrder, type DesignOrderDocument } from './design-order.schema';
import { DESIGN_STATUSES, DesignTask, type DesignStatus, type DesignTaskDocument } from './design-task.schema';
import { presentTasks } from './design-present';

type Doc = Record<string, unknown>;
const isDup = (e: unknown) => (e as { code?: number }).code === 11000;

/**
 * «Проектирование» (ПРЖ-3): задачи на чертежи под позиции заказов и свободные задачи.
 * Номер D-N — сквозной счётчик (после удаления не повторяется). На позицию — одна открытая задача
 * (замок `openIncomeId`, уникальный). Срок и приоритет заказа берутся при выдаче, не копируются.
 */
@Injectable()
export class DesignService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(DesignTask.name) private readonly model: Model<DesignTaskDocument>,
    private readonly counters: CounterService,
    @InjectModel(DesignOrder.name) private readonly designOrders: Model<DesignOrderDocument>,
  ) {}

  private readonly log = new Logger(DesignService.name);

  private db() { return this.connection.db!; }
  private userOid(userId?: string) { return userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined; }

  async list(q: Record<string, unknown> = {}) {
    const p = parseList(q, { sortable: ['seq', 'completedAt', 'createdAt'], defaultSort: 'seq', defaultLimit: 100, maxLimit: 500 });
    const base: Doc = { deletedAt: p.deleted ? { $ne: null } : null };
    if (q.assigneeId) base.assigneeId = { $in: oids(q.assigneeId) };
    if (q.orderId) base.orderId = { $in: oids(q.orderId) };
    if (p.search) base.$or = await this.searchClauses(String(q.search).trim(), p.search);
    const full: Doc = { ...base };
    if (q.needsAnswer === '1') full._id = { $in: await this.db().collection('designnotes').distinct('taskId', { needsAnswer: true, deletedAt: null }) };
    if (q.status) {
      const want = String(q.status).split(',').map((s) => s.trim()).filter(Boolean);
      const bad = want.find((s) => !(DESIGN_STATUSES as readonly string[]).includes(s));
      if (bad) throw new BadRequestException(`Неизвестный статус «${bad}»: queue, work, done или paused`);
      full.status = { $in: want };
    }
    // «Завершены» — по дате завершения, свежие сверху; остальные — по номеру
    const sort = q.status === 'done' && !q.sort ? { completedAt: -1, _id: -1 } : { ...p.sort, _id: Object.values(p.sort)[0] };
    const [docs, total, byStatus] = await Promise.all([
      this.model.find(full).setOptions({ includeSoftDeleted: true }).sort(sort as never).skip(p.skip).limit(p.limit).lean().exec(),
      this.model.countDocuments(full).setOptions({ includeSoftDeleted: true }).exec(),
      this.model.aggregate([{ $match: base }, { $group: { _id: '$status', n: { $sum: 1 } } }]).exec(),
    ]);
    const counts: Record<string, number> = Object.fromEntries(DESIGN_STATUSES.map((s) => [s, 0]));
    for (const r of byStatus) counts[String(r._id)] = r.n;
    counts.all = DESIGN_STATUSES.reduce((a, s) => a + counts[s], 0);
    return { items: await presentTasks(this.connection, docs as Doc[]), total, page: p.page, limit: p.limit, counts };
  }

  /** Поиск: название задачи, код D-N, № заказа / заказчик, название и артикул изделия. */
  private async searchClauses(text: string, re: RegExp): Promise<Doc[]> {
    const [orders, prods] = await Promise.all([
      this.db().collection('salesorders').find({ deletedAt: null, $or: [{ orderNo: re }, { productionNo: re }, { customer: re }] }, { projection: { _id: 1 } }).limit(200).toArray(),
      this.db().collection('products').find({ deletedAt: null, $or: [{ name: re }, { sku: re }] }, { projection: { _id: 1 } }).limit(200).toArray(),
    ]);
    const clauses: Doc[] = [{ title: re }];
    const num = text.match(/^d?-?(\d+)$/i);
    if (num) clauses.push({ seq: Number(num[1]) });
    if (orders.length) clauses.push({ orderId: { $in: orders.map((o) => o._id) } });
    if (prods.length) clauses.push({ productId: { $in: prods.map((x) => x._id) } });
    return clauses;
  }

  private async findRaw(id: string, deleted = false) {
    const doc = await this.model.findOne({ _id: oid(id, 'задачи'), deletedAt: deleted ? { $ne: null } : null }).setOptions({ includeSoftDeleted: true }).lean().exec();
    if (!doc) throw new NotFoundException(deleted ? 'Задачи нет в корзине' : 'Задача не найдена');
    return doc as Doc;
  }

  async get(id: string) {
    return (await presentTasks(this.connection, [await this.findRaw(id)]))[0];
  }

  /** Правила состояния: «в работе» — с исполнителем, «приостановлена» — с причиной. */
  private checkState(status: DesignStatus, assigneeId: unknown, pauseReason: unknown) {
    if (status === 'work' && !assigneeId) throw new BadRequestException('Назначьте исполнителя, чтобы взять задачу в работу');
    if (status === 'paused' && !String(pauseReason ?? '').trim()) throw new BadRequestException('Укажите причину приостановки');
    if (status === 'cancelled' && !String(pauseReason ?? '').trim()) throw new BadRequestException('Укажите причину отмены');
  }

  private async checkPerson(id: Types.ObjectId) {
    if (!(await this.db().collection('persons').findOne({ _id: id, deletedAt: null }, { projection: { _id: 1 } }))) throw new BadRequestException('Сотрудник не найден — выберите из списка');
  }

  private async checkProduct(id: Types.ObjectId) {
    if (!(await this.db().collection('products').findOne({ _id: id, deletedAt: null }, { projection: { _id: 1 } }))) throw new BadRequestException('Изделие не найдено — выберите из списка');
  }

  /** Своё значение срока: '' / null — убрать (снова из заказа). */
  private parseDeadline(v: string | null | undefined): Date | undefined {
    const d = v ? parseSheetDate(v) : undefined;
    if (v && !d) throw new BadRequestException('Срок — в формате ДД.ММ.ГГГГ');
    return d;
  }

  /** Вторая открытая задача на ту же позицию — 409 с кодом уже существующей. */
  private async ensureNoOpen(incomeId: Types.ObjectId, exceptId?: Types.ObjectId) {
    const dup = await this.model.findOne({ openIncomeId: incomeId, ...(exceptId ? { _id: { $ne: exceptId } } : {}) }, { seq: 1 }).lean().exec();
    if (dup) throw new ConflictException(`На эту позицию уже есть открытая задача D-${dup.seq}`);
  }

  /** Завершили: пустому «Кто проектировал» (products.designerId) изделия ставим исполнителя; заполненный не трогаем. */
  private async fillDesigner(productId: unknown, assigneeId: unknown) {
    if (!productId || !assigneeId) return;
    await this.db().collection('products').updateOne({ _id: productId as Types.ObjectId, designerId: null }, { $set: { designerId: assigneeId, updatedAt: new Date() } });
  }

  private async lineOf(incomeId: unknown) {
    return incomeId ? this.db().collection('incomes').findOne({ _id: incomeId as Types.ObjectId, deletedAt: null }, { projection: { orderId: 1, productId: 1 } }) : null;
  }

  /** Метка «заказ на доске»: upsert по orderId, снимает «убрано» (deletedAt). Мягко удалённую запись находит includeSoftDeleted. */
  async markOrder(orderId: Types.ObjectId, userId?: string) {
    const by = this.userOid(userId);
    const run = () => this.designOrders.updateOne(
      { orderId },
      { $set: { deletedAt: null }, $setOnInsert: { addedAt: new Date(), ...(by ? { addedBy: by } : {}) } },
      { upsert: true },
    ).setOptions({ includeSoftDeleted: true }).exec();
    try { await run(); } catch (e) { if (!isDup(e)) throw e; await run(); } // две вставки подряд: вторая уже находит запись
  }

  /** Метка — необязательный шаг после создания задачи: сбой не даёт 500, только запись в лог. */
  private async markQuiet(orderId: unknown, userId?: string) {
    if (!orderId) return;
    try { await this.markOrder(orderId as Types.ObjectId, userId); } catch (e) { this.log.warn(`Метка заказа на доске не поставлена: ${(e as Error).message}`); }
  }

  /** Вставка с номером D-N; гонка за позицию (уникальный замок) → 409. */
  private async insert(f: Doc, userId?: string, mark = true) {
    const status = (f.status as DesignStatus) ?? 'queue';
    const seq = await this.counters.nextSeq('DesignTask', 'D');
    try {
      const doc = await this.model.create({
        ...f, status, seq, createdBy: this.userOid(userId),
        ...(f.incomeId && status !== 'done' ? { openIncomeId: f.incomeId } : {}),
        ...(status === 'done' ? { completedAt: new Date(), completedBy: this.userOid(userId) } : {}),
      });
      if (status === 'done') await this.fillDesigner(f.productId, f.assigneeId);
      if (mark) await this.markQuiet(f.orderId, userId);
      return doc.toObject() as unknown as Doc;
    } catch (e) {
      if (isDup(e)) throw new ConflictException('На эту позицию уже есть открытая задача');
      throw e;
    }
  }

  async create(dto: DesignTaskDto, userId?: string) {
    const status = dto.status ?? 'queue';
    this.checkState(status, dto.assigneeId, dto.pauseReason);
    if (dto.incomeId && status === 'done') throw new BadRequestException('Нельзя создать задачу сразу завершённой — сначала возьмите её в работу');
    const f: Doc = { status };
    if (dto.incomeId) {
      const line = await this.lineOf(dto.incomeId ? oid(dto.incomeId, 'позиции') : null);
      if (!line) throw new NotFoundException('Позиция заказа не найдена');
      f.incomeId = line._id; f.orderId = line.orderId;
      if (line.productId) f.productId = line.productId;
      if (status !== 'done') await this.ensureNoOpen(line._id);
    } else if (!String(dto.title ?? '').trim()) throw new BadRequestException('Укажите название задачи или выберите позицию заказа');
    if (dto.productId) { f.productId = oid(dto.productId, 'изделия'); await this.checkProduct(f.productId as Types.ObjectId); }
    if (dto.assigneeId) { f.assigneeId = oid(dto.assigneeId, 'сотрудника'); await this.checkPerson(f.assigneeId as Types.ObjectId); }
    if (dto.title?.trim()) f.title = dto.title.trim();
    if (dto.note?.trim()) f.note = dto.note.trim();
    if (status === 'paused' || status === 'cancelled') f.pauseReason = String(dto.pauseReason).trim();
    const manual: Doc = {};
    const deadline = this.parseDeadline(dto.deadline);
    if (deadline) manual.deadline = deadline;
    if (dto.priority) manual.priority = dto.priority;
    if (Object.keys(manual).length) f.manual = manual;
    const doc = await this.insert(f, userId);
    return this.get(String(doc._id));
  }

  /** Задача на каждую позицию заказа (или выбранные); у кого уже есть открытая — пропуск, повтор дублей не создаёт. */
  async fromOrder(dto: FromOrderDto, userId?: string) {
    const orderId = oid(dto.orderId, 'заказа');
    if (!(await this.db().collection('salesorders').findOne({ _id: orderId, deletedAt: null }, { projection: { _id: 1 } }))) throw new NotFoundException('Заказ не найден');
    const want = dto.lineIds?.length ? oids(dto.lineIds.join(',')) : undefined;
    const lines = await this.db().collection('incomes').find({ orderId, deletedAt: null, ...(want ? { _id: { $in: want } } : {}) }, { projection: { productId: 1 } }).sort({ lineNo: 1, createdAt: 1, _id: 1 }).toArray();
    if (want && lines.length !== new Set(want.map(String)).size) throw new BadRequestException('Некоторые позиции не из этого заказа или удалены');
    const open = await this.model.find({ openIncomeId: { $in: lines.map((l) => l._id) } }, { openIncomeId: 1 }).lean().exec();
    const taken = new Set(open.map((t) => String(t.openIncomeId)));
    const created: Doc[] = [];
    let skipped = 0;
    for (const l of lines) {
      if (taken.has(String(l._id))) { skipped++; continue; }
      try {
        created.push(await this.insert({ status: 'queue', incomeId: l._id, orderId, ...(l.productId ? { productId: l.productId } : {}) }, userId, false));
      } catch (e) {
        if (!(e instanceof ConflictException)) throw e;
        skipped++; // параллельный запрос успел раньше
      }
    }
    await this.markQuiet(orderId, userId);
    return { created: created.length, skipped, items: await presentTasks(this.connection, created) };
  }

  async update(id: string, dto: DesignTaskDto, userId?: string) {
    const cur = await this.findRaw(id);
    // Привязать можно только свободную задачу (позиции ещё нет); переносить с позиции на позицию нельзя — создайте новую задачу
    const link: Doc = {};
    if (dto.incomeId !== undefined) {
      if (cur.incomeId) throw new BadRequestException('Позицию заказа у задачи менять нельзя — создайте новую задачу');
      if (!dto.incomeId) throw new BadRequestException('Укажите позицию заказа');
      const line = await this.lineOf(oid(dto.incomeId, 'позиции'));
      if (!line) throw new NotFoundException('Позиция заказа не найдена');
      if (cur.status !== 'done') await this.ensureNoOpen(line._id, cur._id as Types.ObjectId);
      link.incomeId = line._id; link.orderId = line.orderId;
      if (line.productId && !cur.productId) link.productId = line.productId; // своё изделие задачи не трогаем
    }
    const status = dto.status ?? (cur.status as DesignStatus);
    const assigneeId = dto.assigneeId === undefined ? cur.assigneeId : dto.assigneeId ? oid(dto.assigneeId, 'сотрудника') : null;
    const pauseReason = dto.pauseReason === undefined ? cur.pauseReason : dto.pauseReason.trim();
    this.checkState(status, assigneeId, pauseReason);
    const set: Doc = { status, ...link }, unset: Record<string, ''> = {};
    const put = (k: string, v: unknown) => (v === undefined || v === null || v === '' ? (unset[k] = '') : (set[k] = v));
    if (dto.assigneeId !== undefined) { if (assigneeId) await this.checkPerson(assigneeId as Types.ObjectId); put('assigneeId', assigneeId); }
    if (dto.productId !== undefined) {
      const pid = dto.productId ? oid(dto.productId, 'изделия') : null;
      if (pid) await this.checkProduct(pid);
      put('productId', pid);
    }
    if (dto.title !== undefined) put('title', dto.title.trim());
    if (dto.note !== undefined) put('note', dto.note.trim());
    if (dto.spec !== undefined) put('spec', dto.spec && Object.values(dto.spec).some((v) => String(v ?? '').trim()) ? Object.fromEntries(Object.entries(dto.spec).map(([k, v]) => [k, String(v ?? '').trim()])) : null);
    if (dto.deadline !== undefined) put('manual.deadline', this.parseDeadline(dto.deadline));
    if (dto.priority !== undefined) put('manual.priority', dto.priority);
    if (status === 'paused' || status === 'cancelled') set.pauseReason = String(pauseReason).trim(); else unset.pauseReason = '';
    const wasDone = cur.status === 'done';
    if (status === 'done') {
      if (!wasDone) {
        set.completedAt = new Date();
        const by = this.userOid(userId); if (by) set.completedBy = by;
        unset.openIncomeId = '';
      }
    } else {
      unset.completedAt = ''; unset.completedBy = '';
      const lineId = (link.incomeId ?? cur.incomeId) as Types.ObjectId | undefined;
      if (lineId) {
        if (wasDone && !link.incomeId) await this.ensureNoOpen(lineId, cur._id as Types.ObjectId);
        set.openIncomeId = lineId;
      }
    }
    try {
      await this.model.updateOne({ _id: cur._id }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }).exec();
    } catch (e) {
      if (isDup(e)) throw new ConflictException('На эту позицию уже есть открытая задача');
      throw e;
    }
    if (link.orderId) await this.markQuiet(link.orderId, userId);
    if (status === 'done' && !wasDone) {
      const productId = 'productId' in set ? set.productId : 'productId' in unset ? undefined : cur.productId ?? (await this.lineOf(cur.incomeId))?.productId;
      await this.fillDesigner(productId, assigneeId);
    }
    return this.get(id);
  }

  /** В корзину; замок позиции снимается — на неё можно завести новую задачу. */
  async remove(id: string) {
    const cur = await this.findRaw(id);
    await this.model.updateOne({ _id: cur._id }, { $set: { deletedAt: new Date() }, $unset: { openIncomeId: '' } }).exec();
    return { id, deleted: true };
  }

  async restore(id: string) {
    const cur = await this.findRaw(id, true);
    const lock = !!cur.incomeId && cur.status !== 'done';
    if (lock) await this.ensureNoOpen(cur.incomeId as Types.ObjectId, cur._id as Types.ObjectId);
    try {
      await this.model.updateOne({ _id: cur._id }, { $set: { deletedAt: null, ...(lock ? { openIncomeId: cur.incomeId } : {}) } }).setOptions({ includeSoftDeleted: true }).exec();
    } catch (e) {
      if (isDup(e)) throw new ConflictException('На эту позицию уже есть открытая задача');
      throw e;
    }
    return this.get(id);
  }
}
