import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, type HydratedDocument } from 'mongoose';
export type SupplyInvoicePaymentDocument = HydratedDocument<SupplyInvoicePayment>;
/** C158: дочерний факт оплаты счёта; не самостоятельный расход. Сторно сохраняет запись. */
@Schema({ collection: 'supplyinvoicepayments', timestamps: true, softDelete: false })
export class SupplyInvoicePayment {
  @Prop({ type: Number }) version?: number;
  @Prop({ type: Types.ObjectId, required: true, index: true }) invoiceId!: Types.ObjectId;
  @Prop({ required: true, maxlength: 100 }) clientUid!: string;
  @Prop({ required: true }) requestHash!: string;
  @Prop({ required: true }) date!: string;
  @Prop({ required: true, min: 0 }) amount!: number;
  @Prop({ required: true, min: 0 }) sourceAmount!: number;
  @Prop({ type: Types.ObjectId, required: true }) payerCompanyId!: Types.ObjectId;
  @Prop({ required: true }) currency!: string;
  @Prop() currencyName?: string;
  @Prop() exchangeRate?: number;
  @Prop() exchangeRateDate?: string;
  @Prop() exchangeRateSource?: string;
  @Prop({ type: [Types.ObjectId], default: [] }) fileIds!: Types.ObjectId[];
  @Prop({ maxlength: 1000 }) note?: string;
  @Prop({ type: Types.ObjectId }) createdBy?: Types.ObjectId;
  @Prop({ enum: ['active', 'voided'], default: 'active' }) state!: string;
  @Prop({ type: [Object], required: true }) allocations!: Record<string, unknown>[];
  @Prop({ type: Date }) voidedAt?: Date;
  @Prop({ type: Types.ObjectId }) voidedBy?: Types.ObjectId;
  @Prop() voidReason?: string;
  @Prop() voidClientUid?: string;
  @Prop({ type: Types.ObjectId }) replacementOf?: Types.ObjectId;
}
export const SupplyInvoicePaymentSchema = SchemaFactory.createForClass(SupplyInvoicePayment);
SupplyInvoicePaymentSchema.index({ invoiceId: 1, clientUid: 1 }, { unique: true });
SupplyInvoicePaymentSchema.index({ invoiceId: 1, date: 1, _id: 1 });
SupplyInvoicePaymentSchema.index({ payerCompanyId: 1, date: 1 });
SupplyInvoicePaymentSchema.index({ invoiceId: 1, state: 1 });
