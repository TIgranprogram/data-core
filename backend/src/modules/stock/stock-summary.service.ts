import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { oid } from '../../common/list-query';
import type { StockScope } from '../../common/stock-scope';
import { StockCoreService } from './stock-core.service';
import { freeQty } from './stock-rank';
import {
  buildMonthly, buildPrices, buildSuppliers, requestDateOf, requestLabel, topCustomers,
  type CustomerFact, type OfferRow, type OutRow, type RequestRow,
} from './stock-summary';

const OPEN = ['in_progress', 'requested', 'ordered'];
const LIST = 20; // сколько последних заявок и выдач показываем
const YEAR_MS = 366 * 24 * 3600 * 1000;

/** Паспорт позиции одним запросом (`GET /materials/:id/summary`): где лежит, поставщики, цены, заявки, выдачи, аналитика. Только чтение. */
@Injectable()
export class StockSummaryService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly core: StockCoreService,
  ) {}

  async summary(materialId: string, canMoney: boolean, scope?: StockScope | null, now = new Date()) {
    await this.core.assertMaterials([materialId], scope);
    const id = oid(materialId, 'позиции');
    const db = this.connection.db!;
    const mat = await db.collection('materials').findOne({ _id: id, deletedAt: null }, { projection: { name: 1, article: 1, unit: 1, categoryId: 1 } });
    if (!mat) throw new NotFoundException('Позиция не найдена');
    const since = new Date(now.getTime() - YEAR_MS);
    const reqProj = { num: 1, qty: 1, status: 1, paid: 1, priceHint: 1, supplierId: 1, receivedAt: 1, invoiceDate: 1, requestDate: 1, createdAt: 1 };

    // независимые чтения — разом; всё с ограничением по materialId (индексы materialId есть у заявок, движений, остатков, предложений)
    const [cat, stocks, got, latest, year, total, open, offers, outsAll, outTotal, reserved, products, modules] = await Promise.all([
      mat.categoryId ? db.collection('categories').findOne({ _id: mat.categoryId }, { projection: { name: 1 } }) : Promise.resolve(null),
      db.collection('storageitems').find({ materialId: id, deletedAt: null }, { projection: { warehouseId: 1, zoneName: 1, quantity: 1, reservedQty: 1 } }).toArray(),
      db.collection('supplyrequests').find({ deletedAt: null, status: 'received', materialId: id }, { projection: reqProj }).sort({ receivedAt: -1, invoiceDate: -1 }).limit(200).toArray(),
      db.collection('supplyrequests').find({ deletedAt: null, materialId: id }, { projection: reqProj }).sort({ createdAt: -1 }).limit(LIST).toArray(),
      db.collection('supplyrequests').find({ deletedAt: null, materialId: id, createdAt: { $gte: since } }, { projection: reqProj }).limit(2000).toArray(),
      db.collection('supplyrequests').countDocuments({ deletedAt: null, materialId: id }),
      db.collection('supplyrequests').countDocuments({ deletedAt: null, materialId: id, status: { $in: OPEN } }),
      db.collection('supplieritems').find({ deletedAt: null, materialId: id }, { projection: { supplierId: 1, priceHint: 1, priceDate: 1, priceHistory: 1 } }).limit(200).toArray(),
      // выдачи: расход, не отменённый; отмена — обратное движение прихода, оно сюда не попадает
      db.collection('stockmovements').find({ deletedAt: null, materialId: id, type: 'out', cancelledAt: null }, { projection: { date: 1, qty: 1, salesOrderId: 1, salesOrderLineId: 1 } }).sort({ date: -1 }).limit(1000).toArray(),
      db.collection('stockmovements').aggregate([{ $match: { deletedAt: null, materialId: id, type: 'out', cancelledAt: null } }, { $group: { _id: null, qty: { $sum: '$qty' } } }]).toArray(),
      db.collection('reservations').find({ deletedAt: null, materialId: id, status: 'active', salesOrderId: { $type: 'objectId' } }, { projection: { salesOrderId: 1, qty: 1 } }).limit(500).toArray(),
      db.collection('products').countDocuments({ deletedAt: null, composition: { $elemMatch: { lineType: 'material', refId: id } } }),
      db.collection('productmodules').countDocuments({ deletedAt: null, composition: { $elemMatch: { lineType: 'material', refId: id } } }),
    ]);

    // названия: склады, поставщики, заказы и позиции заказов — по одному чтению
    const outs = outsAll as unknown as (OutRow & { _id: Types.ObjectId })[];
    const shownOuts = outs.slice(0, LIST);
    const orgIds = uniq([...got.map((g) => g.supplierId), ...latest.map((r) => r.supplierId), ...offers.map((o) => o.supplierId)]);
    const orderIds = uniq([...outs.map((o) => o.salesOrderId), ...reserved.map((r) => r.salesOrderId)]);
    const lineIds = uniq(shownOuts.map((o) => o.salesOrderLineId));
    const [whs, orgs, orders, lines] = await Promise.all([
      stocks.length ? db.collection('warehouses').find({ _id: { $in: uniq(stocks.map((s) => s.warehouseId)) } }, { projection: { name: 1 } }).toArray() : [],
      orgIds.length ? db.collection('organizations').find({ _id: { $in: orgIds } }, { projection: { name: 1, shortName: 1 } }).toArray() : [],
      orderIds.length ? db.collection('salesorders').find({ _id: { $in: orderIds } }, { projection: { orderNo: 1, customer: 1 } }).toArray() : [],
      lineIds.length ? db.collection('incomes').find({ _id: { $in: lineIds } }, { projection: { title: 1 } }).toArray() : [],
    ]);
    const whName = new Map(whs.map((w) => [String(w._id), String(w.name ?? '')]));
    const supName = new Map(orgs.map((o) => [String(o._id), String(o.shortName || o.name)]));
    const nameOf = (i: Types.ObjectId) => supName.get(String(i));
    const orderOf = new Map(orders.map((o) => [String(o._id), o]));
    const lineTitle = new Map(lines.map((l) => [String(l._id), String(l.title ?? '')]));
    const customerOf = (oidv?: Types.ObjectId | null) => {
      const o = oidv ? orderOf.get(String(oidv)) : undefined;
      return o ? String(o.customer || '').trim() || `Заказ ${o.orderNo ?? ''}`.trim() : null;
    };

    const totalQty = stocks.reduce((s, x) => s + (x.quantity ?? 0), 0);
    const reservedQty = stocks.reduce((s, x) => s + (x.reservedQty ?? 0), 0);
    const places = stocks.filter((s) => (s.quantity ?? 0) !== 0 || (s.reservedQty ?? 0) > 0)
      .map((s) => ({ warehouseName: whName.get(String(s.warehouseId)) ?? '', place: s.zoneName ? String(s.zoneName) : null, qty: s.quantity ?? 0 }));

    const facts: CustomerFact[] = [];
    for (const o of outs) { const c = customerOf(o.salesOrderId); if (c && o.salesOrderId) facts.push({ orderId: String(o.salesOrderId), customer: c, qty: Number(o.qty) || 0 }); }
    for (const r of reserved) { const c = customerOf(r.salesOrderId); if (c) facts.push({ orderId: String(r.salesOrderId), customer: c, qty: Number(r.qty) || 0 }); }

    const gotRows = got as unknown as RequestRow[];
    const offerRows = offers as unknown as OfferRow[];
    return {
      id: String(mat._id), name: mat.name ?? '', article: mat.article ?? null, unit: mat.unit ?? null, categoryName: cat?.name ?? null,
      stock: { total: totalQty, free: freeQty(totalQty, reservedQty), reserved: reservedQty, places },
      suppliers: buildSuppliers(gotRows, offerRows, nameOf, canMoney),
      prices: buildPrices(gotRows, offerRows, nameOf, canMoney),
      requests: {
        total, open, lastDate: latest[0] ? requestDateOf(latest[0] as unknown as RequestRow) : null,
        items: (latest as unknown as RequestRow[]).map((r) => ({ id: String(r._id), num: r.num ?? null, date: requestDateOf(r), qty: Number(r.qty) || 0, statusLabel: requestLabel(r),
          supplierName: r.supplierId ? nameOf(r.supplierId) ?? null : null })),
      },
      issued: {
        totalQty: Math.round(Number(outTotal[0]?.qty ?? 0) * 1000) / 1000,
        items: shownOuts.map((o) => ({ date: o.date ?? null, qty: Number(o.qty) || 0, orderId: o.salesOrderId ? String(o.salesOrderId) : null,
          orderNum: o.salesOrderId ? (orderOf.get(String(o.salesOrderId))?.orderNo as string | undefined) ?? null : null,
          customerName: customerOf(o.salesOrderId), workType: o.salesOrderLineId ? lineTitle.get(String(o.salesOrderLineId)) || null : null })),
      },
      monthly: buildMonthly(now, year as unknown as RequestRow[], outs),
      customers: topCustomers(facts),
      usedIn: { products: products + modules, orders: new Set(facts.map((f) => f.orderId)).size },
    };
  }
}

/** Уникальные ObjectId из списка (пустые отбрасываются). */
function uniq(list: unknown[]): Types.ObjectId[] {
  return [...new Set(list.filter(Boolean).map(String))].filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
}
