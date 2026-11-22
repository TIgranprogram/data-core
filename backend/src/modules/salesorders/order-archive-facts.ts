import { type ClientSession, type mongo } from 'mongoose';
import { remaining } from '../../common/text/shipment-calc';
import { isIssued, readinessOf } from '../product-passport/passport-consts';
import { incomeDerived, incomePayments } from '../incomes/income.schema';
import type { ArchiveBundle } from './order-archive.schema';

type Row = mongo.Document;
export type Blocker = { code: string; message: string; incomeId?: string };
const id = (v: unknown) => String(v ?? '');
const same = (a: unknown, b: unknown) => !!a && !!b && id(a) === id(b);
const date = (v: unknown) => v instanceof Date && Number.isFinite(+v) && +v <= Date.now();
const cents = (v: number) => Math.round(v * 100);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export async function archiveFacts(db: mongo.Db, order: Row, session?: ClientSession) {
  const find = (name: string, filter: Row, projection?: Row) => db.collection(name)
    .find({ deletedAt: null, ...filter }, { session, projection }).sort({ _id: 1 }).toArray();
  const orderId = order._id;
  const lines = await find('incomes', { orderId });
  const incomeIds = lines.map(x => x._id);
  const byLine = { incomeId: { $in: incomeIds } };
  const byTask = { $or: [{ orderId }, byLine] };
  const shipments = await find('shipments', { $or: [{ orderId }, { 'lines.incomeId': { $in: incomeIds } }] });
  const work = await find('worktasks', byTask);
  const design = await find('designtasks', byTask);
  const plans = await find('orderlineplans', byLine);
  const passports = await find('productpassports', { $or: [{ salesOrderId: orderId }, byLine] });
  const selected = lines.map(l => l.passportSelection?.attachmentId).filter(Boolean);
  const products = await find('products', { _id: { $in: lines.map(l => l.productId).filter(Boolean) } }, { name: 1, sku: 1 });
  const attachments = await find('productattachments', { $or: [byLine, { _id: { $in: selected } }] });
  const orgIds = [order.companyId, order.counterpartyId, ...passports.flatMap(p => [p.supplierOrgId, p.manufacturerOrgId, p.customerOrgId])].filter(Boolean);
  const organizations = await find('organizations', { $or: [{ _id: { $in: orgIds } }, ...(order.customer ? [{ name: order.customer }] : [])] },
    { name: 1, fullName: 1, inn: 1, kpp: 1, ogrn: 1, legalAddress: 1, address: 1, phone: 1, email: 1, bankName: 1, bankBik: 1, bankAccount: 1, bankCorrAccount: 1, signerName: 1, signerPosition: 1, ogrnip: 1, shortName: 1 });
  const linked = { $or: [{ salesOrderId: orderId }, { salesOrderLineId: { $in: incomeIds } }] };
  const movements = await find('stockmovements', linked);
  const returns = await find('stockmovements', { cancelOf: { $in: movements.map(m => m._id) } });
  const stockMovements = [...new Map([...movements, ...returns].map(m => [String(m._id), m])).values()];
  const requests = await find('supplyrequests', linked, { status: 1, salesOrderId: 1, salesOrderLineId: 1 });
  const reservations = await find('reservations', linked, { status: 1, qty: 1, issuedQty: 1, salesOrderId: 1, salesOrderLineId: 1 });
  return { order, lines, products, shipments, passports, work, design, plans, organizations, attachments, stockMovements, requests, reservations, files: [] } satisfies ArchiveBundle & Record<string, unknown>;
}
export type Facts = Awaited<ReturnType<typeof archiveFacts>>;

