import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import type { Types } from 'mongoose';
import { oid } from '../../common/list-query';
import { shortProductName } from '../showcase/order-product-name';
import { loadPhotos } from '../../common/photos';
import { DesignOrder, type DesignOrderDocument } from './design-order.schema';
import { DesignTask, type DesignTaskDocument } from './design-task.schema';
import { isMatched } from '../matching/matching-rules';
import { orderDeadline, presentTasks } from './design-present';
import { DesignService } from './design.service';
import { DesignStickerService } from './design-sticker.service';
import type { AddDesignOrderDto } from './dto/design-task.dto';

type Doc = Record<string, unknown>;
type Oid = Types.ObjectId;
const OPEN = ['queue', 'work', 'paused'];
const ORDERS_CAP = 200, TASKS_CAP = 500;

/**
 * Доска проектирования: заказы слева = живые метки `designorders` ∪ заказы с открытыми задачами (подхват без миграции).
 * GET ничего не пишет. Выдача пакетом (по одному `$in`), цен и сумм нет.
 */
@Injectable()
export class DesignBoardService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(DesignTask.name) private readonly tasks: Model<DesignTaskDocument>,
    @InjectModel(DesignOrder.name) private readonly marks: Model<DesignOrderDocument>,
    private readonly design: DesignService,
    private readonly stickers: DesignStickerService,
  ) {}

  private db() { return this.connection.db!; }

  async board() {
    const [marks, grouped] = await Promise.all([
      this.marks.find({ deletedAt: null }).setOptions({ includeSoftDeleted: true }).lean().exec() as unknown as Promise<Doc[]>,
      // по заказу и статусу: число задач и какие позиции затронуты (для «ещё не взято»)
      this.tasks.aggregate([
        { $match: { deletedAt: null, orderId: { $ne: null } } },
        { $group: { _id: { orderId: '$orderId', status: '$status' }, n: { $sum: 1 }, lines: { $addToSet: '$incomeId' } } },
      ]).exec() as Promise<Array<{ _id: { orderId: Oid; status: string }; n: number; lines: unknown[] }>>,
    ]);
    const byOrder = new Map<string, { counts: Record<string, number>; lines: Set<string> }>();
    for (const g of grouped) {
      const key = String(g._id.orderId);
      const e = byOrder.get(key) ?? { counts: { queue: 0, work: 0, paused: 0, done: 0, cancelled: 0 }, lines: new Set<string>() };
      e.counts[g._id.status] = (e.counts[g._id.status] ?? 0) + g.n;
      for (const l of g.lines) if (l) e.lines.add(String(l));
      byOrder.set(key, e);
    }
    const addedAt = new Map(marks.map((m) => [String(m.orderId), m.addedAt as Date | undefined]));
    const ids = new Map<string, Oid>();
    for (const m of marks) ids.set(String(m.orderId), m.orderId as Oid);
    for (const g of grouped) if (OPEN.includes(g._id.status) && g.n > 0) ids.set(String(g._id.orderId), g._id.orderId);

    // заказы, удалённые в CRM, отсекаются
    const orders = ids.size ? await this.db().collection('salesorders').find(
      { _id: { $in: [...ids.values()] }, deletedAt: null },
      { projection: { orderNo: 1, productionNo: 1, customer: 1, title: 1, productionDeadline: 1, shipDate: 1, deliveryDeadline: 1, priority: 1, stage: 1, notes: 1 } },
    ).toArray() : [];
    const rank = (o: Doc) => addedAt.get(String(o._id))?.getTime() ?? Number.MAX_SAFE_INTEGER; // подхваченные без метки — в конце
    orders.sort((a, b) => rank(a) - rank(b) || String(a.orderNo ?? '').localeCompare(String(b.orderNo ?? ''), 'ru', { numeric: true }));
    const shown = orders.slice(0, ORDERS_CAP);
    const shownIds = shown.map((o) => o._id as Oid);

    const lineCounts = shownIds.length ? await this.db().collection('incomes').aggregate([
      { $match: { orderId: { $in: shownIds }, deletedAt: null } }, { $group: { _id: '$orderId', n: { $sum: 1 } } },
    ]).toArray() : [];
    const linesOf = new Map(lineCounts.map((r) => [String(r._id), r.n as number]));

    const taskFilter: Doc = { status: { $in: OPEN }, deletedAt: null, $or: [{ orderId: null }, { orderId: { $in: shownIds } }] };
    const [openTasks, tasksTotal] = await Promise.all([
      this.tasks.find(taskFilter).sort({ seq: 1 }).limit(TASKS_CAP).lean().exec(),
      this.tasks.countDocuments(taskFilter).exec(),
    ]);

    return {
      orders: shown.map((o) => {
        const e = byOrder.get(String(o._id));
        const lines = linesOf.get(String(o._id)) ?? 0;
        return {
          orderId: String(o._id), orderNo: (o.orderNo as string | undefined) ?? null, productionNo: (o.productionNo as string | undefined) ?? null, customer: (o.customer as string | undefined) ?? null,
          title: (o.title as string | undefined) ?? null,
          deadline: orderDeadline(o), shipDate: (o.shipDate as Date | undefined) ?? null, deliveryDeadline: (o.deliveryDeadline as Date | undefined) ?? null,
          priority: (o.priority as string | undefined) ?? 'normal', stage: (o.stage as string | undefined) ?? null, note: (o.notes as string | undefined) ?? null,
          addedAt: addedAt.get(String(o._id)) ?? null,
          linesCount: lines,
          counts: { ...(e?.counts ?? { queue: 0, work: 0, paused: 0, done: 0, cancelled: 0 }), free: Math.max(0, lines - (e?.lines.size ?? 0)) },
        };
      }),
      ordersTotal: orders.length,
      tasks: await presentTasks(this.connection, openTasks as Doc[]),
      tasksTotal,
      // видимые стикеры доски по порядку — один раз на ответ; значения — в tasks[].stickers
      stickers: await this.stickers.list(true),
    };
  }

  /** Позиции раскрытого заказа: у каждой — открытая задача, иначе последняя завершённая, иначе null («ещё не взято»). */
  async lines(orderIdRaw: string) {
    const orderId = oid(orderIdRaw, 'заказа');
    if (!(await this.db().collection('salesorders').findOne({ _id: orderId, deletedAt: null }, { projection: { _id: 1 } }))) throw new NotFoundException('Заказ не найден');
    const incomes = await this.db().collection('incomes').find(
      { orderId, deletedAt: null }, { projection: { lineNo: 1, title: 1, qty: 1, unit: 1, color: 1, size: 1, productId: 1, matchStatus: 1, photoIds: 1 } },
    ).sort({ lineNo: 1, createdAt: 1, _id: 1 }).toArray();
    const incomeIds = incomes.map((i) => i._id as Oid);
    const taskDocs = incomeIds.length ? await this.tasks.find({ incomeId: { $in: incomeIds }, deletedAt: null }).sort({ seq: 1 }).lean().exec() : [];
    const views = await presentTasks(this.connection, taskDocs as Doc[]);
    const pick = new Map<string, (typeof views)[number]>();
    for (const t of views) { // по возрастанию seq: открытая перекрывает завершённую, более поздняя завершённая — более раннюю
      const cur = pick.get(String(t.incomeId));
      if (!cur || t.status !== 'done' || cur.status === 'done') pick.set(String(t.incomeId), t);
    }
    const productIds = [...new Map(incomes.filter((i) => i.productId).map((i) => [String(i.productId), i.productId as Oid])).values()];
    const products = productIds.length ? await this.db().collection('products').find({ _id: { $in: productIds } }, { projection: { name: 1, sku: 1, photoIds: 1 } }).toArray() : [];
    const product = new Map(products.map((p) => [String(p._id), p as Doc]));
    const firstPhoto = (p?: Doc) => ((p?.photoIds as Oid[] | undefined) ?? [])[0];
    // фото строки: изделия, иначе своё фото позиции заказа (несопоставленная позиция или изделие без фото)
    const photoOf = (i: Doc) => firstPhoto(i.productId ? product.get(String(i.productId)) : undefined) ?? firstPhoto(i);
    const photoIds = [...new Map(incomes.map((i) => photoOf(i as Doc)).filter(Boolean).map((p) => [String(p), p as Oid])).values()];
    const photos = await loadPhotos(this.db(), photoIds);
    return {
      orderId: String(orderId),
      lines: incomes.map((i) => {
        const prod = i.productId ? product.get(String(i.productId)) : undefined;
        const t = pick.get(String(i._id));
        const photo = photoOf(i as Doc);
        return {
          incomeId: String(i._id), lineNo: (i.lineNo as number | undefined) ?? null,
          title: shortProductName(String(i.title ?? '')) || ((prod?.name as string | undefined) ?? 'Без названия'),
          customerTitle: (i.title as string | undefined) ?? null,
          qty: (i.qty as number | undefined) ?? null, unit: (i.unit as string | undefined) ?? null,
          color: (i.color as string | undefined) ?? null, size: (i.size as string | undefined) ?? null,
          productId: i.productId ? String(i.productId) : null, matched: isMatched(i), sku: (prod?.sku as string | undefined) ?? null,
          photo: photo ? photos.get(String(photo))?.thumb ?? null : null,
          task: t ? { id: t.id, code: t.code, status: t.status, assignee: t.assignee, deadline: t.deadline, priority: t.priority, pauseReason: t.pauseReason } : null,
        };
      }),
    };
  }

  /** Добавить заказ на доску (повтор безопасен); distribute — задачи «Распределение» на все позиции без открытой. */
  async addOrder(dto: AddDesignOrderDto, userId?: string) {
    const orderId = oid(dto.orderId, 'заказа');
    if (!(await this.db().collection('salesorders').findOne({ _id: orderId, deletedAt: null }, { projection: { _id: 1 } }))) throw new NotFoundException('Заказ не найден');
    await this.design.markOrder(orderId, userId);
    if (!dto.distribute) return { orderId: String(orderId), created: 0, skipped: 0 };
    const r = await this.design.fromOrder({ orderId: String(orderId) }, userId);
    return { orderId: String(orderId), created: r.created, skipped: r.skipped };
  }

  /** Убрать с доски: нельзя, пока есть открытые задачи; задачи не удаляются. */
  async removeOrder(orderIdRaw: string) {
    const orderId = oid(orderIdRaw, 'заказа');
    const open = await this.tasks.countDocuments({ orderId, status: { $in: OPEN }, deletedAt: null }).exec();
    if (open > 0) throw new ConflictException(`В заказе открытых задач: ${open} — завершите или удалите их`);
    await this.marks.updateOne({ orderId, deletedAt: null }, { $set: { deletedAt: new Date() } }).setOptions({ includeSoftDeleted: true }).exec();
    return { orderId: String(orderId), removed: true };
  }
}
