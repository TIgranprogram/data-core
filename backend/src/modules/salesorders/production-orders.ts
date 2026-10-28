import { ORDER_STAGES, normTitle, type OrderPriority, type OrderStage } from '../../common/text/order-key';

/**
 * «Заказ производства» = все договоры (salesorders) с одним `productionNo`; договор без № — отдельный заказ.
 * Чистые функции: ключ, срок, этап, срочность, «К производству», сортировка по № заказа.
 * Сквозная нумерация позиций — `common/text/production-seq.ts`.
 */
type Doc = Record<string, unknown>;
const RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Ключ заказа: `productionNo`, нет — id договора. */
export const groupKey = (o: Doc): string => String(o.productionNo ?? '').trim() || String(o._id);

/** Срок договора: отгрузка, иначе изготовление, иначе окончание поставки. */
export const orderDeadline = (o: Doc): Date | null => (o.shipDate ?? o.productionDeadline ?? o.deliveryDeadline ?? null) as Date | null;

const ts = (d: unknown) => new Date(d as Date).getTime();

/** Срок заказа (самый ранний), этап (самый отстающий; отменённые не считаются, если есть живые), «разные этапы», срочность. */
export function summarize(orders: Doc[]): { deadline: Date | null; stage: OrderStage; stagesDiffer: boolean; priority: OrderPriority } {
  const dls = orders.map(orderDeadline).filter(Boolean) as Date[];
  const deadline = dls.length ? dls.reduce((a, b) => (ts(b) < ts(a) ? b : a)) : null;
  const stages = orders.map((o) => ((o.stage as OrderStage) || 'new'));
  const live = stages.filter((s) => s !== 'cancelled');
  const pool = live.length ? live : stages;
  const stage = pool.reduce((a, b) => (ORDER_STAGES.indexOf(b) < ORDER_STAGES.indexOf(a) ? b : a), pool[0] ?? 'new');
  const priority = orders.map((o) => ((o.priority as OrderPriority) || 'normal')).reduce((a, b) => ((RANK[b] ?? 2) < (RANK[a] ?? 2) ? b : a), 'low' as OrderPriority);
  return { deadline, stage, stagesDiffer: new Set(pool).size > 1, priority: orders.length ? priority : 'normal' };
}

export type ProduceLine = { seqNo: number; title: string; unit?: string | null; qty?: number | null; productId?: string | null; productName?: string | null };
export type ProduceRow = { key: string; productId: string | null; title: string; unit: string | null; qty: number; seqNos: number[] };

/**
 * «К производству»: одинаковые позиции суммируются. Ключ — productId, нет — название (trim, регистр, пробелы, ё=е);
 * плюс единица измерения: разные unit не складываются.
 */
export function toProduce(lines: ProduceLine[]): ProduceRow[] {
  const rows = new Map<string, ProduceRow>();
  for (const l of lines) {
    const unit = String(l.unit ?? '').trim().toLowerCase();
    const key = `${l.productId ? `p:${l.productId}` : `t:${normTitle(l.title)}`}|${unit}`;
    const r = rows.get(key) ?? { key, productId: l.productId ?? null, title: String(l.productName || l.title || '').trim(), unit: String(l.unit ?? '').trim() || null, qty: 0, seqNos: [] };
    r.qty = Math.round((r.qty + (Number(l.qty) || 0)) * 1000) / 1000;
    r.seqNos.push(l.seqNo);
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => a.seqNos[0] - b.seqNos[0]);
}

/** «21-26» → [год, N]; нет № или не «N-ГГ» → null (в конец). */
function parseNo(v: unknown): [number, number] | null {
  const m = /^(\d+)-(\d{2})$/.exec(String(v ?? '').trim());
  return m ? [Number(m[2]), Number(m[1])] : null;
}

/** Сравнение по № заказа: год, затем N числом; без № — всегда в конце (при любом направлении). dir: 1 | -1. */
export function compareProductionNo(a: unknown, b: unknown, dir: 1 | -1 = 1): number {
  const x = parseNo(a), y = parseNo(b);
  if (!x || !y) {
    if (x) return -1;
    if (y) return 1;
    const ea = !String(a ?? '').trim(), eb = !String(b ?? '').trim();
    return ea !== eb ? (ea ? 1 : -1) : String(a ?? '').localeCompare(String(b ?? '')) * dir;
  }
  return ((x[0] - y[0]) || (x[1] - y[1])) * dir;
}
