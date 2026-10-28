import { Types, type Connection } from 'mongoose';
import { dateRange } from '../../common/list-query';
import { STAGE_LABELS } from '../../common/text/order-key';
import { withChanges } from '../audit/record-history';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Db = NonNullable<Connection['db']>;

export const HISTORY_TYPES = ['change', 'line', 'design', 'passport', 'shipment', 'payment', 'stock'] as const;
export type HistoryType = (typeof HISTORY_TYPES)[number];
export interface HistoryItem { at: Date; type: HistoryType; who: string | null; title: string; text: string; link: { kind: string; id: string } | null }

/** Что видит роль: деньги и закрытые разделы (design / passports / stock) в ленту не попадают. */
export interface HistoryAccess { money: boolean; design: boolean; passports: boolean; stock: boolean }

const FIELD: Record<string, string> = {
  orderNo: '№ заказа', customer: 'Заказчик', title: 'Предмет', stage: 'Этап', priority: 'Приоритет', shipDate: 'Дата отгрузки', productionDeadline: 'Срок изготовления',
  deliveryDeadline: 'Окончание поставки', contractDate: 'Дата контракта', contractNo: '№ контракта', productionNo: '№ на производство', notes: 'Примечание',
  paymentForm: 'Форма оплаты', qty: 'Количество', unit: 'Единица', size: 'Размер', color: 'Цвет', kind: 'Вид', status: 'Статус', paidDate: 'Дата оплаты',
  amount: 'Сумма', unitPrice: 'Цена', amountManual: 'Сумма вручную',
};
const DESIGN_STATUS: Record<string, string> = { queue: 'на распределении', work: 'в работе', done: 'завершена', paused: 'приостановлена' };
const PAY: Record<string, string> = { paid: 'оплачено', awaiting: 'ждёт оплаты', noamount: 'без суммы', draft: 'черновик' };
const day = (v: unknown) => { const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10).split('-').reverse().join('.'); };
const isIso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v);
const show = (field: string, v: unknown) => {
  if (v === null || v === undefined || v === '') return 'пусто';
  if (field === 'stage') return STAGE_LABELS[String(v) as keyof typeof STAGE_LABELS] ?? String(v);
  if (field === 'status' && PAY[String(v)]) return PAY[String(v)];
  return isIso(v) ? day(v) : String(v);
};
const num = (n: unknown) => String(Math.round(Number(n) * 1000) / 1000).replace('.', ',');

/** Записи журнала одной записи → события «изменено …»; первая запись (создание) — один пункт. */
function fromAudit(logs: Doc[], canMoney: boolean, type: (field: string) => HistoryType, mk: { created: string; label: (d: Doc) => string; link: (id: string) => { kind: string; id: string } }): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const l of withChanges(logs as never[], canMoney) as Array<Doc>) {
    const at = l.createdAt as Date;
    const who = (l.userName as string | undefined) ?? null;
    const id = String(l.entityId ?? '');
    const after = ((l.details as Doc | undefined)?.after ?? {}) as Doc;
    if (String(l.action).endsWith('.deleted')) { out.push({ at, type: 'line', who, title: `${mk.label(after)} — удалено`, text: '', link: mk.link(id) }); continue; }
    if (l.first) { out.push({ at, type: 'line', who, title: `${mk.created}: ${mk.label(after)}`, text: '', link: mk.link(id) }); continue; }
    const byType = new Map<HistoryType, string[]>();
    for (const c of l.changes as Array<{ field: string; from: unknown; to: unknown }>) {
      const t = type(c.field);
      byType.set(t, [...(byType.get(t) ?? []), `${FIELD[c.field] ?? c.field}: ${show(c.field, c.from)} → ${show(c.field, c.to)}`]);
    }
    for (const [t, parts] of byType) out.push({ at, type: t, who, title: mk.label(after), text: parts.join('; '), link: mk.link(id) });
  }
  return out;
}

/**
 * Единая лента заказа (новые сверху): изменения шапки и позиций, оплата, проектирование, паспорта, отгрузки, выдачи склада.
 * Читает журнал и соседние коллекции только на чтение. Суммы и оплата — только денежным ролям, закрытые разделы — скрыты.
 */
