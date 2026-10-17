import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WorkOrderStatus = 'draft' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
export type WorkOrderDocument = HydratedDocument<WorkOrder>;

@Schema({ collection: 'workorders', timestamps: true })
export class WorkOrder {
  @Prop({ required: true, unique: true, index: true })
  number!: string;

  @Prop({ type: Types.ObjectId, ref: 'ProductionOrder', required: true, index: true })
  orderId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId!: Types.ObjectId;

  @Prop({ required: true, default: 1 })
  qty!: number;

  @Prop({ type: Types.ObjectId, ref: 'EntityStatus', index: true })
  statusId?: Types.ObjectId;

  @Prop()
  startDate?: Date;

  @Prop()
  endDate?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  assignedTo?: Types.ObjectId;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop()
  notes?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const WorkOrderSchema = SchemaFactory.createForClass(WorkOrder);
