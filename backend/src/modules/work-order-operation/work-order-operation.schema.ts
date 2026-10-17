import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WOOStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type WorkOrderOperationDocument = HydratedDocument<WorkOrderOperation>;

@Schema({ collection: 'workorderoperations', timestamps: true })
export class WorkOrderOperation {
  @Prop({ type: Types.ObjectId, ref: 'WorkOrder', required: true, index: true })
  workOrderId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkType', index: true })
  operationId?: Types.ObjectId;

  @Prop({ default: 0 })
  order!: number;

  @Prop({ default: 0 })
  plannedDuration?: number;

  @Prop({ default: 0 })
  actualDuration?: number;

  @Prop({
    enum: ['pending', 'in_progress', 'completed', 'cancelled'],
    default: 'pending',
    index: true,
  })
  status!: WOOStatus;

  @Prop({ type: Types.ObjectId, ref: 'EntityStatus' })
  statusId?: Types.ObjectId;

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  completedBy?: Types.ObjectId;

  @Prop()
  notes?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const WorkOrderOperationSchema = SchemaFactory.createForClass(WorkOrderOperation);
WorkOrderOperationSchema.index({ workOrderId: 1, order: 1 });
