import { Types, type Connection } from 'mongoose';

/**
 * «Можно ли отгрузить позицию» — подсказка для экрана; сервер отгрузку не блокирует (решение 2026-10-30).
 * Изготавливаемая позиция: есть задание «В работе» и оно не done → нельзя; задания нет (старые заказы) → можно.
 * «Со склада»: есть брони по изделию и хоть одна ещё не выдана → нельзя.
 */
export interface ShipTask { id: string; seq: number; status: string; currentStep: string | null }
export interface ShipPassport { id: string; status: string }
export interface ShipLineIn { id: string; productId?: string | null }
export interface ShipFacts { task?: ShipTask | null; reservations?: { active: number; total: number }; passport?: ShipPassport | null }
export interface ShipReady {
  canShip: boolean; kind: 'make' | 'stock' | 'other'; missing: string[]; links: Array<{ label: string; href: string }>;
  passport: ShipPassport | null; work: { id: string; code: string; status: string; currentStep: string | null } | null;
}

/** Готовность одной позиции (чистая функция). */
export function shipReadiness(line: ShipLineIn, orderId: string, f: ShipFacts): ShipReady {
  const missing: string[] = [];
  const links: Array<{ label: string; href: string }> = [];
  const task = f.task ?? null;
  const work = task ? { id: task.id, code: `W-${task.seq}`, status: task.status, currentStep: task.currentStep } : null;
  const res = f.reservations ?? { active: 0, total: 0 };
  let kind: ShipReady['kind'] = 'other';
  if (task) {
    kind = 'make';
    if (task.status !== 'done') {
      missing.push(`Ещё в работе: ${task.currentStep || (task.status === 'waiting' ? 'ждёт запуска' : 'изготовление')}`);
      links.push({ label: `Открыть ${work!.code}`, href: `#work?open=${task.id}` });
    }
  } else if (res.total > 0) {
    kind = 'stock';
    if (res.active > 0) {
      missing.push('Бронь не выдана со склада');
      links.push({ label: 'Открыть заказ', href: `#salesorders?open=${orderId}` });
    }
  } else if (line.productId) kind = 'make'; // изделие без задания — старый заказ, ведётся без «В работе»
  return { canShip: missing.length === 0, kind, missing, links, passport: f.passport ?? null, work };
}

type Db = NonNullable<Connection['db']>;
const oids = (ids: string[]) => ids.filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));

/** Факты по позициям заказа тремя запросами (без N+1). */
export async function loadShipFacts(db: Db, orderId: Types.ObjectId, lines: ShipLineIn[]): Promise<Map<string, ShipFacts>> {
  const out = new Map<string, ShipFacts>(lines.map((l) => [l.id, {}]));
  const ids = oids(lines.map((l) => l.id));
  if (!ids.length) return out;
  const [tasks, resv, pass] = await Promise.all([
    db.collection('worktasks').find({ incomeId: { $in: ids }, deletedAt: null, status: { $ne: 'cancelled' } }, { projection: { incomeId: 1, seq: 1, status: 1, route: 1, stepIndex: 1, createdAt: 1 } }).sort({ createdAt: 1 }).toArray(),
    db.collection('reservations').aggregate([
      { $match: { salesOrderId: orderId, deletedAt: null, productId: { $ne: null }, status: { $in: ['active', 'fulfilled'] } } },
      { $group: { _id: '$productId', total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } } } },
    ]).toArray(),
    db.collection('productpassports').find({ incomeId: { $in: ids }, deletedAt: null, status: { $ne: 'annulled' } }, { projection: { incomeId: 1, status: 1 } }).toArray(),
  ]);
  for (const t of tasks) { // последнее по времени перекрывает
    const f = out.get(String(t.incomeId)); if (!f) continue;
    const route = (t.route as Array<{ name: string }> | undefined) ?? [];
    const si = (t.stepIndex as number | null | undefined) ?? null;
    f.task = { id: String(t._id), seq: t.seq as number, status: t.status as string, currentStep: si !== null && si < route.length ? route[si].name : null };
  }
  const byProduct = new Map(resv.map((r) => [String(r._id), { active: r.active as number, total: r.total as number }]));
  for (const l of lines) if (l.productId) { const r = byProduct.get(l.productId); if (r) out.get(l.id)!.reservations = r; }
  for (const p of pass) { const f = out.get(String(p.incomeId)); if (f) f.passport = { id: String(p._id), status: (p.status as string) ?? 'draft' }; }
  return out;
}
