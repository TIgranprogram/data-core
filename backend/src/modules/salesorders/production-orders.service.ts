import { BadRequestException, Logger, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';
import { DataVersionService } from '../../common/data-version/data-version.service';
import { parseList } from '../../common/list-query';
import { loadLinePhotos } from '../../common/photos';
import { ACTIVE_STAGES, DONE_STAGES, ORDER_STAGES, STAGE_LABELS, type OrderStage } from '../../common/text/order-key';
import { numberLines, sortLines, sortOrdersByEntry } from '../../common/text/production-seq';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { loadOrderMatches } from '../matching/match-facts';
import { blockText, isMatched } from '../matching/matching-rules';
import { ourCompanies } from '../incomes/incomes.service';
import { loadReadinessFacts, readinessChecks, readinessWarnings, type Readiness } from './order-readiness';
import { checkAssign, compareProductionNo, groupKey, summarize, toProduce, type ProduceLine } from './production-orders';
import { SalesOrder, SalesOrderDocument } from './sales-order.schema';
import { SalesOrdersService, nextProductionNo } from './salesorders.service';

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
  private readonly log = new Logger(ProductionOrdersService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SalesOrder.name) private readonly model: Model<SalesOrderDocument>,
    private readonly orders: SalesOrdersService,
    private readonly audit: AuditService,
    private readonly notices: NotificationsService,
    @Optional() private readonly versions?: DataVersionService,
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

  /** Договоры без № заказа: id, № договора, заказчик, дата, сумма, число позиций. */
  async unassigned(q: Record<string, unknown> = {}) {
    const p = parseList(q, { sortable: ['createdAt'], defaultSort: '-createdAt', defaultLimit: 25 });
    const { filter } = this.orders.filters({ search: q.q ?? q.search });
    const full = { $and: [filter, { $or: [{ productionNo: null }, { productionNo: '' }, { productionNo: { $exists: false } }] }] };
    const [docs, total] = await Promise.all([
      this.model.find(full, { orderNo: 1, customer: 1, contractDate: 1, createdAt: 1 }).sort({ createdAt: -1, _id: -1 }).skip(p.skip).limit(p.limit).lean().exec() as Promise<Doc[]>,
      this.model.countDocuments(full).exec(),
    ]);
    const ids = docs.map((d) => d._id);
    const agg = ids.length ? await this.connection.db!.collection('incomes').aggregate([
      { $match: { orderId: { $in: ids }, deletedAt: null } },
      { $group: { _id: '$orderId', lines: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]).toArray() : [];
    const facts = await loadOrderMatches(this.connection.db!, ids);
    const sum = new Map(agg.map((a) => [String(a._id), a]));
    const items = docs.map((d) => ({
      id: String(d._id), orderNo: (d.orderNo as string | undefined) ?? '', customer: (d.customer as string | undefined) ?? '',
      date: (d.contractDate ?? d.createdAt) as Date, amount: sum.get(String(d._id))?.amount ?? 0, lineCount: sum.get(String(d._id))?.lines ?? 0,
      matchedCount: facts.get(String(d._id))?.matched ?? 0, canAssign: (facts.get(String(d._id))?.total ?? 0) > 0 && facts.get(String(d._id))?.unmatched.length === 0,
    }));
    return { items, total, page: p.page, limit: p.limit };
  }

  /** Привязка договоров к заказу: без `productionNo` — новый (следующий № года), с ним — к существующему. Позиции нумеруются сами (по productionAddedAt). */
  async assign(contractIds: string[], productionNo?: string) {
    const ids = [...new Set(contractIds)];
    if (!ids.length) throw new BadRequestException('Выберите хотя бы один договор');
    const found = await this.model.find({ _id: { $in: ids.map((i) => new Types.ObjectId(i)) }, deletedAt: null }).lean().exec() as Doc[];
    const { missing, taken } = checkAssign(ids, found);
    if (missing.length) throw new NotFoundException(`Договор не найден: ${missing.join(', ')}`);
    if (taken.length) throw new ConflictException(`Договор уже в заказе ${taken.map((t) => t.productionNo).join(', ')}`);
    // КМ4: в заказ — только когда все позиции сопоставлены (изделие подтверждено или «не изделие»)
    const facts = await loadOrderMatches(this.connection.db!, found.map((d) => d._id));
    const blocked = found.filter((d) => { const m = facts.get(String(d._id))!; return !m.total || m.unmatched.length; });
    if (blocked.length) {
      const unmatched = blocked.map((d) => ({ orderId: String(d._id), orderNo: (d.orderNo as string | undefined) ?? '', total: facts.get(String(d._id))!.total, unmatched: facts.get(String(d._id))!.unmatched.length, lines: facts.get(String(d._id))!.unmatched.slice(0, 5) }));
      const text = blocked.map((d) => blockText((d.orderNo as string | undefined) ?? '', facts.get(String(d._id))!)).join('. ');
      throw new BadRequestException({ statusCode: 400, message: `${text}. Сопоставьте их в разделе Заказы → Без заказа → Сопоставление`, error: 'Bad Request', unmatched });
    }
    let no = String(productionNo ?? '').trim();
    if (no) {
      if (!(await this.byNo(no)).length) throw new NotFoundException(`Заказ ${no} не найден`);
    } else {
      const yy = String(new Date().getFullYear() % 100).padStart(2, '0');
      const all = await this.model.find({ productionNo: new RegExp(`^\\d+-${yy}$`) }, { productionNo: 1 }).setOptions({ includeSoftDeleted: true }).lean().exec() as Doc[];
      no = nextProductionNo(all.map((d) => d.productionNo as string), yy);
    }
    const now = new Date();
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        // повторная проверка внутри транзакции: параллельная привязка того же договора → 409
        const res = await this.model.updateMany({ _id: { $in: found.map((d) => d._id) }, deletedAt: null, $or: [{ productionNo: null }, { productionNo: '' }, { productionNo: { $exists: false } }] }, { $set: { productionNo: no, productionAddedAt: now, editedInApp: true } }, { session }).exec();
        if (res.modifiedCount !== found.length) throw new ConflictException('Договор уже занят другим заказом, обновите список');
      });
    } finally { await session.endSession(); }
    for (const d of found) await this.audit.log({ action: 'salesorder.updated', entityType: 'SalesOrder', entityId: String(d._id), details: { partial: true, before: { productionNo: null }, after: { productionNo: no }, meta: { via: 'production-orders.assign' } } as never });
    return { productionNo: no, orderIds: ids };
  }

  async list(q: Record<string, unknown> = {}) {
    const p = parseList(q, { sortable: SORT, defaultSort: '-createdAt', defaultLimit: 25 });
    // группы, счётчики вкладок и порядок не зависят от страницы — считаются один раз на версию данных и фильтр
    const pure = Object.fromEntries(Object.entries(q).filter(([k]) => k !== 'page' && k !== 'limit'));
    const build = () => this.groupsAndCounts(q, p.sort);
    const { shown, counts, fresh } = this.versions
      ? await this.versions.cached('production-orders.list', ['salesorders', 'designtasks', 'designorders', 'shipments'], JSON.stringify(pure), build)
      : await build();
    const n = (ss: readonly string[]) => ss.reduce((a, s) => a + (counts[s] ?? 0), 0);
    const page = shown.slice(p.skip, p.skip + p.limit);
    const created = (g: (typeof shown)[number]) => Math.min(...g.docs.map((d) => ts(d.createdAt)));

    // сводка по позициям и названия компаний — по одному запросу на страницу
    const ids = page.flatMap((g) => g.docs.map((d) => d._id as Types.ObjectId));
    // обложка заказа — фото первой позиции, у которой оно есть (своё или изделия); позиции пачкой на всю страницу
    const cover = new Map<string, { url: string; thumb: string } | null>();
    const covLines = ids.length ? await this.connection.db!.collection('incomes').find({ orderId: { $in: ids }, deletedAt: null }, { projection: { orderId: 1, photoIds: 1, productId: 1 } }).sort({ lineNo: 1, createdAt: 1, _id: 1 }).toArray() : [];
    const covPhotos = await loadLinePhotos(this.connection.db!, covLines);
    for (const g of page) {
      for (const d of g.docs) {
        const hit = covLines.find((l) => String(l.orderId) === String(d._id) && covPhotos.get(String(l._id)));
        if (hit) { cover.set(g.key, covPhotos.get(String(hit._id))!); break; }
      }
    }
    const [agg, companies] = await Promise.all([
      ids.length ? this.connection.db!.collection('incomes').aggregate([
        { $match: { orderId: { $in: ids }, deletedAt: null } },
        { $group: { _id: '$orderId', lines: { $sum: 1 }, amount: { $sum: '$amount' }, paid: { $sum: { $cond: [{ $ifNull: ['$paidDate', false] }, '$amount', 0] } } } },
      ]).toArray() : [],
      ourCompanies(this.connection),
    ]);
    const sum = new Map(agg.map((a) => [String(a._id), a]));
    const facts = await loadReadinessFacts(this.connection.db!, new Map(page.map((g) => [g.key, this.liveIds(g.docs)])));
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
        createdAt: new Date(created(g)), coverPhoto: cover.get(g.key) ?? null,
        readiness: { ready: readinessChecks(facts.get(g.key)!, g.key, String(g.docs[0]._id)).ready },
      };
    });
    return { items, total: shown.length, page: p.page, limit: p.limit, counts: { all: n(ORDER_STAGES), active: n(ACTIVE_STAGES), done: n(DONE_STAGES), ...counts, fresh } };
  }

  /** Заказы (группы договоров) под фильтр, уже отсортированные + счётчики вкладок и «Новые». Результат общий — не менять. */
  private async groupsAndCounts(q: Record<string, unknown>, sort: Record<string, 1 | -1>) {
    // filter=new — «Новые»: этап «Новый», нет задач проектирования (живых) и отгрузок (пользователь 2026-10-28)
    const wantNew = q.filter === 'new';
    const { filter, stages } = this.orders.filters(wantNew ? { ...q, filter: undefined } : q);
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
    const allIds = groups.flatMap((g) => g.docs.map((d) => d._id));
    const db = this.connection.db!, inIds = { orderId: { $in: allIds }, deletedAt: null };
    const [dt, dm, sh] = allIds.length ? await Promise.all([
      db.collection('designtasks').distinct('orderId', inIds),
      db.collection('designorders').distinct('orderId', inIds), // заказ добавлен на доску проектирования
      db.collection('shipments').distinct('orderId', inIds),
    ]) : [[], [], []];
    const started = new Set([...dt, ...dm, ...sh].map(String));
    const isNew = (g: (typeof groups)[number]) => g.docs.every((d) => (d.stage || 'new') === 'new' && !started.has(String(d._id)));
    const fresh = groups.filter(isNew).length;
    const shown = wantNew ? groups.filter(isNew) : stages ? groups.filter((g) => stages.includes(g.stage)) : groups;

    const field = Object.keys(sort)[0], dir = sort[field];
    const cmp = (x: number, y: number) => (x === y ? 0 : x < y ? -1 : 1) * dir;
    const created = (g: (typeof groups)[number]) => Math.min(...g.docs.map((d) => ts(d.createdAt)));
    shown.sort((a, b) => {
      const r = field === 'productionNo' ? compareProductionNo(a.docs[0]?.productionNo, b.docs[0]?.productionNo, dir)
        : field === 'deadline' ? cmp(ts(a.deadline), ts(b.deadline))
        : field === 'customer' ? String(a.docs[0]?.customer ?? '').localeCompare(String(b.docs[0]?.customer ?? ''), 'ru') * dir
        : cmp(created(a), created(b)) || compareProductionNo(a.docs[0]?.productionNo, b.docs[0]?.productionNo, dir); // импорт: одна дата — свежий «номер-год» выше
      return r || b.key.localeCompare(a.key);
    });
    return { shown, counts, fresh };
  }

  /** Карточка заказа: договоры (как `salesorders/:id`, позиции со сквозным seqNo), «К производству», срок, этап. */
  async get(key: string, see: See = {}) {
    const docs = await this.members(key);
    const cards = await Promise.all(docs.map((d) => this.orders.get(String(d._id), see)));
    const seq = numberLines(docs as never, (oid) => (cards.find((c) => c.id === oid)?.lines ?? []) as never);
    const lines: ProduceLine[] = [];
    const orders = cards.map((c) => {
      const ls = sortLines(c.lines as never[]) as unknown as Array<Doc & { id: string }>;
      const withSeq = ls.map((l) => ({ ...l, seqNo: seq.get(l.id) ?? null, matched: isMatched(l) })) as Array<Doc & { id: string; seqNo: number | null }>;
      if (c.stage !== 'cancelled') {
        for (const l of withSeq) lines.push({ seqNo: l.seqNo as number, title: String(l.title ?? ''), unit: l.unit as string | undefined, qty: l.qty as number | undefined, productId: l.productId ? String(l.productId) : null, productName: (l.product as { name?: string } | null)?.name, photo: l.photo as ProduceLine['photo'] });
      }
      return { ...c, lines: withSeq, unmatchedCount: withSeq.filter((l) => !(l as unknown as { matched: boolean }).matched).length };
    });
    const sum = summarize(docs);
    return { key: groupKey(docs[0]), productionNo: String(docs[0].productionNo ?? '').trim() || null, orders, unmatchedCount: orders.reduce((a, o) => a + o.unmatchedCount, 0), toProduce: toProduce(lines), ...sum, stageLabel: STAGE_LABELS[sum.stage] };
  }

  private liveIds(docs: Doc[]) { return docs.filter((d) => d.stage !== 'cancelled').map((d) => d._id as Types.ObjectId); }

  private async evaluate(docs: Doc[], key: string): Promise<Readiness> {
    const live = docs.filter((d) => d.stage !== 'cancelled');
    const facts = await loadReadinessFacts(this.connection.db!, new Map([[key, this.liveIds(docs)]]));
    return readinessChecks(facts.get(key)!, key, String((live[0] ?? docs[0])._id));
  }

  /** Готовность заказа к отгрузке: пункты с подсказкой «что осталось». Только подсказка — этап ставит человек. */
  async readiness(key: string): Promise<Readiness> {
    const docs = await this.members(key);
    return this.evaluate(docs, groupKey(docs[0]));
  }

  /**
   * Пересчёт после события (задача проектирования, заявка): первый переход в «готово» → уведомление менеджерам
   * (без повторов: последнее состояние — в orderreadystate, данные только data-core). Ошибки не пробрасываются.
   */
  async recheck(orderId: unknown, actorId?: string): Promise<void> {
    try {
      if (!orderId || !Types.ObjectId.isValid(String(orderId))) return;
      const docs = await this.members(String(orderId));
      const key = groupKey(docs[0]);
      const r = await this.evaluate(docs, key);
      const state = this.connection.db!.collection<{ _id: string; ready: boolean }>('orderreadystate');
      const prev = await state.findOneAndUpdate({ _id: key }, { $set: { ready: r.ready, at: new Date() } }, { upsert: true, returnDocument: 'before' });
      const stage = summarize(docs).stage;
      if (r.ready && !prev?.ready && ORDER_STAGES.indexOf(stage) < ORDER_STAGES.indexOf('ready')) {
        const no = String(docs[0].productionNo ?? '').trim() || String(docs[0].orderNo ?? '');
        await this.notices.toRoles(['manager'], { type: 'order_ready', text: `Заказ ${no || 'без номера'} прошёл все проверки — можно отметить «Готов к отгрузке»`, href: `#salesorders?open=${encodeURIComponent(key)}` }, actorId);
      }
    } catch (e) {
      this.log.warn(`Пересчёт готовности заказа не удался: ${(e as Error).message}`);
    }
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
    // «Готов к отгрузке» — решение человека: не всё готово — разрешаем, но предупреждаем
    const warnings = stage === 'ready' ? readinessWarnings(await this.evaluate(docs, groupKey(docs[0]))) : [];
    return { ...(await this.get(key, see)), changed: todo.map((d) => String(d._id)), warnings };
  }
}
