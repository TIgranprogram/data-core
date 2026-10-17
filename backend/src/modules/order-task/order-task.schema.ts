import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type OrderTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'skipped'
  | 'cancelled';
export type OrderTaskDocument = HydratedDocument<OrderTask>;

@Schema({ collection: 'ordertasks', timestamps: true })
export class OrderTask {
  @Prop({ type: Types.ObjectId, ref: 'ProductionOrder', required: true, index: true })
  productionOrderId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', index: true })
  componentId?: Types.ObjectId;

  @Prop()
  componentName?: string;

  @Prop({ type: Types.ObjectId, ref: 'WorkType', index: true })
  workTypeId?: Types.ObjectId;

  @Prop()
  workTypeName?: string;

  @Prop({ type: Types.ObjectId, ref: 'Worker', index: true })
  workerId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkCenter', index: true })
  workCenterId?: Types.ObjectId;

  @Prop()
  title?: string;

  @Prop()
  description?: string;

  @Prop()
  notes?: string;

  @Prop({
    enum: ['pending', 'in_progress', 'completed', 'skipped', 'cancelled'],
    default: 'pending',
    index: true,
  })
  status!: OrderTaskStatus;

  @Prop({ default: 0 })
  estimatedHours?: number;

  @Prop({ default: 0 })
  actualHours?: number;

  @Prop()
  plannedStartDate?: Date;

  @Prop()
  plannedEndDate?: Date;

  @Prop()
  actualStartDate?: Date;

  @Prop()
  actualEndDate?: Date;

  @Prop({ type: [Types.ObjectId], ref: 'OrderTask', default: [] })
  dependsOnTaskIds!: Types.ObjectId[];

  @Prop({ default: 0 })
  sortOrder?: number;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const OrderTaskSchema = SchemaFactory.createForClass(OrderTask);
OrderTaskSchema.index({ productionOrderId: 1, sortOrder: 1 });
