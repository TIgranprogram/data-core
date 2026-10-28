import type { Connection, Types } from 'mongoose';
import { shortProductName } from '../showcase/order-product-name';
import { loadPhotos } from '../../common/photos';

type Doc = Record<string, unknown>;
type Oid = Types.ObjectId;

/** Исполнитель в карточке: имя «Фамилия Имя» и инициалы для аватара. */
export function personView(p: Doc) {
  const last = String(p.lastName ?? '').trim(), first = String(p.firstName ?? '').trim();
  return { id: String(p._id), name: [last, first].filter(Boolean).join(' '), initials: [last, first].map((x) => x.charAt(0)).join('').toUpperCase() || '?' };
}

/** Срок заказа для задачи: срок изготовления, нет — отгрузка. */
export const orderDeadline = (o?: Doc) => (o?.productionDeadline as Date | undefined) ?? (o?.shipDate as Date | undefined) ?? null;

/** Уникальные ObjectId из значений (по строковому ключу). */
const uniq = (vals: unknown[]) => [...new Map((vals.filter(Boolean) as Oid[]).map((v) => [String(v), v])).values()];

/**
 * Выдача задач пакетом: заказы, позиции, изделия, фото и исполнители — по одному `$in` на всю страницу (без N+1).
 * Срок и приоритет — свои (`manual`) или из заказа (флаги `deadlineFromOrder` / `priorityFromOrder`). Цен и сумм нет.
 */
export async function presentTasks(connection: Connection, docs: Doc[]) {
  if (!docs.length) return [];
  const db = connection.db!;
  const orderIds = uniq(docs.map((d) => d.orderId)), incomeIds = uniq(docs.map((d) => d.incomeId)), personIds = uniq(docs.map((d) => d.assigneeId));
  const [orders, incomes, persons, noteRows] = await Promise.all([
    orderIds.length ? db.collection('salesorders').find({ _id: { $in: orderIds } }, { projection: { orderNo: 1, productionNo: 1, productionDeadline: 1, shipDate: 1, priority: 1 } }).toArray() : [],
    incomeIds.length ? db.collection('incomes').find({ _id: { $in: incomeIds } }, { projection: { lineNo: 1, title: 1, productId: 1, qty: 1, unit: 1 } }).toArray() : [],
    personIds.length ? db.collection('persons').find({ _id: { $in: personIds } }, { projection: { lastName: 1, firstName: 1 } }).toArray() : [],
    // счётчики обсуждения: всего записей и открытых вопросов — одним запросом на страницу
    db.collection('designnotes').aggregate([{ $match: { taskId: { $in: docs.map((d) => d._id) }, deletedAt: null } }, { $group: { _id: '$taskId', n: { $sum: 1 }, q: { $sum: { $cond: ['$needsAnswer', 1, 0] } } } }]).toArray(),
  ]);
  const notes = new Map(noteRows.map((r) => [String(r._id), r as Doc]));
  const order = new Map(orders.map((o) => [String(o._id), o as Doc]));
  const income = new Map(incomes.map((i) => [String(i._id), i as Doc]));
  const person = new Map(persons.map((p) => [String(p._id), personView(p as Doc)]));
  const productIdOf = (d: Doc) => (d.productId ?? income.get(String(d.incomeId))?.productId) as Oid | undefined;
  const productIds = uniq(docs.map(productIdOf));
  const products = productIds.length ? await db.collection('products').find({ _id: { $in: productIds } }, { projection: { name: 1, sku: 1, photoIds: 1 } }).toArray() : [];
  const product = new Map(products.map((p) => [String(p._id), p as Doc]));
  const firstPhoto = (p?: Doc) => ((p?.photoIds as Oid[] | undefined) ?? [])[0];
  // фото задач и изделий — один find на всю выдачу
  const photos = await loadPhotos(db, uniq([...products.map(firstPhoto), ...docs.flatMap((d) => (d.photoIds as Oid[] | undefined) ?? [])]));

  return docs.map((d) => {
    const o = d.orderId ? order.get(String(d.orderId)) : undefined;
    const inc = d.incomeId ? income.get(String(d.incomeId)) : undefined;
    const pid = productIdOf(d);
    const prod = pid ? product.get(String(pid)) : undefined;
    const manual = (d.manual as { deadline?: Date; priority?: string } | undefined) ?? {};
    const sku = (prod?.sku as string | undefined) ?? null, productName = (prod?.name as string | undefined) ?? null;
    const orderNo = (o?.orderNo as string | undefined) ?? null, lineNo = (inc?.lineNo as number | undefined) ?? null;
    const productionNo = (o?.productionNo as string | undefined) || null;
    const customerTitle = (inc?.title as string | undefined) ?? null;
    // «Чертежи <артикул> ЗНП <№ заказа> поз <№>»; без изделия — короткое название заказчика
    const auto = prod
      ? ['Чертежи', sku ?? productName, productionNo ? `ЗНП ${productionNo}` : '', lineNo != null ? `поз ${lineNo}` : ''].filter(Boolean).join(' ')
      : customerTitle ? shortProductName(customerTitle) : '';
    const photoId = firstPhoto(prod);
    const own = ((d.photoIds as Oid[] | undefined) ?? []).map((x) => photos.get(String(x))).filter((x) => !!x);
    const seq = d.seq as number;
    return {
      id: String(d._id), code: `D-${seq}`, seq, status: d.status as string,
      title: (d.title as string | undefined) || auto || 'Без названия',
      // карточка: фото задачи, иначе фото изделия позиции
      photo: own[0]?.thumb ?? (photoId ? photos.get(String(photoId))?.thumb ?? null : null),
      photoIds: own.map((x) => x!.id), photos: own,
      notesCount: (notes.get(String(d._id))?.n as number | undefined) ?? 0, openQuestions: (notes.get(String(d._id))?.q as number | undefined) ?? 0,
      stickers: (d.stickers as Record<string, unknown> | undefined) ?? {},
      orderId: d.orderId ? String(d.orderId) : null, orderNo, productionNo, incomeId: d.incomeId ? String(d.incomeId) : null, lineNo,
      qty: (inc?.qty as number | undefined) ?? null, unit: (inc?.unit as string | undefined) ?? null, spec: (d.spec as Doc | undefined) ?? null,
      productId: pid ? String(pid) : null, sku, productName, customerTitle,
      deadline: manual.deadline ?? orderDeadline(o), deadlineFromOrder: !manual.deadline && !!orderDeadline(o),
      priority: manual.priority ?? (o?.priority as string | undefined) ?? 'normal', priorityFromOrder: !manual.priority && !!o?.priority,
      assigneeId: d.assigneeId ? String(d.assigneeId) : null, assignee: d.assigneeId ? person.get(String(d.assigneeId)) ?? null : null,
      pauseReason: (d.pauseReason as string | undefined) ?? null, note: (d.note as string | undefined) ?? null,
      completedAt: (d.completedAt as Date | undefined) ?? null, createdAt: (d.createdAt as Date | undefined) ?? null,
      deletedAt: (d.deletedAt as Date | undefined) ?? null,
    };
  });
}