export async function loadOrderHistory(db: Db, orderId: Types.ObjectId, q: Record<string, unknown>, acc: HistoryAccess) {
  const [incomes, ships, tasks, passports, moves] = await Promise.all([
    db.collection('incomes').find({ orderId }, { projection: { title: 1, lineNo: 1 } }).toArray(),
    db.collection('shipments').find({ orderId }).toArray(),
    acc.design ? db.collection('designtasks').find({ orderId }).toArray() : Promise.resolve([] as Doc[]),
    acc.passports ? db.collection('productpassports').find({ salesOrderId: orderId }, { projection: { name: 1, passportNumber: 1, status: 1, readiness: 1, reworkNote: 1, createdAt: 1, issuedAt: 1, updatedAt: 1 } }).toArray() : Promise.resolve([] as Doc[]),
    acc.stock ? db.collection('stockmovements').find({ salesOrderId: orderId, deletedAt: null }, { projection: { type: 1, date: 1, createdAt: 1, materialId: 1, qty: 1, isReturn: 1, issuedTo: 1, createdBy: 1, notes: 1, cancelledAt: 1 } }).toArray() : Promise.resolve([] as Doc[]),
  ]);
  const incomeIds = incomes.map((i) => i._id);
  const taskIds = tasks.map((t) => t._id);
  const [orderLogs, lineLogs, taskLogs, mats, users] = await Promise.all([
    db.collection('auditlogs').find({ entityType: 'SalesOrder', entityId: orderId }).sort({ createdAt: -1 }).limit(300).toArray(),
    incomeIds.length ? db.collection('auditlogs').find({ entityType: 'Income', entityId: { $in: incomeIds } }).sort({ createdAt: -1 }).limit(500).toArray() : Promise.resolve([] as Doc[]),
    taskIds.length ? db.collection('auditlogs').find({ entityType: 'DesignTask', entityId: { $in: taskIds } }).sort({ createdAt: -1 }).limit(300).toArray() : Promise.resolve([] as Doc[]),
    moves.length ? db.collection('materials').find({ _id: { $in: moves.map((m) => m.materialId).filter(Boolean) } }, { projection: { name: 1, unit: 1 } }).toArray() : Promise.resolve([] as Doc[]),
    db.collection('users').find({ _id: { $in: [...tasks.map((t) => t.createdBy), ...moves.map((m) => m.createdBy)].filter(Boolean) } }, { projection: { displayName: 1, username: 1 } }).toArray(),
  ]);
  const uname = new Map(users.map((u) => [String(u._id), String(u.displayName || u.username || '')]));
  const mat = new Map(mats.map((m) => [String(m._id), m]));
  const lineTitle = new Map(incomes.map((i) => [String(i._id), `${i.lineNo ? `поз. ${i.lineNo} · ` : ''}${i.title ?? ''}`]));
  const items: HistoryItem[] = [];

  items.push(...fromAudit(orderLogs, acc.money, () => 'change', { created: 'Заказ создан', label: (d) => `Заказ ${d.orderNo ?? ''}`.trim(), link: (id) => ({ kind: 'order', id }) }));
  // позиции: смена оплаты (paidDate / оплатный статус) — «Оплата», остальное — «Позиции»
  items.push(...fromAudit(lineLogs, acc.money, (f) => (f === 'paidDate' || f === 'status' ? 'payment' : 'line'), {
    created: 'Позиция добавлена', label: (d) => `${d.lineNo ? `поз. ${d.lineNo} · ` : ''}${d.title ?? ''}`, link: (id) => ({ kind: 'income', id }),
  }));
  // оплаты без денег не показываем вовсе (в журнале это было бы «статус → оплачено»)
  const visible = acc.money ? items : items.filter((i) => i.type !== 'payment');

  for (const t of tasks) {
    const link = { kind: 'designTask', id: String(t._id) };
    const what = `Задача D-${t.seq ?? ''}${t.incomeId && lineTitle.has(String(t.incomeId)) ? ` · ${lineTitle.get(String(t.incomeId))}` : ''}`;
    if (t.createdAt) visible.push({ at: t.createdAt, type: 'design', who: t.createdBy ? uname.get(String(t.createdBy)) ?? null : null, title: what, text: 'Создана задача проектирования', link });
    if (t.completedAt) visible.push({ at: t.completedAt, type: 'design', who: t.completedBy ? uname.get(String(t.completedBy)) ?? null : null, title: what, text: 'Проектирование завершено', link });
  }
  for (const l of withChanges(taskLogs as never[], false) as Array<Doc>) {
    const c = (l.changes as Array<{ field: string; from: unknown; to: unknown }>).find((x) => x.field === 'status');
    if (!c || l.first) continue;
    const task = tasks.find((t) => String(t._id) === String(l.entityId));
    visible.push({ at: l.createdAt, type: 'design', who: l.userName ?? null, title: `Задача D-${task?.seq ?? ''}`, text: `Статус: ${DESIGN_STATUS[String(c.from)] ?? c.from ?? 'пусто'} → ${DESIGN_STATUS[String(c.to)] ?? c.to}`, link: { kind: 'designTask', id: String(l.entityId) } });
  }
  for (const p of passports) {
    const link = { kind: 'passport', id: String(p._id) };
    const what = `Паспорт ${p.name ?? ''}`.trim();
    if (p.createdAt) visible.push({ at: p.createdAt, type: 'passport', who: null, title: what, text: 'Паспорт создан (черновик)', link });
    if (p.issuedAt) visible.push({ at: p.issuedAt, type: 'passport', who: null, title: what, text: `Паспорт выпущен${p.passportNumber && !String(p.passportNumber).startsWith('draft-') ? ` № ${p.passportNumber}` : ''}`, link });
    if (p.readiness === 'rework' && p.updatedAt) visible.push({ at: p.updatedAt, type: 'passport', who: null, title: what, text: `На доработку${p.reworkNote ? `: ${p.reworkNote}` : ''}`, link });
  }
  for (const s of ships) {
    const link = { kind: 'shipment', id: String(s._id) };
    const lines = ((s.lines as Doc[]) ?? []).map((l) => `${l.title} — ${num(l.qty)}${l.unit ? ' ' + l.unit : ''}`).join('; ');
    const extra = [s.reason ? `Причина: ${s.reason}` : '', s.receiver ? `Принял: ${s.receiver}` : '', s.docNo ? `Документ: ${s.docNo}` : ''].filter(Boolean).join('. ');
    visible.push({ at: s.createdAt ?? s.date, type: 'shipment', who: s.whoName ?? null, title: `Отгрузка ${s.number} от ${day(s.date)}`, text: [lines, extra].filter(Boolean).join('. '), link });
    if (s.deletedAt) visible.push({ at: s.deletedAt, type: 'shipment', who: s.deletedByName ?? null, title: `Отгрузка ${s.number}`, text: 'Отгрузка отменена', link });
  }
  for (const m of moves) {
    const x = mat.get(String(m.materialId));
    const verb = m.type === 'out' ? (m.isReturn ? 'Возврат' : 'Выдано') : m.type === 'in' ? 'Приход' : 'Движение';
    visible.push({ at: m.date ?? m.createdAt, type: 'stock', who: m.createdBy ? uname.get(String(m.createdBy)) ?? null : null, title: `${verb}: ${x?.name ?? 'материал'}`, text: `${num(m.qty)}${x?.unit ? ' ' + x.unit : ''}${m.issuedTo ? ` · кому: ${m.issuedTo}` : ''}`, link: { kind: 'stockMovement', id: String(m._id) } });
  }

  const type = String(q.type ?? '').trim();
  const range = dateRange(q.from, q.to);
  const words = String(q.search ?? '').toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  const list = visible
    .filter((i) => i.at && (!type || i.type === type)
      && (!range || ((!range.$gte || i.at >= range.$gte) && (!range.$lt || i.at < range.$lt)))
      && (!words.length || words.every((w) => `${i.title} ${i.text}`.toLowerCase().replace(/ё/g, 'е').includes(w))))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, Math.min(1000, Math.max(1, Math.floor(Number(q.limit) || 300))));
  return { items: list, total: list.length };
}
