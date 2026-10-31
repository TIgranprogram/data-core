import type { Connection, Types } from 'mongoose';

type Db = NonNullable<Connection['db']>;
type ObjectId = Types.ObjectId;

/**
 * Готовность заказа к отгрузке — подсказка менеджеру, этап сам не меняется (решение 2026-10-28).
 * Считается из того, что уже есть: задачи проектирования, заявки снабжения, брони склада, позиции.
 */
export interface ReadinessFacts { lines: number; openDesign: number; openRequests: number; activeReservations: number; workTotal: number; openWork: number }
export interface ReadinessCheck { key: string; label: string; ok: boolean; hint: string; href: string }
export interface Readiness { ready: boolean; checks: ReadinessCheck[] }

export const EMPTY_FACTS: ReadinessFacts = { lines: 0, openDesign: 0, openRequests: 0, activeReservations: 0, workTotal: 0, openWork: 0 };

const left = (n: number, one: string, many: string) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : many}`;

/** Пункты готовности с подсказкой «что осталось»; `key` — № заказа или id договора, `firstId` — договор для ссылки. */
export function readinessChecks(f: ReadinessFacts, key: string, firstId: string): Readiness {
  const checks: ReadinessCheck[] = [
    { key: 'lines', label: 'В заказе есть позиции', ok: f.lines > 0, hint: f.lines > 0 ? '' : 'Добавьте позиции в договор', href: `#salesorders?open=${firstId}` },
    { key: 'design', label: 'Проектирование завершено', ok: f.openDesign === 0, hint: f.openDesign ? `Не закончено: ${left(f.openDesign, 'задача', 'задач')}` : '', href: `#design?q=${encodeURIComponent(key)}` },
    { key: 'requests', label: 'Все заявки получены', ok: f.openRequests === 0, hint: f.openRequests ? `Ждём: ${left(f.openRequests, 'заявка', 'заявок')}` : '', href: `#requests?q=${encodeURIComponent(key)}` },
    { key: 'issued', label: 'Материалы со склада выданы', ok: f.activeReservations === 0, hint: f.activeReservations ? `Не выдано: ${left(f.activeReservations, 'бронь', 'броней')}` : '', href: `#salesorders?open=${firstId}` },
  ];
  // «Изготовлено»: только если по заказу запускались задания «В работе»; нет заданий — пункта нет
  if (f.workTotal > 0) checks.splice(2, 0, { key: 'made', label: 'Изделия изготовлены', ok: f.openWork === 0, hint: f.openWork ? `Ещё в работе: ${left(f.openWork, 'задание', 'заданий')}` : '', href: `#work?q=${encodeURIComponent(key)}` });
  return { ready: checks.every((c) => c.ok), checks };
}

/** Предупреждения для «Готов к отгрузке», если не всё готово: подписи невыполненных пунктов с подсказкой. */
export const readinessWarnings = (r: Readiness): string[] => r.checks.filter((c) => !c.ok).map((c) => (c.hint ? `${c.label}: ${c.hint}` : c.label));

/**
 * Факты по группам договоров одним проходом (6 агрегаций на любое число заказов, без N+1).
 * `groups`: ключ заказа → id его действующих (не отменённых) договоров.
 */
export async function loadReadinessFacts(db: Db, groups: Map<string, ObjectId[]>): Promise<Map<string, ReadinessFacts>> {
  const owner = new Map<string, string>();
  for (const [k, ids] of groups) for (const id of ids) owner.set(String(id), k);
  const all = [...groups.values()].flat();
  const out = new Map<string, ReadinessFacts>([...groups.keys()].map((k) => [k, { ...EMPTY_FACTS }]));
  if (!all.length) return out;
  const count = async (coll: string, field: string, extra: Record<string, unknown>, into: keyof ReadinessFacts) => {
    const rows = await db.collection(coll).aggregate([{ $match: { [field]: { $in: all }, deletedAt: null, ...extra } }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]).toArray();
    for (const r of rows) { const f = out.get(owner.get(String(r._id)) ?? ''); if (f) f[into] += r.n as number; }
  };
  await Promise.all([
    count('incomes', 'orderId', { cancelledAt: null }, 'lines'),
    count('designtasks', 'orderId', { status: { $in: ['queue', 'work', 'paused'] } }, 'openDesign'),
    count('worktasks', 'orderId', { status: { $ne: 'cancelled' } }, 'workTotal'),
    count('worktasks', 'orderId', { status: { $in: ['waiting', 'work'] } }, 'openWork'),
    count('supplyrequests', 'salesOrderId', { status: { $nin: ['received', 'cancelled'] } }, 'openRequests'),
    count('reservations', 'salesOrderId', { status: 'active' }, 'activeReservations'),
  ]);
  return out;
}
