import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class ShipmentItem {
  /** Stable OrderItem.lineId; legacy shipments may omit it. */
  @Prop()
  lineId?: string;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop()
  productName?: string;

  @Prop({ required: true, default: 0 })
  quantity!: number;

  @Prop()
  unit?: string;
}

const ShipmentItemSchema = SchemaFactory.createForClass(ShipmentItem);

@Schema({ _id: false })
export class ShippingDoc {
  @Prop({ required: true })
  number!: string;

  @Prop({ required: true, default: () => new Date() })
  date!: Date;

  @Prop({ required: true })
  type!: string; // 'ttn' | 'upd' | 'cmr' | 'invoice' | 'other'

  @Prop({ required: true, default: 0 })
  totalAmount!: number;

  @Prop({ type: [String], default: [] })
  signatures!: string[];

  @Prop()
  pdfUrl?: string;

  @Prop()
  notes?: string;
}

const ShippingDocSchema = SchemaFactory.createForClass(ShippingDoc);

export type ShipmentStatus = 'draft' | 'scheduled' | 'in_transit' | 'delivered' | 'cancelled';
export type ShipmentDocument = HydratedDocument<Shipment>;

@Schema({ collection: 'shipments', timestamps: true })
export class Shipment {
  @Prop({ required: true, unique: true, index: true })
  number!: string;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  orderId!: Types.ObjectId;

  /** TZ-SUPPLY-312 — owning organization for cross-tenant isolation. */
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: false, index: true })
  organizationId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Counterparty', required: true, index: true })
  counterpartyId!: Types.ObjectId;

  @Prop({ required: true, default: () => new Date() })
  date!: Date;

  @Prop()
  recipient?: string;

  @Prop()
  address?: string;

  @Prop({ type: Types.ObjectId, ref: 'EntityStatus' })
  statusId?: Types.ObjectId;

  @Prop({
    enum: ['draft', 'scheduled', 'in_transit', 'delivered', 'cancelled'],
    default: 'draft',
    index: true,
  })
  status!: ShipmentStatus;

  @Prop()
  driverInfo?: string;

  @Prop({ type: Types.ObjectId, ref: 'Warehouse', index: true })
  warehouseId?: Types.ObjectId;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  /** Soft-delete marker; removed shipments must not reappear in the registry. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;

  @Prop({ type: [ShipmentItemSchema], default: [] })
  items!: ShipmentItem[];

  @Prop({ type: [String], default: [] })
  photos!: string[];

  @Prop()
  notes?: string;

  @Prop({ type: [ShippingDocSchema], default: [] })
  docs!: ShippingDoc[];

  @Prop()
  dispatchedAt?: Date;
}

export const ShipmentSchema = SchemaFactory.createForClass(Shipment);
ShipmentSchema.index({ organizationId: 1, orderId: 1, date: -1, deletedAt: 1 });
ShipmentSchema.index({ organizationId: 1, status: 1, date: -1, deletedAt: 1 });
