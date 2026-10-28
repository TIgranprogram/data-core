import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Model, Types } from 'mongoose';
import { oid, parseList } from '../../common/list-query';
import { Material, MaterialDocument } from './material.schema';
import { MaterialPrice, MaterialPriceDocument, PriceSource } from './material-price.schema';
import { DEFAULT_VAT_RATE, unitPrices } from './material-price.calc';

export interface PriceRowInput {
  materialId: Types.ObjectId; supplierId?: Types.ObjectId; supplierName?: string;
  lineTotalWithVat: number; qty: number; unit?: string; vatRate?: number; date: Date;
  source: PriceSource; invoiceId?: Types.ObjectId; requestId?: Types.ObjectId; salesOrderId?: Types.ObjectId; createdBy?: Types.ObjectId;
}

/** История цен материалов: запись факта, «последняя цена» в материале, чтение. */
@Injectable()
export class MaterialPriceService {
  constructor(
    @InjectModel(MaterialPrice.name) private readonly prices: Model<MaterialPriceDocument>,
    @InjectModel(Material.name) private readonly materials: Model<MaterialDocument>,
  ) {}

  /** Одна строка на (заявка, источник) — повтор обновляет; двигает lastPrice материала, если дата не старше. false — цену не посчитать. */
  async record(i: PriceRowInput, session?: ClientSession): Promise<boolean> {
    const vatRate = i.vatRate ?? DEFAULT_VAT_RATE;
    const p = unitPrices(i.lineTotalWithVat, i.qty, vatRate);
    if (!p) return false;
    const doc = { materialId: i.materialId, supplierId: i.supplierId, supplierName: i.supplierName, ...p, vatRate, unit: i.unit, qty: i.qty,
      currency: 'RUB', date: i.date, source: i.source, invoiceId: i.invoiceId, requestId: i.requestId, salesOrderId: i.salesOrderId, createdBy: i.createdBy };
    if (i.requestId) await this.prices.updateOne({ requestId: i.requestId, source: i.source }, { $set: doc }, { upsert: true, session }).exec();
    else await this.prices.create([doc], { session });
    await this.materials.updateOne(
      { _id: i.materialId, $or: [{ lastPriceDate: { $exists: false } }, { lastPriceDate: null }, { lastPriceDate: { $lte: i.date } }] },
      { $set: { lastPrice: p.price, lastPriceDate: i.date, lastSupplierId: i.supplierId, lastSupplierName: i.supplierName } }, { session }).exec();
    return true;
  }

  async list(materialId: string, q: Record<string, unknown>) {
    const id = oid(materialId, 'материала');
    const { page, limit, skip } = parseList(q, { sortable: ['date'], defaultSort: '-date', maxLimit: 200, defaultLimit: 50 });
    const [items, total] = await Promise.all([
      this.prices.find({ materialId: id }).sort({ date: -1, _id: -1 }).skip(skip).limit(limit).lean().exec(),
      this.prices.countDocuments({ materialId: id }).exec(),
    ]);
    return { items, total, page, limit };
  }

  /** Цена для новой заявки: из материала (lastPrice), иначе последняя строка истории; нет — пустые поля. */
  async defaultFor(materialId: string) {
    const id = oid(materialId, 'материала');
    const m = await this.materials.findOne({ _id: id }).select('lastPrice lastPriceDate lastSupplierId lastSupplierName').lean().exec() as Record<string, unknown> | null;
    if (!m) throw new NotFoundException('Материал не найден');
    if (m.lastPrice != null) return { price: m.lastPrice, supplierId: m.lastSupplierId ? String(m.lastSupplierId) : null, supplierName: m.lastSupplierName ?? null, date: m.lastPriceDate ?? null };
    const last = await this.prices.findOne({ materialId: id }).sort({ date: -1 }).lean().exec();
    return { price: last?.price ?? null, supplierId: last?.supplierId ? String(last.supplierId) : null, supplierName: last?.supplierName ?? null, date: last?.date ?? null };
  }
}
