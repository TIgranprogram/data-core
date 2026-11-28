import { Types, type mongo } from 'mongoose';

type LastPurchase = { date: Date; dateKind: 'order' | 'invoice'; num: number | null };
type CatalogPurchases = {
  openPurchases: { status: string; paid: boolean; qty: number; unit: string }[];
  lastPurchase: LastPurchase | null;
};

const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());

/** Только по доступным materialId. Для счёта источником даты и статуса служит
 * шапка, для старой отдельной заявки — её собственные поля. */
export async function catalogPurchases(db: mongo.Db, materials: { materialId: string; unit?: string | null }[]) {
  const result = new Map<string, CatalogPurchases>();
  if (!materials.length) return result;
  const units = new Map(materials.map((m) => [m.materialId, m.unit || '']));
  const rows = await db.collection('supplyrequests').find({
    materialId: { $in: materials.map((m) => new Types.ObjectId(m.materialId)) }, deletedAt: null,
    status: { $in: ['requested', 'in_progress', 'ordered', 'received'] },
  }, { projection: { materialId: 1, num: 1, status: 1, paid: 1, qty: 1, unit: 1, invoiceId: 1, supplierOrderDate: 1, invoiceDate: 1 } }).toArray();
  const invoiceIds = [...new Set(rows.filter((r) => r.invoiceId).map((r) => String(r.invoiceId)))].filter(Types.ObjectId.isValid);
  const headers = invoiceIds.length ? await db.collection('supplyinvoices').find({
    _id: { $in: invoiceIds.map((id) => new Types.ObjectId(id)) }, deletedAt: null,
  }, { projection: { status: 1, date: 1, 'undatedPaymentEvidence.state': 1 } }).toArray() : [];
  const invoices = new Map(headers.map((h) => [String(h._id), h]));
  for (const row of rows) {
    const id = String(row.materialId);
    const data = result.get(id) || { openPurchases: [], lastPurchase: null } as CatalogPurchases;
    const invoice = invoices.get(String(row.invoiceId));
    if (row.status !== 'received') {
      const paid = row.invoiceId ? invoice?.status === 'paid' && invoice.undatedPaymentEvidence?.state !== 'pending' : row.paid === true;
      data.openPurchases.push({ status: row.status, paid, qty: Number(row.qty) || 0, unit: row.unit || units.get(id) || '' });
    }
    // Частичная приёмка уменьшает qty. Храним дату закупки, не приписывая
    // оставшееся или принятое количество исходному заказу.
    if ((row.status === 'ordered' || row.status === 'received') && (!row.invoiceId || ['issued', 'paid'].includes(invoice?.status))) {
      const hasOrderDate = validDate(row.supplierOrderDate);
      const date = hasOrderDate ? row.supplierOrderDate : row.invoiceId ? invoice?.date : row.invoiceDate;
      const num = Number.isSafeInteger(row.num) ? row.num : null;
      const last = data.lastPurchase;
      if (validDate(date) && (!last || date > last.date || (date.getTime() === last.date.getTime() && (num ?? 0) > (last.num ?? 0)))) {
        data.lastPurchase = { date, dateKind: hasOrderDate ? 'order' : 'invoice', num };
      }
    }
    result.set(id, data);
  }
  return result;
}
