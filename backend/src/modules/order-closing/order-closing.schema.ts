import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type OrderClosingType = 'final' | 'partial' | 'corrective';
export type OrderClosingStatus = 'draft' | 'signed' | 'cancelled';
export type OrderClosingDocument = HydratedDocument<OrderClosing>;

@Schema({ softDelete: false,  collection: 'orderclosings', timestamps: true })
export class OrderClosing {
  @Prop({ type: Types.ObjectId, ref: 'ProductionOrder', required: true, index: true })
  productionOrderId!: Types.ObjectId;

  @Prop()
  orderNumber?: string;

  @Prop({ required: true, enum: ['final', 'partial', 'corrective'] })
  closingType!: OrderClosingType;

  @Prop({ required: true })
  number!: string;

  @Prop({ required: true })
  date!: Date;

  @Prop({ default: 0 })
  amount?: number;

  @Prop()
  totalAmount?: number;

  @Prop({ type: Types.ObjectId, ref: 'Organization', index: true })
  organizationId?: Types.ObjectId;

  @Prop({ enum: ['draft', 'signed', 'cancelled'], default: 'draft', index: true })
  status!: OrderClosingStatus;

  @Prop()
  fileUrl?: string;

  @Prop()
  notes?: string;
}

export const OrderClosingSchema = SchemaFactory.createForClass(OrderClosing);
OrderClosingSchema.index({ productionOrderId: 1, status: 1 });
