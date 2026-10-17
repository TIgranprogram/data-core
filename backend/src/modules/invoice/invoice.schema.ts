import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type InvoiceStatus = 'draft' | 'received' | 'paid' | 'overdue' | 'cancelled';
export type InvoiceType = 'incoming' | 'outgoing';
export type InvoiceDocument = HydratedDocument<Invoice>;

@Schema({ collection: 'invoices', timestamps: true })
export class Invoice {
  @Prop({ required: true, unique: true, index: true })
  number!: string;

  @Prop({ required: true, enum: ['incoming', 'outgoing'], default: 'incoming', index: true })
  type!: InvoiceType;

  @Prop({ type: Types.ObjectId, ref: 'Counterparty', required: true, index: true })
  supplierId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization' })
  supplierOrgId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PurchaseOrder', index: true })
  purchaseOrderId?: Types.ObjectId;

  @Prop({ required: true, default: 0 })
  totalAmount!: number;

  @Prop({ default: 0 })
  paidAmount?: number;

  @Prop({
    enum: ['draft', 'received', 'paid', 'overdue', 'cancelled'],
    default: 'received',
    index: true,
  })
  status!: InvoiceStatus;

  @Prop({ required: true })
  invoiceDate!: Date;

  @Prop({ required: true })
  dueDate!: Date;

  @Prop({ default: false, index: true })
  paid!: boolean;

  @Prop()
  paidAt?: Date;

  @Prop()
  fileUrl?: string;

  @Prop()
  notes?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
InvoiceSchema.index({ dueDate: 1, paid: 1 });
