import { BadRequestException } from '@nestjs/common';
import { Types, type Connection } from 'mongoose';
import { loadSeq } from '../../common/text/production-seq';
import { readinessOf } from './passport-consts';
import type { CreateProductPassportDto } from './dto/create-product-passport.dto';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Db = NonNullable<Connection['db']>;

/** Паспорт позиции из очереди: нет / черновик / доработать. */
export type QueueState = 'none' | 'draft' | 'rework';
export interface QueueItem {
  incomeId: string; orderId: string; orderNo: string | null; productionNo: string | null; customer: string | null; lineNo: number | null; seqNo: number | null; title: string;
  productId: string; productName: string | null; shipDate: Date | null; priority: string; designDoneAt: Date | null;
  passportId: string | null; passportState: QueueState; hot: boolean;
  /** Задание «В работе» по позиции (последнее живое); паспорт — после изготовления, пока status ≠ done. */
  work: { id: string; status: string; currentStep: string | null } | null;
}

const RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
/** «Горит»: до отгрузки ≤ 3 дней или просрочено (как «Сегодня»). */
export const HOT_DAYS = 3;
const mskToday = (now: Date) => new Date(new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10) + 'T00:00:00.000Z');
const days = (ship: Date | null, today: Date) => (ship ? Math.round((new Date(ship).getTime() - today.getTime()) / 86400000) : null);

/** seq — сквозной № позиции по заказу производства (id позиции → №); нет записи — позиция договора без № заказа. */
interface Inputs { works?: Doc[]; tasks: Doc[]; incomes: Doc[]; orders: Doc[]; passports: Doc[]; products: Doc[]; seq?: Map<string, { seqNo: number }> }

/**
 * Очередь паспортов (чистая функция): позиция попадает, если заказ жив и не закрыт/отменён, есть изделие, проектирование завершено
 * (`designtasks.status = done`) и нет паспорта этой позиции в состоянии «готов». Паспорт позиции — по `incomeId`; у старых без него —
 * по заказу и изделию, причём один такой паспорт закрывает не более одной позиции (два одинаковых изделия не считаются готовыми по одному паспорту).
 */
