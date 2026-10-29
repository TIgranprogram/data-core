import type { Connection, Types } from 'mongoose';
import { loadPhotos } from '../../common/photos';
import { loadSeq } from '../../common/text/production-seq';
import { orderDeadline, personView } from '../design/design-present';
import { shortProductName } from '../showcase/order-product-name';
import type { WorkStep } from './work-task.schema';

type Doc = Record<string, unknown>;
type Oid = Types.ObjectId;
const uniq = (vals: unknown[]) => [...new Map((vals.filter(Boolean) as Oid[]).map((v) => [String(v), v])).values()];

/** Шаги маршрута для карточки: сделан / идёт сейчас / впереди. */
export function presentRoute(route: WorkStep[], stepIndex: number | null) {
  return route.map((s, i) => ({
    index: i, workTypeId: s.workTypeId ? String(s.workTypeId) : null, name: s.name, lineId: s.lineId ? String(s.lineId) : null, note: s.note ?? null,
    state: stepIndex !== null && i < stepIndex ? 'done' : stepIndex === i ? 'current' : 'next',
  }));
}

/**
 * Выдача заданий пакетом (по одному `$in` на заказы, позиции, изделия, сотрудников). Цен и сумм нет.
 * Срок и приоритет берутся из заказа при выдаче, в задание не копируются.
 */
export async function presentWork(connection: Connection, docs: Doc[]) {
  if (!docs.length) return [];
  const db = connection.db!;
  const orderIds = uniq(docs.map((d) => d.orderId)), incomeIds = uniq(docs.map((d) => d.incomeId)), personIds = uniq(docs.map((d) => d.assigneeId)), productIds = uniq(docs.map((d) => d.productId));
  const [orders, incomes, persons, products, seqOf] = await Promise.all([
    orderIds.length ? db.collection('salesorders').find({ _id: { $in: orderIds } }, { projection: { orderNo: 1, productionNo: 1, productionDeadline: 1, shipDate: 1, priority: 1, customer: 1 } }).toArray() : [],
    incomeIds.length ? db.collection('incomes').find({ _id: { $in: incomeIds } }, { projection: { lineNo: 1, title: 1, qty: 1, unit: 1 } }).toArray() : [],
    personIds.length ? db.collection('persons').find({ _id: { $in: personIds } }, { projection: { lastName: 1, firstName: 1 } }).toArray() : [],
    productIds.length ? db.collection('products').find({ _id: { $in: productIds } }, { projection: { name: 1, sku: 1, photoIds: 1 } }).toArray() : [],
    loadSeq(db, orderIds),
  ]);
  const order = new Map(orders.map((o) => [String(o._id), o as Doc]));
  const income = new Map(incomes.map((i) => [String(i._id), i as Doc]));
  const person = new Map(persons.map((p) => [String(p._id), personView(p as Doc)]));
  const product = new Map(products.map((p) => [String(p._id), p as Doc]));
  const firstPhoto = (p?: Doc) => ((p?.photoIds as Oid[] | undefined) ?? [])[0];
  const photos = await loadPhotos(db, uniq(products.map(firstPhoto)));

  return docs.map((d) => {
    const o = d.orderId ? order.get(String(d.orderId)) : undefined;
    const inc = d.incomeId ? income.get(String(d.incomeId)) : undefined;
    const prod = d.productId ? product.get(String(d.productId)) : undefined;
    const sku = (prod?.sku as string | undefined) ?? null, productName = (prod?.name as string | undefined) ?? null;
    const productionNo = (o?.productionNo as string | undefined) || null, lineNo = (inc?.lineNo as number | undefined) ?? null;
    const seqNo = seqOf.get(String(d.incomeId))?.seqNo ?? null, posNo = seqNo ?? lineNo;
    const customerTitle = (inc?.title as string | undefined) ?? null;
    // «<артикул> № <заказ> поз <№>»; без изделия — короткое название заказчика
    const title = prod
      ? [sku ?? productName, productionNo ? `№ ${productionNo}` : '', posNo != null ? `поз ${posNo}` : ''].filter(Boolean).join(' ')
      : customerTitle ? shortProductName(customerTitle) : 'Без названия';
    const route = (d.route as WorkStep[] | undefined) ?? [];
    const stepIndex = (d.stepIndex as number | null | undefined) ?? null;
    const photoId = firstPhoto(prod);
    return {
      id: String(d._id), code: `W-${d.seq as number}`, seq: d.seq as number, status: d.status as string, title,
      photo: photoId ? photos.get(String(photoId))?.thumb ?? null : null,
      generic: !!d.generic, stepIndex, stepKey: (d.stepKey as string | undefined) ?? '',
      currentStep: stepIndex !== null && stepIndex < route.length ? route[stepIndex].name : null,
      route: presentRoute(route, stepIndex),
      orderId: d.orderId ? String(d.orderId) : null, orderNo: (o?.orderNo as string | undefined) ?? null, productionNo, customer: (o?.customer as string | undefined) ?? null,
      incomeId: String(d.incomeId), lineNo, seqNo, qty: (inc?.qty as number | undefined) ?? null, unit: (inc?.unit as string | undefined) ?? null,
      productId: d.productId ? String(d.productId) : null, sku, productName, customerTitle,
      deadline: orderDeadline(o), priority: (o?.priority as string | undefined) ?? 'normal',
      assigneeId: d.assigneeId ? String(d.assigneeId) : null, assignee: d.assigneeId ? person.get(String(d.assigneeId)) ?? null : null,
      note: (d.note as string | undefined) ?? null, cancelReason: (d.cancelReason as string | undefined) ?? null,
      startedAt: (d.startedAt as Date | undefined) ?? null, completedAt: (d.completedAt as Date | undefined) ?? null,
      createdAt: (d.createdAt as Date | undefined) ?? null, deletedAt: (d.deletedAt as Date | undefined) ?? null,
    };
  });
}
