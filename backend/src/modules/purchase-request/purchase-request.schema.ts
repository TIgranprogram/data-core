import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class PurchaseRequestItem {
  @Prop({ type: Types.ObjectId, ref: 'Material', required: true })
  materialId!: Types.ObjectId;

  @Prop()
  materialName?: string;

  @Prop({ required: true, default: 0 })
  quantity!: number;

  @Prop()
  unit?: string;

  @Prop({ default: 0 })
  estimatedPrice?: number;
}

const PurchaseRequestItemSchema = SchemaFactory.createForClass(PurchaseRequestItem);

export type PurchaseRequestStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'converted' | 'cancelled';
export type PurchaseRequestDocument = HydratedDocument<PurchaseRequest>;

@Schema({ collection: 'purchaserequests', timestamps: true })
export class PurchaseRequest {
  @Prop({ required: true, unique: true, index: true })
  number!: string;

  @Prop({ required: true, default: () => new Date() })
  date!: Date;

  @Prop()
  title?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'EntityStatus' })
  statusId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ProductionOrder' })
  orderId?: Types.ObjectId;

  @Prop()
  sourceType?: string;

  @Prop()
  sourceId?: string;

  @Prop({ required: true })
  entityType!: string;

  @Prop({ required: true })
  entityId!: string;

  @Prop()
  entityName?: string;

  @Prop()
  entitySku?: string;

  @Prop()
  entityUnit?: string;

  @Prop({ default: 0 })
  quantity!: number;

  @Prop({ type: Types.ObjectId, ref: 'Warehouse' })
  warehouseId?: Types.ObjectId;

  @Prop()
  zoneName?: string;

  @Prop()
  notes?: string;

  @Prop({ default: 0 })
  totalAmount!: number;

  @Prop({ type: [PurchaseRequestItemSchema], default: [] })
  items!: PurchaseRequestItem[];

  @Prop({ enum: ['draft', 'pending', 'approved', 'rejected', 'converted', 'cancelled'], default: 'draft', index: true })
  status!: PurchaseRequestStatus;

  @Prop()
  convertedPurchaseOrderId?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const PurchaseRequestSchema = SchemaFactory.createForClass(PurchaseRequest);
PurchaseRequestSchema.index({ status: 1, date: -1 });