export function buildQueue(inp: Inputs, q: { due?: string; search?: string; limit?: number }, now = new Date()) {
  const today = mskToday(now);
  const order = new Map(inp.orders.map((o) => [String(o._id), o]));
  const prod = new Map(inp.products.map((p) => [String(p._id), p]));
  const doneAt = new Map<string, Date>();
  for (const t of inp.tasks) {
    const k = String(t.incomeId), at = (t.completedAt ?? t.updatedAt ?? null) as Date | null;
    if (!doneAt.has(k) || (at && at > doneAt.get(k)!)) doneAt.set(k, at as Date);
  }
  const work = new Map<string, QueueItem['work']>();
  for (const w of inp.works ?? []) { // порядок — по созданию, последнее перекрывает
    const route = (w.route as Array<{ name: string }> | undefined) ?? [], si = (w.stepIndex as number | null | undefined) ?? null;
    work.set(String(w.incomeId), { id: String(w._id), status: String(w.status), currentStep: si !== null && si < route.length ? route[si].name : null });
  }
  const exact = new Map<string, Doc[]>();
  const pool = new Map<string, Doc[]>();
  for (const p of inp.passports) {
    if (p.incomeId) { const k = String(p.incomeId); exact.set(k, [...(exact.get(k) ?? []), p]); continue; }
    if (!p.salesOrderId || !p.productId) continue;
    const k = `${p.salesOrderId}|${p.productId}`;
    pool.set(k, [...(pool.get(k) ?? []), p]);
  }
  const ord = { ready: 0, rework: 1, notReady: 2 } as const;
  for (const list of pool.values()) list.sort((a, b) => ord[readinessOf(a)] - ord[readinessOf(b)]);

  const lines = [...inp.incomes].sort((a, b) => (a.lineNo ?? 1e9) - (b.lineNo ?? 1e9));
  const all: QueueItem[] = [];
  for (const inc of lines) {
    const o = order.get(String(inc.orderId));
    if (!o || !inc.productId || !doneAt.has(String(inc._id))) continue;
    let mine = exact.get(String(inc._id));
    if (!mine?.length) {
      const taken = pool.get(`${inc.orderId}|${inc.productId}`)?.shift();
      mine = taken ? [taken] : [];
    }
    const states = mine.map((p) => readinessOf(p));
    if (states.includes('ready')) continue;
    const pick = mine.find((p) => readinessOf(p) === 'rework') ?? mine[0];
    const d = days(o.shipDate ?? null, today);
    all.push({
      incomeId: String(inc._id), orderId: String(o._id), orderNo: o.orderNo ?? null, productionNo: o.productionNo || null, customer: o.customer ?? null, lineNo: inc.lineNo ?? null, seqNo: inp.seq?.get(String(inc._id))?.seqNo ?? null,
      title: String(inc.title ?? ''), productId: String(inc.productId), productName: (prod.get(String(inc.productId))?.name as string | undefined) ?? null,
      shipDate: o.shipDate ?? null, priority: o.priority ?? 'normal', designDoneAt: doneAt.get(String(inc._id)) ?? null,
      passportId: pick ? String(pick._id) : null, passportState: !pick ? 'none' : readinessOf(pick) === 'rework' ? 'rework' : 'draft',
      hot: d !== null && d <= HOT_DAYS, work: work.get(String(inc._id)) ?? null,
    });
  }
  const words = String(q.search ?? '').toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  const found = words.length
    ? all.filter((i) => { const hay = [i.orderNo, i.customer, i.title, i.productName].join(' ').toLowerCase().replace(/ё/g, 'е'); return words.every((w) => hay.includes(w)); })
    : all;
  const dd = (i: QueueItem) => days(i.shipDate, today);
  const filtered = q.due === 'overdue' ? found.filter((i) => (dd(i) ?? 1) < 0) : q.due === 'soon' ? found.filter((i) => dd(i) !== null && dd(i)! >= 0 && dd(i)! <= HOT_DAYS) : found;
  filtered.sort((a, b) => {
    const sa = a.shipDate ? new Date(a.shipDate).getTime() : Infinity, sb = b.shipDate ? new Date(b.shipDate).getTime() : Infinity;
    return (sa === sb ? 0 : sa < sb ? -1 : 1) || (RANK[a.priority] ?? 2) - (RANK[b.priority] ?? 2)
      || (a.designDoneAt ? new Date(a.designDoneAt).getTime() : 0) - (b.designDoneAt ? new Date(b.designDoneAt).getTime() : 0);
  });
  const limit = Math.min(500, Math.max(1, Math.floor(Number(q.limit) || 200)));
  return {
    items: filtered.slice(0, limit), total: filtered.length,
    counts: { none: found.filter((i) => i.passportState === 'none').length, draft: found.filter((i) => i.passportState === 'draft').length, rework: found.filter((i) => i.passportState === 'rework').length, hot: found.filter((i) => i.hot).length },
  };
}

/** Читает данные очереди (одним проходом, без денег) и строит её. */
export async function loadQueue(db: Db, q: { due?: string; search?: string; limit?: number }) {
  const tasks = await db.collection('designtasks').find({ status: 'done', deletedAt: null, incomeId: { $ne: null } }, { projection: { incomeId: 1, completedAt: 1, updatedAt: 1 } }).toArray();
  const incomeIds = [...new Set(tasks.map((t) => String(t.incomeId)))].map((x) => new Types.ObjectId(x));
  const incomes = incomeIds.length ? await db.collection('incomes').find({ _id: { $in: incomeIds }, deletedAt: null, cancelledAt: null, productId: { $ne: null } }, { projection: { orderId: 1, lineNo: 1, title: 1, productId: 1 } }).toArray() : [];
  const orderIds = [...new Set(incomes.map((i) => String(i.orderId)).filter((x) => Types.ObjectId.isValid(x)))].map((x) => new Types.ObjectId(x));
  const orders = orderIds.length ? await db.collection('salesorders').find({ _id: { $in: orderIds }, deletedAt: null, stage: { $nin: ['closed', 'cancelled'] } }, { projection: { orderNo: 1, productionNo: 1, customer: 1, shipDate: 1, priority: 1 } }).toArray() : [];
  const liveOrders = orders.map((o) => o._id);
  const passports = liveOrders.length ? await db.collection('productpassports').find(
    { deletedAt: null, status: { $ne: 'annulled' }, $or: [{ incomeId: { $in: incomes.map((i) => i._id) } }, { salesOrderId: { $in: liveOrders }, incomeId: null }] },
    { projection: { incomeId: 1, salesOrderId: 1, productId: 1, readiness: 1, status: 1, passportNumber: 1 } }).toArray() : [];
  const products = incomes.length ? await db.collection('products').find({ _id: { $in: [...new Set(incomes.map((i) => String(i.productId)))].map((x) => new Types.ObjectId(x)) } }, { projection: { name: 1 } }).toArray() : [];
  const works = incomeIds.length ? await db.collection('worktasks').find({ incomeId: { $in: incomeIds }, deletedAt: null, status: { $ne: 'cancelled' } }, { projection: { incomeId: 1, status: 1, route: 1, stepIndex: 1 } }).sort({ createdAt: 1 }).toArray() : [];
  return buildQueue({ works, tasks, incomes, orders, passports, products, seq: await loadSeq(db, orderIds) }, q);
}

