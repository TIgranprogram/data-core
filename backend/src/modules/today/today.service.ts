import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { openSectionsFor, sectionOpen } from '../../common/app-sections';
import { ACTIVE_STAGES } from '../../common/text/order-key';
import { canSeeMoney } from '../../common/roles-hierarchy';
import { FinanceService } from '../finance/finance.service';
import { presentWork } from '../work/work-present';
import { StockService } from '../stock/stock.service';
import { ZonesService } from '../zones/zones.service';
import { isMine, pickScope, ZONE_OF } from './today-scope';
import { addDays, buildFeed, buildPulse, buildWeek, type RawItem } from './today-feed';

const iso = (d: unknown) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '');
const LIMIT = 300;
/** Заказ ещё не отгружен. */
const NOT_SHIPPED = ['new', 'production', 'ready', 'partly'];
const STAGES = ['new', 'production', 'ready', 'partly', 'shipped'];

/**
 * «Сегодня» (GET /api/today): лента дел, неделя, показатели. Только чтение.
 * Раздел, закрытый для роли (`roles.appSections`), и деньги не-денежной роли не читаются вовсе.
 * Поставка — `supplyrequests.neededBy` при status ordered; отгрузка — `salesorders.shipDate` при этапе до «отгружен»;
 * срок задачи — `designtasks.manual.deadline`, иначе срок/отгрузка заказа; вопрос — `designnotes.needsAnswer`.
 */