export function blockers(f: Facts, evidenceUid?: string, preview = false): Blocker[] {
  const errors: Blocker[] = [];
  const add = (code: string, message: string, line?: Row) => errors.push({ code, message, ...(line ? { incomeId: id(line._id) } : {}) });
  const { order } = f, legal = order.legal;
  const active = f.lines.filter(l => !l.cancelledAt);
  if (order.stage === 'cancelled' || order.cancelledAt) add('ORDER_CANCELLED', 'Договор отменён');
  if (!active.length) add('EMPTY_ORDER', 'У договора нет действующих позиций');
  if (legal?.currency !== 'RUB' || [...(legal.documents ?? []), ...(legal.paymentPlan ?? [])].some(d => d.currency && d.currency !== 'RUB'))
    add('CURRENCY_UNKNOWN', 'Валюта договора и платежей должна быть подтверждена в рублях');
  if (legal?.issues?.some((x: Row) => ['unknown', 'conflict'].includes(x.state))) add('LEGAL_CONFLICT', 'Остались неразрешённые вопросы по договору');
  const docs: Row[] = legal?.documents ?? [];
  if (legal?.state !== 'verified' || !docs.length)
    add('DOCUMENTS_UNVERIFIED', 'Для фиксации нужны проверенные реквизиты и оригиналы документов договора');
  if (legal?.gross != null && (!positive(legal.gross) || cents(legal.gross) !== active.reduce((sum, l) => sum + cents(l.amount), 0)))
    add('LEGAL_AMOUNT_CONFLICT', 'Сумма действующих позиций не совпадает с проверенной суммой договора');
  const accepted = (d: Row) => d.kind === 'acceptance' && d.fileId && /^[a-f0-9]{64}$/.test(d.sourceSha256 ?? '')
    && /^\d{4}-\d{2}-\d{2}$/.test(d.date ?? '') && date(new Date(d.date)) && !docs.some(newer => newer.supersedesUid === d.uid);
  const evidence = docs.find(d => (preview || d.uid === evidenceUid) && accepted(d));
  if (evidenceUid && !evidence) add('ACCEPTANCE_MISSING', 'Выбранный акт непригоден для подтверждения исполнения');
  if (/(монтаж|установк|пусконалад)/i.test(String(legal?.deliveryTerms ?? '')) && !evidence)
    add('ACCEPTANCE_MISSING', 'Условия поставки предусматривают монтаж или установку. Нужен датированный акт исполнения');
  const plans: Row[] = legal?.paymentPlan ?? [];
  for (const p of plans.filter(s => ['installation_completed', 'acceptance'].includes(s.event))) {
    if (!p.eventDate || !date(new Date(p.eventDate)) || !docs.some(d => d.uid === p.evidenceDocumentUid && accepted(d)))
      add('ACCEPTANCE_MISSING', 'Для монтажа или приёмки в договоре укажите факт и подтверждающий акт');
  }
  const known = new Set(f.lines.map(l => id(l._id)));
  const activeIds = new Set(active.map(l => id(l._id)));
  const sequences = new Set<number>();
  const paymentIds = new Set<string>();
  const ships: Array<{ lines: Array<{ incomeId: string; qty: number }> }> = [];
  for (const s of f.shipments) {
    if (!same(s.orderId, order._id) || !date(s.date) || !Number.isSafeInteger(s.seq) || s.seq < 1 || sequences.has(s.seq) || !s.number
      || !Array.isArray(s.lines) || !s.lines.length || new Set(s.lines.map((l: Row) => id(l?.incomeId))).size !== s.lines.length || s.lines.some((l: Row) => !activeIds.has(id(l?.incomeId)) || !positive(l?.qty))) {
      add('SHIPMENT_CONFLICT', 'Отгрузка содержит чужую позицию или недостоверные дату и количество');
    } else ships.push({ lines: s.lines.map((l: Row) => ({ incomeId: id(l.incomeId), qty: l.qty })) });
    sequences.add(s.seq);
  }
  const shipped = new Map(remaining(active.map(l => ({ id: id(l._id), qty: l.qty })), ships).map(x => [x.incomeId, x]));
  for (const l of active) {
    if (l.currency && l.currency !== 'RUB') add('CURRENCY_UNKNOWN', 'Валюта позиции не согласована с платежами', l);
    const { amount } = incomeDerived({ amountManual: l.amountManual, qty: l.qty, unitPrice: l.unitPrice });
    const cost = cents(amount);
    if (!positive(amount) || cost <= 0 || !Number.isSafeInteger(cost) || !positive(l.amount) || cents(l.amount) !== cost)
      add('PRICE_UNKNOWN', 'Уточните стоимость позиции и её соответствие исходным данным', l);
    if (l.payments != null && (!Array.isArray(l.payments) || l.payments.some((p: unknown) => !p || typeof p !== 'object'))) {
      add('PAYMENT_INCOMPLETE', 'Платёжные события позиции повреждены', l);
      continue;
    }
    const events = incomePayments({ amount: l.amount, paidDate: l.paidDate, payments: l.payments, legacyPaymentMetadata: l.legacyPaymentMetadata });
    const paid = events.reduce((sum, p) => sum + cents(p.amount), 0);
    const repeated = events.some(p => {
      if (!p.paymentId) return false;
      if (paymentIds.has(p.paymentId)) return true;
      paymentIds.add(p.paymentId);
      return false;
    });
    if (repeated || !Number.isSafeInteger(paid) || events.some(p => !date(p.date) || !positive(p.amount) || !Number.isSafeInteger(cents(p.amount)))
        || l.payments?.some((p: Row) => p.currency && p.currency !== 'RUB')
        || !events.length || paid < cost)
      add('PAYMENT_INCOMPLETE', 'Оплата позиции не подтверждена полностью', l);
    if (l.paidAmount != null && (!Number.isFinite(l.paidAmount) || cents(l.paidAmount) !== paid))
      add('PAYMENT_CACHE_CONFLICT', 'Учтённая сумма оплаты расходится с платежами по позиции', l);
    const service = l.lineType === 'service' && !!l.serviceId && !l.productId;
    const physical = !!l.productId && (!l.lineType || ['product', 'new_product'].includes(l.lineType)) && !l.serviceId;
    if (!service && !physical) { add('LINE_TYPE_UNKNOWN', 'Уточните изделие или услугу позиции', l); continue; }
    if ((service || !f.work.some(t => same(t.incomeId, l._id) && t.status === 'done')) && (!evidence || (evidence.lineRefs?.length && !evidence.lineRefs.includes(l.sourceLine?.rowKey))))
      add('ACCEPTANCE_MISSING', 'Выберите датированный акт из документов договора, подтверждающий исполнение позиции', l);
    if (!physical) continue;
    if (!f.products.some(p => same(p._id, l.productId))) add('PRODUCT_MISSING', 'Изделие позиции удалено или не найдено', l);
    const row = shipped.get(id(l._id));
    if (!positive(l.qty) || !row || row.left > 0 || !row.shipped || !Number.isFinite(row.shipped) || row.shipped > Math.round(l.qty * 1000) / 1000) add('SHIPMENT_INCOMPLETE', 'Позиция отгружена не полностью', l);
    const ps = f.passports.filter(p => same(p.incomeId, l._id) && p.status !== 'annulled');
    const sel = l.passportSelection;
    if (sel?.mode === 'attachment') {
      const a = f.attachments.find(x => same(x._id, sel.attachmentId));
      if (ps.length || !a || a.ext !== 'pdf' || a.fileRemovedAt || a.purgeState === 'purging' || !same(a.productId, l.productId)
        || (a.incomeId && !same(a.incomeId, l._id)) || !same(sel.productIdAtSelection, l.productId) || !sel.confirmedAt || sel.invalidatedAt || sel.invalidReason
        || Number(a.selectionGeneration ?? 0) !== sel.attachmentGeneration) add('PASSPORT_SOURCE_INVALID', 'Выбранный файл паспорта недоступен или выбор изменился', l);
    } else if (ps.length !== 1 || !isIssued({ status: ps[0].status, passportNumber: ps[0].passportNumber }) || readinessOf({ status: ps[0].status, passportNumber: ps[0].passportNumber, readiness: ps[0].readiness }) !== 'ready' || !same(ps[0].productId, l.productId)
      || (!ps[0].printFile?.path && (ps[0].presentationVersion !== 1 || !ps[0].printSnapshot || !ps[0].textSnapshot)))
      add('PASSPORT_SOURCE_INVALID', 'Нужен один готовый выпущенный паспорт с источниками печати или подтверждённое вложение', l);
  }
  if (f.passports.some(p => (p.salesOrderId && !same(p.salesOrderId, order._id)) || (p.incomeId && !known.has(id(p.incomeId)))))
    add('PASSPORT_CONFLICT', 'Паспорт ссылается на позицию другого договора');
  const wholeDone = new Set(f.work.filter(t => t.status === 'done' && !t.moduleWork).map(t => id(t.incomeId)));
  const released = f.work.filter(t => t.moduleWork && t.status !== 'cancelled');
  const doneModules = new Set(released.filter(t => t.status === 'done').map(t => [id(t.incomeId), id(t.moduleWork.lineId)].join(':')));
  const planOpen = f.plans.some(p => {
    if (!p.launchedAt) return false;
    const partLines = new Map(((p.parts ?? []) as Row[]).map(part => [id(part._id), part.lineId]));
    return p.steps?.some((step: Row) =>
      !step.finishedAt && !doneModules.has([id(p.incomeId), id(step.lineId ?? partLines.get(id(step.partRowId)))].join(':')),
    );
  });
  if ([...f.design, ...f.work].some(t => !['done', 'cancelled'].includes(t.status)) || planOpen
      || released.some(t => !wholeDone.has(id(t.incomeId))))
    add('WORK_OPEN', 'Есть незавершённые работы по договору');
  if (f.requests.some(r => !['received', 'cancelled'].includes(r.status)) || f.reservations.some(r => r.status === 'active'))
    add('SUPPLY_OPEN', 'Остались открытые заявки снабжения или складские брони');
  return errors;
}
