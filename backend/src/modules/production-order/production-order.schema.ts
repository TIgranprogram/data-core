import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductionOrderStatus =
  | 'draft'
  | 'planned'
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'closed'
  | 'cancelled';
export type ProductionOrderPriority = 'low' | 'normal' | 'high' | 'urgent';
export type ProductionOrderDocument = HydratedDocument<ProductionOrder>;

@Schema({ collection: 'productionorders', timestamps: true })
export class ProductionOrder {
  @Prop({ required: true, unique: true, index: true })
  number!: string;

  @Prop()
  title?: string;

  @Prop({ type: Types.ObjectId, ref: 'Contract', index: true })
  contractId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Quotation', index: true })
  proposalId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId!: Types.ObjectId;

  @Prop()
  productName?: string;

  @Prop()
  productSku?: string;

  @Prop({ required: true, default: 1 })
  quantity!: number;

  @Prop({
    required: true,
    enum: [
      'draft',
      'planned',
      'in_progress',
      'paused',
      'completed',
      'closed',
      'cancelled',
    ],
    default: 'draft',
    index: true,
  })
  status!: ProductionOrderStatus;

  @Prop({ enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' })
  priority!: ProductionOrderPriority;

  @Prop()
  ralCode?: string;

  @Prop()
  plannedStartDate?: Date;

  @Prop()
  plannedEndDate?: Date;

  @Prop()
  actualStartDate?: Date;

  @Prop()
  actualEndDate?: Date;

  @Prop({ type: Types.ObjectId, ref: 'WorkType', index: true })
  workTypeId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'WorkCenter', index: true })
  workCenterId?: Types.ObjectId;

  @Prop()
  packageTag?: string;

  @Prop()
  notes?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const ProductionOrderSchema = SchemaFactory.createForClass(ProductionOrder);
ProductionOrderSchema.index({ status: 1, plannedStartDate: 1 });
