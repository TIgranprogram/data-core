import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { parseList } from '../../common/list-query';
import { ACTIVE_STAGES, DONE_STAGES, ORDER_STAGES, STAGE_LABELS, type OrderStage } from '../../common/text/order-key';
import { numberLines, sortLines, sortOrdersByEntry } from '../../common/text/production-seq';
import { AuditService } from '../audit/audit.service';
import { ourCompanies } from '../incomes/incomes.service';
import { compareProductionNo, groupKey, summarize, toProduce, type ProduceLine } from './production-orders';
import { SalesOrder, SalesOrderDocument } from './sales-order.schema';
import { SalesOrdersService } from './salesorders.service';

type Doc = Record<string, unknown>;
type See = { requests?: boolean; stock?: boolean };
const SORT = ['productionNo', 'deadline', 'customer', 'createdAt'];
const FIELDS = { orderNo: 1, customer: 1, companyId: 1, stage: 1, priority: 1, productionNo: 1, productionAddedAt: 1, createdAt: 1, shipDate: 1, productionDeadline: 1, deliveryDeadline: 1 };
const ts = (d: unknown) => (d ? new Date(d as Date).getTime() : Infinity);

/**
 * Заказ производства = договоры (`salesorders`) с одним `productionNo`; без № — каждый договор сам по себе.
 * Список, карточка с группами по договорам, сквозная нумерация, «К производству», этап «ко всем договорам».
 * Группировка — в памяти (договоров сотни): так фильтры, счётчики и сортировка считаются по объединённому заказу.
 */
