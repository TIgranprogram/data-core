import { NotFoundException } from '@nestjs/common';
import { Types, type Connection } from 'mongoose';
import { isIssued } from './passport-consts';

type Doc = Record<string, unknown>;
type Db = NonNullable<Connection['db']>;

/** Что плану и выпуску по заказу нужно от сервиса паспортов. */
export interface OrderHost {
  db: () => Db;
  /** Чего не хватает у изделия (шаблон): список подписей. */
  templateMissing: (productId: string, variant?: string) => Promise<string[]>;
  /** Черновик на позицию (поля заказа подтягиваются из позиции). */
  createDraft: (incomeId: string, title?: string) => Promise<{ id: string }>;
  /** Есть ли «наша фирма» — поставщик новых паспортов по умолчанию. */
  hasOurSupplier: () => Promise<boolean>;
  issue: (id: string) => Promise<unknown>;
  discard: (id: string) => Promise<void>;
}

export interface PlanLine {
  incomeId: string;
  lineNo: number | null;
  title: string;
  productId: string | null;
  productName: string | null;
  /** артикул изделия (sku) */
  article: string | null;
  qty: number | null;
  passport: { id: string; number: string | null; status: 'draft' | 'issued' } | null;
  /** issued — уже выпущен; ready — можно выпускать; blocked — чего-то не хватает */
  state: 'issued' | 'ready' | 'blocked';
  missing: string[];
}

export interface SkipLine { incomeId: string; title: string; reason: string }

const MAX_MISSING = 5;
const brief = (labels: string[]) => (labels.length > MAX_MISSING ? [...labels.slice(0, MAX_MISSING), `и ещё ${labels.length - MAX_MISSING}`] : labels);

async function orderOf(db: Db, orderId: string) {
  const _id = Types.ObjectId.isValid(orderId) ? new Types.ObjectId(orderId) : null;
  const order = _id ? await db.collection('salesorders').findOne({ _id, deletedAt: null }, { projection: { orderNo: 1, customer: 1 } }) : null;
  if (!order) throw new NotFoundException('Заказ не найден');
  return order;
}

/** План «Паспорта на весь заказ»: по каждой позиции заказа — изделие, количество, паспорт, готовность и чего не хватает. */
export async function orderPlan(h: OrderHost, orderId: string, variant?: string) {
  const db = h.db();
  const order = await orderOf(db, orderId);
  const incomes = await db.collection('incomes').find({ orderId: order._id, deletedAt: null, cancelledAt: null }, { projection: { title: 1, qty: 1, lineNo: 1, productId: 1 } }).sort({ lineNo: 1, _id: 1 }).toArray();
  const ids = incomes.map((i) => i._id);
  const pass = ids.length ? await db.collection('productpassports').find({ incomeId: { $in: ids }, deletedAt: null, status: { $ne: 'annulled' } }, { projection: { incomeId: 1, status: 1, passportNumber: 1, supplierOrgId: 1 } }).sort({ createdAt: 1 }).toArray() : [];
  const byIncome = new Map<string, Doc>();
  for (const p of pass) { const k = String(p.incomeId); const had = byIncome.get(k); if (!had || (!isIssued(had) && isIssued(p as Doc))) byIncome.set(k, p); } // выпущенный важнее черновика
  const pids = [...new Set(incomes.filter((i) => i.productId).map((i) => String(i.productId)))];
  const prods = pids.length ? await db.collection('products').find({ _id: { $in: pids.map((x) => new Types.ObjectId(x)) } }, { projection: { name: 1, sku: 1 } }).toArray() : [];
  const pname = new Map(prods.map((p) => [String(p._id), String(p.name ?? '')]));
  const psku = new Map(prods.map((p) => [String(p._id), p.sku ? String(p.sku) : null]));
  const lines: PlanLine[] = [];
  let ourSupplier: boolean | null = null;
  for (const inc of incomes) {
    const p = byIncome.get(String(inc._id));
    const issued = !!p && isIssued(p);
    const productId = inc.productId ? String(inc.productId) : null;
    let missing: string[] = [];
    if (!issued) missing = !productId ? ['К позиции не привязано изделие'] : brief(await h.templateMissing(productId, variant));
    // выпуск требует поставщика: у черновика он есть, иначе берётся «наша фирма» — нет ни того ни другого, позиция не готова уже на плане
    if (!issued && productId && !missing.length && !p?.supplierOrgId) {
      ourSupplier ??= await h.hasOurSupplier();
      if (!ourSupplier) missing = ['Поставщик (отметьте «нашу фирму» в организациях)'];
    }
    lines.push({
      incomeId: String(inc._id), lineNo: (inc.lineNo as number) ?? null, title: String(inc.title ?? ''), productId, productName: productId ? pname.get(productId) ?? null : null, article: productId ? psku.get(productId) ?? null : null, qty: (inc.qty as number) ?? null,
      passport: p ? { id: String(p._id), number: issued ? String(p.passportNumber ?? '') : null, status: issued ? 'issued' : 'draft' } : null,
      state: issued ? 'issued' : missing.length ? 'blocked' : 'ready', missing,
    });
  }
  const count = (s: PlanLine['state']) => lines.filter((l) => l.state === s).length;
  return { orderId: String(order._id), orderNo: (order.orderNo as string) ?? null, customerName: (order.customer as string) ?? null, total: lines.length, issued: count('issued'), ready: count('ready'), blocked: count('blocked'), lines };
}

/**
 * Выпуск паспортов для готовых позиций заказа. Каждый паспорт — своя транзакция выпуска (номер из счётчика атомарно);
 * неготовые и уже выпущенные пропускаются с причиной, повтор не плодит дубли (черновик позиции переиспользуется).
 */
export async function orderIssue(h: OrderHost, orderId: string, opts: { lines?: string[]; variant?: string } = {}) {
  const plan = await orderPlan(h, orderId, opts.variant);
  const want = opts.lines?.length ? new Set(opts.lines.map(String)) : null;
  const issued: Array<{ incomeId: string; passportId: string }> = [];
  const skipped: SkipLine[] = [];
  for (const l of plan.lines) {
    if (want && !want.has(l.incomeId)) continue;
    const skip = (reason: string) => skipped.push({ incomeId: l.incomeId, title: l.title, reason });
    if (l.state === 'issued') { skip(`Паспорт № ${l.passport?.number} уже выпущен`); continue; }
    if (l.state === 'blocked') { skip(`Не готово: ${l.missing.join(', ')}`); continue; }
    const fresh = !l.passport;
    const id = l.passport ? l.passport.id : (await h.createDraft(l.incomeId, l.title)).id;
    try { await h.issue(id); issued.push({ incomeId: l.incomeId, passportId: id }); }
    catch (e) {
      if (fresh) await h.discard(id).catch(() => undefined); // свой черновик, который не выпустился, не оставляем
      skip(`Не выпущен: ${(e as { response?: { message?: string } }).response?.message ?? (e as Error).message}`);
    }
  }
  if (want) for (const id of want) if (!plan.lines.some((l) => l.incomeId === id)) skipped.push({ incomeId: id, title: '', reason: 'Позиции нет в этом заказе' });
  return { orderId: plan.orderId, issued, skipped, counts: { issued: issued.length, skipped: skipped.length } };
}
