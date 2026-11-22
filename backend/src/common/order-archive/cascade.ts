import { Types, type ClientSession, type mongo } from 'mongoose';
import { claimWritableOrders } from './write';

export async function claimPassportOrders(db: mongo.Db, session: ClientSession, passports: mongo.Document[]) {
  const ids = [...new Set(passports.filter(passport => passport.incomeId).map(passport => String(passport.incomeId)))];
  const lines = ids.length ? await db.collection('incomes').find(
    { _id: { $in: ids.map(id => new Types.ObjectId(id)) } }, { session, projection: { orderId: 1 } },
  ).toArray() : [];
  if (lines.length !== ids.length) throw new Error('Связь паспорта с позицией не подтверждена. Запись остановлена.');
  await claimWritableOrders(db, session, [...passports.map(passport => passport.salesOrderId), ...lines.map(line => line.orderId)]);
}

export const ORDER_CASCADE_COLLECTIONS = new Set([
  'salesorders', 'incomes', 'productpassports', 'productattachments', 'supplyrequests',
]);

/** Справочник меняется, а его связи в архиве остаются прежними. */
export async function writableCascadeRows(
  db: mongo.Db, session: ClientSession, collection: string, filter: mongo.Filter<mongo.Document>,
) {
  const rows = await db.collection(collection).find(filter, {
    session, projection: { orderId: 1, salesOrderId: 1, incomeId: 1, salesOrderLineId: 1, archiveProtected: 1 },
  }).toArray();
  const lineId = (row: mongo.Document) => row.incomeId ?? row.salesOrderLineId;
  const ids = (values: unknown[]) => [...new Set(values.filter(id => id != null).map(String))];
  const objectIds = (values: string[]) => values.filter(id => Types.ObjectId.isValid(id)).map(id => new Types.ObjectId(id));
  const lineIds = objectIds(ids(rows.map(lineId)));
  const lines = lineIds.length ? await db.collection('incomes').find(
    { _id: { $in: lineIds } }, { session, projection: { orderId: 1 } },
  ).toArray() : [];
  const byLine = new Map(lines.map(line => [String(line._id), line]));
  const owners = (row: mongo.Document) => ids([
    collection === 'salesorders' ? row._id : collection === 'incomes' ? row.orderId : row.salesOrderId,
    byLine.get(String(lineId(row)))?.orderId,
  ]);
  const orderIds = objectIds(ids(rows.flatMap(owners)));
  const orders = orderIds.length ? await db.collection('salesorders').find(
    { _id: { $in: orderIds }, activeArchiveVersion: null }, { session, projection: { _id: 1 } },
  ).toArray() : [];
  const open = new Set(orders.map(order => String(order._id)));
  const allowed = rows.filter(row => row.archiveProtected !== true &&
    (lineId(row) == null || byLine.has(String(lineId(row)))) && owners(row).every(owner => open.has(owner)));
  await claimWritableOrders(db, session, allowed.flatMap(owners));
  return { ids: allowed.map(row => row._id), skipped: rows.length - allowed.length };
}