@Injectable()
export class ProductionOrdersService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SalesOrder.name) private readonly model: Model<SalesOrderDocument>,
    private readonly orders: SalesOrdersService,
    private readonly audit: AuditService,
  ) {}

  private async byNo(no: string) {
    return await this.model.find({ productionNo: no, deletedAt: null }).lean().exec() as Doc[];
  }

  /** Все действующие договоры заказа по ключу (№ заказа или id договора без №), по порядку входа. */
  private async members(key: string): Promise<Doc[]> {
    const k = String(key).trim();
    let docs: Doc[] = [];
    if (/^[0-9a-f]{24}$/i.test(k)) {
      const one = await this.model.findOne({ _id: new Types.ObjectId(k), deletedAt: null }).lean().exec() as Doc | null;
      if (one) docs = one.productionNo ? await this.byNo(String(one.productionNo)) : [one];
    }
    if (!docs.length) docs = await this.byNo(k);
    if (!docs.length) throw new NotFoundException('Заказ не найден');
    return sortOrdersByEntry(docs);
  }

  async list(q: Record<string, unknown> = {}) {
    const p = parseList(q, { sortable: SORT, defaultSort: '-createdAt', defaultLimit: 25 });
    const { filter, stages } = this.orders.filters(q);
    // 1) договоры, подходящие под поиск/компанию/даты; 2) весь заказ целиком по их №
    const hits = await this.model.find(filter, { productionNo: 1 }).lean().exec() as Doc[];
    const nos = [...new Set(hits.map((h) => String(h.productionNo ?? '').trim()).filter(Boolean))];
    const singles = hits.filter((h) => !String(h.productionNo ?? '').trim()).map((h) => h._id);
    const or = [...(nos.length ? [{ productionNo: { $in: nos } }] : []), ...(singles.length ? [{ _id: { $in: singles } }] : [])];
    const docs = or.length ? await this.model.find({ deletedAt: null, $or: or }, FIELDS).lean().exec() as Doc[] : [];
    const byKey = new Map<string, Doc[]>();
    for (const d of docs) byKey.set(groupKey(d), [...(byKey.get(groupKey(d)) ?? []), d]);
    const groups = [...byKey.entries()].map(([key, ds]) => ({ key, docs: sortOrdersByEntry(ds), ...summarize(ds) }));

    // счётчики вкладок — по объединённым заказам, до отбора по этапу
    const counts: Record<string, number> = Object.fromEntries(ORDER_STAGES.map((s) => [s, 0]));
    for (const g of groups) counts[g.stage]++;
    const n = (ss: readonly string[]) => ss.reduce((a, s) => a + (counts[s] ?? 0), 0);
    const shown = stages ? groups.filter((g) => stages.includes(g.stage)) : groups;

    const field = Object.keys(p.sort)[0], dir = p.sort[field];
    const cmp = (x: number, y: number) => (x === y ? 0 : x < y ? -1 : 1) * dir;
    const created = (g: (typeof groups)[number]) => Math.min(...g.docs.map((d) => ts(d.createdAt)));
    shown.sort((a, b) => {
      const r = field === 'productionNo' ? compareProductionNo(a.docs[0]?.productionNo, b.docs[0]?.productionNo, dir)
        : field === 'deadline' ? cmp(ts(a.deadline), ts(b.deadline))
        : field === 'customer' ? String(a.docs[0]?.customer ?? '').localeCompare(String(b.docs[0]?.customer ?? ''), 'ru') * dir
        : cmp(created(a), created(b));
      return r || b.key.localeCompare(a.key);
    });
    const page = shown.slice(p.skip, p.skip + p.limit);

    // сводка по позициям и названия компаний — по одному запросу на страницу
    const ids = page.flatMap((g) => g.docs.map((d) => d._id as Types.ObjectId));
    const [agg, companies] = await Promise.all([
      ids.length ? this.connection.db!.collection('incomes').aggregate([
        { $match: { orderId: { $in: ids }, deletedAt: null } },
        { $group: { _id: '$orderId', lines: { $sum: 1 }, amount: { $sum: '$amount' }, paid: { $sum: { $cond: [{ $ifNull: ['$paidDate', false] }, '$amount', 0] } } } },
      ]).toArray() : [],
      ourCompanies(this.connection),
    ]);
    const sum = new Map(agg.map((a) => [String(a._id), a]));
    const cname = new Map(companies.map((c) => [String(c.id), c.name]));
    const uniq = (v: unknown[]) => [...new Set(v.filter(Boolean).map(String))];
    const items = page.map((g) => {
      const part = g.docs.map((d) => sum.get(String(d._id)));
      return {
        key: g.key, productionNo: String(g.docs[0]?.productionNo ?? '').trim() || null,
        orderIds: g.docs.map((d) => String(d._id)), orderNos: g.docs.map((d) => (d.orderNo as string | undefined) ?? ''),
        customers: uniq(g.docs.map((d) => d.customer)), companyNames: uniq(g.docs.map((d) => (d.companyId ? cname.get(String(d.companyId)) : null))),
        lineCount: part.reduce((a, s) => a + (s?.lines ?? 0), 0), amount: part.reduce((a, s) => a + (s?.amount ?? 0), 0), paidAmount: part.reduce((a, s) => a + (s?.paid ?? 0), 0),
        deadline: g.deadline, stage: g.stage, stageLabel: STAGE_LABELS[g.stage], stagesDiffer: g.stagesDiffer, priority: g.priority,
        createdAt: new Date(created(g)),
      };
    });
    return { items, total: shown.length, page: p.page, limit: p.limit, counts: { all: n(ORDER_STAGES), active: n(ACTIVE_STAGES), done: n(DONE_STAGES), ...counts } };
  }

  /** Карточка заказа: договоры (как `salesorders/:id`, позиции со сквозным seqNo), «К производству», срок, этап. */
  async get(key: string, see: See = {}) {
    const docs = await this.members(key);
    const cards = await Promise.all(docs.map((d) => this.orders.get(String(d._id), see)));
    const seq = numberLines(docs as never, (oid) => (cards.find((c) => c.id === oid)?.lines ?? []) as never);
    const lines: ProduceLine[] = [];
    const orders = cards.map((c) => {
      const ls = sortLines(c.lines as never[]) as unknown as Array<Doc & { id: string }>;
      const withSeq = ls.map((l) => ({ ...l, seqNo: seq.get(l.id) ?? null })) as Array<Doc & { id: string; seqNo: number | null }>;
      if (c.stage !== 'cancelled') {
        for (const l of withSeq) lines.push({ seqNo: l.seqNo as number, title: String(l.title ?? ''), unit: l.unit as string | undefined, qty: l.qty as number | undefined, productId: l.productId ? String(l.productId) : null, productName: (l.product as { name?: string } | null)?.name });
      }
      return { ...c, lines: withSeq };
    });
    const sum = summarize(docs);
    return { key: groupKey(docs[0]), productionNo: String(docs[0].productionNo ?? '').trim() || null, orders, toProduce: toProduce(lines), ...sum, stageLabel: STAGE_LABELS[sum.stage] };
  }

  /** Этап «ко всем договорам»: подтягивает отстающие договоры до `stage` (опережающие и отменённые не трогает), пишет историю каждого. */
  async setStage(key: string, stage: string, see: See = {}) {
    if (!(ORDER_STAGES as readonly string[]).includes(stage)) throw new BadRequestException(`Неизвестный этап «${stage}»`);
    if (stage === 'cancelled') throw new BadRequestException('Отменить можно только договор — откройте его и отмените там');
    const docs = await this.members(key);
    const target = ORDER_STAGES.indexOf(stage as OrderStage);
    const todo = docs.filter((d) => d.stage !== 'cancelled' && ORDER_STAGES.indexOf((d.stage as OrderStage) || 'new') < target);
    for (const d of todo) {
      await this.model.updateOne({ _id: d._id }, { $set: { stage, editedInApp: true } }).exec();
      await this.audit.log({ action: 'salesorder.updated', entityType: 'SalesOrder', entityId: String(d._id), details: { partial: true, before: { stage: d.stage }, after: { stage }, meta: { via: 'production-orders', key } } as never });
    }
    return { ...(await this.get(key, see)), changed: todo.map((d) => String(d._id)) };
  }
}
