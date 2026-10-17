import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class PurchaseOrderItem {
  @Prop({ type: Types.ObjectId, ref: 'Material', required: true })
  materialId!: Types.ObjectId;

  @Prop()
  materialName?: string;

  @Prop({ required: true, default: 0 })
  quantity!: number;

  @Prop()
  unit?: string;

  @Prop({ default: 0 })
  unitPrice!: number;

  @Prop({ default: 0 })
  total!: number;

  @Prop()
  notes?: string;
}

const PurchaseOrderItemSchema = SchemaFactory.createForClass(PurchaseOrderItem);

export type PurchaseOrderStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'sent'
  | 'partially_received'
  | 'received'
  | 'cancelled';
export type PurchaseOrderDocument = HydratedDocument<PurchaseOrder>;

@Schema({ collection: 'purchaseorders', timestamps: true })
export class PurchaseOrder {
  @Prop({ required: true, unique: true, index: true })
  number!: string;

  @Prop()
  title?: string;

  @Prop({ type: Types.ObjectId, ref: 'Counterparty', required: true, index: true })
  supplierId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization' })
  supplierOrgId?: Types.ObjectId;

  @Prop({
    enum: ['draft', 'pending', 'approved', 'sent', 'partially_received', 'received', 'cancelled'],
    default: 'draft',
    index: true,
  })
  status!: PurchaseOrderStatus;

  @Prop({ type: [PurchaseOrderItemSchema], default: [] })
  items!: PurchaseOrderItem[];

  @Prop({ default: 0 })
  totalAmount!: number;

  @Prop()
  deliveryDate?: Date;

  @Prop({ type: Types.ObjectId, ref: 'Warehouse' })
  warehouseId?: Types.ObjectId;

  @Prop()
  notes?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const PurchaseOrderSchema = SchemaFactory.createForClass(PurchaseOrder);
PurchaseOrderSchema.index({ status: 1, deliveryDate: 1 });