@Injectable()
export class TodayService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly finance: FinanceService,
    private readonly stock: StockService,
    @Optional() private readonly zones?: ZonesService,
  ) {}

  async get(user: { id?: string; role?: string; isOwner?: boolean } | undefined, q: { days?: unknown; scope?: unknown }, now = new Date()) {
    const days = q.days === undefined || q.days === '' ? 7 : Number(q.days);
    if (!Number.isInteger(days) || days < 1 || days > 31) throw new BadRequestException('Горизонт — от 1 до 31 дня');
    // дата по Москве: сервер живёт в UTC, а день менеджера начинается раньше
    const today = new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10);
    const open = openSectionsFor(user);
    const see = (id: string) => sectionOpen(open, id);
    const money = canSeeMoney(user) && see('money');
    const db = this.connection.db!;
    const horizon = addDays(today, Math.max(days - 1, 3));
    const upto = new Date(horizon + 'T23:59:59.999Z');
    const none = Promise.resolve(null);

    const [supply, orders, design, work, questions, stock, forecast] = await Promise.all([
      see('requests') ? this.supply(db, upto) : none,
      see('salesorders') ? this.orders(db, upto, today) : none,
      see('design') ? this.design(db, upto, today) : none,
      see('work') ? this.work(db, upto) : none,
      see('design') ? this.questions(db) : none,
      see('stock') ? this.stockCounts() : none,
      money ? this.finance.forecast({ days: 14, today }) : none,
    ]);

    const items: RawItem[] = [...(supply?.items ?? []), ...(orders?.items ?? []), ...(design?.items ?? []), ...(work?.items ?? []), ...(questions?.items ?? [])];
    const payments: RawItem[] = (forecast?.days ?? []).filter((d) => d.expense > 0).map((d) => ({
      kind: 'payment' as const, id: d.date, title: `К оплате ${Math.round(d.expense).toLocaleString('ru-RU')} ₽`, sub: '', due: d.date,
      actions: [{ id: 'open', label: 'Открыть' }],
    }));
    items.push(...payments);
    for (const it of items) it.zoneCode = ZONE_OF[it.kind];
    const zs = (await this.zones?.scopeOf(user?.id)) ?? null;
    const scope = pickScope(q.scope, zs);
    const shown = scope.mode === 'mine' && zs ? items.filter((it) => isMine(it, zs)) : items;

    const { feed, total, all } = buildFeed(shown, today);
    const metrics: Record<string, unknown> = {};
    if (supply) metrics.supply = { counts: supply.counts };
    if (orders) metrics.orders = { byStage: orders.byStage, overdue: orders.overdue };
    if (stock) metrics.stock = stock;
    if (design) metrics.design = { counts: design.counts };
    if (work) metrics.work = work.inWork;
    if (forecast) metrics.money = { days: forecast.days.map((d) => ({ date: d.date, balance: d.closing })) };
    return { today, scope, pulse: buildPulse(all), feed, feedTotal: total, week: buildWeek(shown, today, days), metrics };
  }

  /**
   * Числа на пунктах меню одним запросом (GET /api/me/counters). Те же значения, что давали списки с limit=1.
   * Ключ раздела, закрытого роли, в ответе отсутствует; «ждём оплату» — только денежным ролям.
   */
  async counters(user: { id?: string; role?: string; isOwner?: boolean } | undefined) {
    const open = openSectionsFor(user);
    const see = (id: string) => sectionOpen(open, id);
    const db = this.connection.db!;
    const live = { deletedAt: null };
    const count = (coll: string, filter: Record<string, unknown>) => db.collection(coll).countDocuments({ ...live, ...filter });
    const out: Record<string, number> = {};
    await Promise.all([
      see('requests') && count('supplyrequests', { status: { $in: ['requested', 'in_progress', 'ordered', null] } }).then((n) => { out.requests = n; }),
      see('stock') && this.stockCounts().then((c) => { out.stockLow = c.low + c.none; }),
      see('money') && canSeeMoney(user) && count('incomes', { paidDate: null, paidAmount: { $not: { $gt: 0 } }, shipDate: { $ne: null }, amount: { $gt: 0 } }).then((n) => { out.awaiting = n; }),
      see('salesorders') && count('salesorders', { stage: { $in: [...ACTIVE_STAGES, null] } }).then((n) => { out.salesorders = n; }),
      see('design') && count('designtasks', { status: { $in: ['queue', 'work'] } }).then((n) => { out.design = n; }),
      see('work') && count('worktasks', { status: { $in: ['waiting', 'work'] } }).then((n) => { out.work = n; }),
    ]);
    return out;
  }

  private async supply(db: NonNullable<Connection['db']>, upto: Date) {
    const base = { deletedAt: null };
    const [by, rows] = await Promise.all([
      db.collection('supplyrequests').aggregate<{ _id: string; n: number }>([{ $match: base }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
      db.collection('supplyrequests').find({ ...base, status: 'ordered', neededBy: { $lte: upto } },
        { projection: { num: 1, title: 1, neededBy: 1, supplierId: 1, requestedBy: 1, responsibleId: 1 }, sort: { neededBy: 1 }, limit: LIMIT }).toArray(),
    ]);
    const counts: Record<string, number> = { requested: 0, in_progress: 0, ordered: 0, received: 0 };
    for (const b of by) if (b._id in counts) counts[b._id] = b.n;
    const items = rows.flatMap((r) => (iso(r.neededBy) ? [{
      kind: 'delivery' as const, id: String(r._id), title: String(r.title ?? 'Заявка'), sub: r.num ? `Заявка №${r.num}` : '', due: iso(r.neededBy),
      actions: [{ id: 'receive', label: 'Принять' }, { id: 'move', label: 'Перенести дату' }],
      ...(r.responsibleId ? { personId: String(r.responsibleId) } : {}),
    }] : []));
    return { counts, items };
  }

  private async orders(db: NonNullable<Connection['db']>, upto: Date, today: string) {
    const base = { deletedAt: null };
    const [by, overdue, rows] = await Promise.all([
      db.collection('salesorders').aggregate<{ _id: string; n: number }>([{ $match: { ...base, stage: { $in: STAGES } } }, { $group: { _id: '$stage', n: { $sum: 1 } } }]).toArray(),
      db.collection('salesorders').countDocuments({ ...base, stage: { $in: NOT_SHIPPED }, shipDate: { $lt: new Date(today + 'T00:00:00Z') } }),
      db.collection('salesorders').find({ ...base, stage: { $in: NOT_SHIPPED }, shipDate: { $lte: upto } },
        { projection: { orderNo: 1, customer: 1, title: 1, shipDate: 1, responsibleId: 1 }, sort: { shipDate: 1 }, limit: LIMIT }).toArray(),
    ]);
    const byStage: Record<string, number> = Object.fromEntries(STAGES.map((s) => [s, 0]));
    for (const b of by) byStage[b._id] = b.n;
    const items = rows.flatMap((o) => (iso(o.shipDate) ? [{
      kind: 'shipment' as const, id: String(o._id), title: `Заказ ${o.orderNo ?? ''}`.trim(), sub: String(o.customer ?? o.title ?? ''), due: iso(o.shipDate),
      actions: [{ id: 'open', label: 'Открыть' }, { id: 'shipped', label: 'Отгружено' }],
      ...(o.responsibleId ? { personId: String(o.responsibleId) } : {}),
    }] : []));
    return { byStage, overdue, items };
  }

  private async design(db: NonNullable<Connection['db']>, upto: Date, today: string) {
    const base = { deletedAt: null };
    const [by, doneWeek, rows] = await Promise.all([
      db.collection('designtasks').aggregate<{ _id: string; n: number }>([{ $match: base }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
      db.collection('designtasks').countDocuments({ ...base, status: 'done', completedAt: { $gte: new Date(addDays(today, -7) + 'T00:00:00Z') } }),
      db.collection('designtasks').find({ ...base, status: { $in: ['queue', 'work'] } },
        { projection: { seq: 1, title: 1, orderId: 1, assigneeId: 1, 'manual.deadline': 1 }, limit: LIMIT }).toArray(),
    ]);
    const counts = { queue: 0, work: 0, paused: 0, done: doneWeek };
    for (const b of by) if (b._id === 'queue' || b._id === 'work' || b._id === 'paused') counts[b._id] = b.n;
    const oids = rows.filter((r) => r.orderId).map((r) => r.orderId);
    const ords = oids.length ? await db.collection('salesorders').find({ _id: { $in: oids } },
      { projection: { orderNo: 1, productionDeadline: 1, shipDate: 1 } }).toArray() : [];
    const ord = new Map(ords.map((o) => [String(o._id), o]));
    const items = rows.flatMap((r) => {
      const o = r.orderId ? ord.get(String(r.orderId)) : undefined;
      const due = iso((r.manual as { deadline?: Date } | undefined)?.deadline) || iso(o?.productionDeadline) || iso(o?.shipDate);
      if (!due || new Date(due + 'T00:00:00Z') > upto) return [];
      return [{ kind: 'design' as const, id: String(r._id), title: String(r.title || `Задача D-${r.seq}`), sub: o?.orderNo ? `Заказ ${o.orderNo}` : '', due, actions: [{ id: 'open', label: 'Открыть' }], ...(r.assigneeId ? { personId: String(r.assigneeId) } : {}) }];
    });
    return { counts, items };
  }

  /** Задания «В работе» (ждут запуска и идут) со сроком заказа: без срока в ленту не идут. Метрика — число заданий в работе. */
  private async work(db: NonNullable<Connection['db']>, upto: Date) {
    const base = { deletedAt: null };
    const [inWork, rows] = await Promise.all([
      db.collection('worktasks').countDocuments({ ...base, status: 'work' }),
      db.collection('worktasks').find({ ...base, status: { $in: ['waiting', 'work'] } }, { sort: { seq: 1 }, limit: LIMIT }).toArray(),
    ]);
    const shown = await presentWork(this.connection, rows);
    const items = shown.flatMap((w) => {
      const due = iso(w.deadline);
      if (!due || new Date(due + 'T00:00:00Z') > upto) return [];
      return [{
        kind: 'work' as const, id: w.id, title: w.currentStep ? `${w.title} · ${w.currentStep}` : w.title,
        sub: [w.customer, w.productionNo ? `заказ № ${w.productionNo}` : ''].filter(Boolean).join(' · '), due, actions: [],
        ...(w.assigneeId ? { personId: w.assigneeId } : {}),
      }];
    });
    return { inWork, items };
  }

  /** Открытые вопросы по задачам проектирования: срок — день вопроса (ждёт ответа «сегодня и дольше»). */
  private async questions(db: NonNullable<Connection['db']>) {
    const rows = await db.collection('designnotes').find({ needsAnswer: true, deletedAt: null },
      { projection: { taskId: 1, text: 1, createdAt: 1 }, sort: { createdAt: 1 }, limit: 50 }).toArray();
    const tasks = rows.length ? await db.collection('designtasks').find({ _id: { $in: rows.map((r) => r.taskId) } }, { projection: { seq: 1, title: 1, assigneeId: 1 } }).toArray() : [];
    const t = new Map(tasks.map((x) => [String(x._id), x]));
    const items = rows.map((r) => {
      const task = t.get(String(r.taskId));
      return {
        kind: 'question' as const, id: String(r._id), taskId: String(r.taskId), title: String(r.text ?? '').slice(0, 120), sub: String(task?.title || (task ? `Задача D-${task.seq}` : '')), due: iso(r.createdAt) || '9999-12-31',
        actions: [{ id: 'answer', label: 'Ответить' }],
        ...(task?.assigneeId ? { personId: String(task.assigneeId) } : {}),
      };
    });
    return { items };
  }

  private async stockCounts() {
    const { counts } = await this.stock.listItems({ limit: 1 });
    return { ok: counts.ok, low: counts.low, none: counts.none };
  }
}
