import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MaterialPriceDocument = HydratedDocument<MaterialPrice>;
export const PRICE_SOURCES = ['invoice_issued', 'invoice_paid', 'manual', 'import'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

/** История цен материала (`materialprices`) — только data-core. Строка = факт цены; цена хранится без НДС. */
@Schema({ collection: 'materialprices', timestamps: true, softDelete: false })
export class MaterialPrice {
  @Prop({ type: Types.ObjectId, required: true }) materialId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) supplierId?: Types.ObjectId;
  @Prop({ trim: true }) supplierName?: string;
  /** За единицу, без НДС. */
  @Prop({ required: true, min: 0 }) price!: number;
  @Prop({ default: 20, min: 0 }) vatRate!: number;
  @Prop({ required: true, min: 0 }) priceWithVat!: number;
  @Prop() unit?: string;
  @Prop({ min: 0 }) qty?: number;
  @Prop({ default: 'RUB' }) currency!: string;
  @Prop({ type: Date, required: true }) date!: Date;
  @Prop({ enum: PRICE_SOURCES, required: true }) source!: PriceSource;
  @Prop({ type: Types.ObjectId }) invoiceId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) requestId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) salesOrderId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) createdBy?: Types.ObjectId;
}
export const MaterialPriceSchema = SchemaFactory.createForClass(MaterialPrice);
MaterialPriceSchema.index({ materialId: 1, date: -1 });
MaterialPriceSchema.index({ supplierId: 1, date: -1 });
MaterialPriceSchema.index({ requestId: 1, source: 1 }, { unique: true, sparse: true }); // анти-дубль