/** Наша фирма, только если она ровно одна (C062). Несколько или ни одной — null: фирму выбирают. */
export async function ourSupplierId(db: Db): Promise<Types.ObjectId | null> {
  const rows = await db.collection('organizations').find({ isOurCompany: true, deletedAt: null }, { projection: { _id: 1 } }).limit(2).toArray();
  return rows.length === 1 ? (rows[0]._id as Types.ObjectId) : null;
}

/** Наша фирма заказа (`salesorders.companyId`), если запись живая и isOurCompany. */
async function firmFromOrder(db: Db, order: { companyId?: unknown } | null): Promise<string | undefined> {
  const cid = order?.companyId;
  if (!cid || !Types.ObjectId.isValid(String(cid))) return undefined;
  const org = await db.collection('organizations').findOne(
    { _id: new Types.ObjectId(String(cid)), isOurCompany: true, deletedAt: null },
    { projection: { _id: 1 } },
  );
  return org ? String(org._id) : undefined;
}

type OrderHead = { _id?: unknown; orderNo?: unknown; customer?: unknown; companyId?: unknown; productionNo?: unknown; offerId?: unknown };

/** Адрес установки: у заказа своего поля нет — берём объект связанного КП, если менеджер не вписал свой. */
async function addressFromOrder(db: Db, order: OrderHead | null): Promise<string | undefined> {
  const id = order?.offerId;
  if (!id || !Types.ObjectId.isValid(String(id))) return undefined;
  const off = await db.collection('offers').findOne(
    { _id: new Types.ObjectId(String(id)), deletedAt: null },
    { projection: { objectName: 1 } },
  );
  const name = String(off?.objectName ?? '').trim();
  return name || undefined;
}

/**
 * Паспорт «из очереди» / с заказа: позиция → заказ, №, изделие, заказчик, адрес (объект КП);
 * фирма — явная, иначе companyId заказа (наша), иначе единственная наша (C063).
 */
export async function fromIncome(db: Db, dto: CreateProductPassportDto): Promise<CreateProductPassportDto> {
  let filled: CreateProductPassportDto = { ...dto };
  let order: OrderHead | null = null;
  const head = { projection: { orderNo: 1, productionNo: 1, customer: 1, companyId: 1, offerId: 1 } };

  if (dto.incomeId) {
    const inc = await db.collection('incomes').findOne({ _id: new Types.ObjectId(dto.incomeId), deletedAt: null }, { projection: { orderId: 1, productId: 1 } });
    if (!inc) throw new BadRequestException('Позиция заказа не найдена');
    order = inc.orderId
      ? await db.collection('salesorders').findOne({ _id: inc.orderId, deletedAt: null }, head) as OrderHead | null
      : null;
    filled = {
      ...filled,
      salesOrderId: dto.salesOrderId ?? (order ? String(order._id) : undefined),
      orderNo: dto.orderNo ?? (order?.orderNo as string | undefined) ?? (order?.productionNo as string | undefined),
      customerName: dto.customerName ?? (order?.customer as string | undefined),
      productId: dto.productId ?? (inc.productId ? String(inc.productId) : undefined),
    };
  } else if (dto.salesOrderId && Types.ObjectId.isValid(String(dto.salesOrderId))) {
    order = await db.collection('salesorders').findOne(
      { _id: new Types.ObjectId(String(dto.salesOrderId)), deletedAt: null },
      head,
    ) as OrderHead | null;
    if (order) {
      filled = {
        ...filled,
        orderNo: dto.orderNo ?? (order.orderNo as string | undefined) ?? (order.productionNo as string | undefined),
        customerName: dto.customerName ?? (order.customer as string | undefined),
      };
    }
  }

  if (!filled.objectName) {
    const addr = await addressFromOrder(db, order);
    if (addr) filled.objectName = addr;
  }
  if (!filled.supplierOrgId) {
    filled.supplierOrgId = (await firmFromOrder(db, order)) ?? (await ourSupplierId(db))?.toString();
  }
  return filled;
}

