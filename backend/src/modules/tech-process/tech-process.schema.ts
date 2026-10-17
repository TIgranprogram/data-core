import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class TechProcessOperation {
  @Prop({ required: true })
  sequence!: number;

  @Prop({ type: Types.ObjectId, ref: 'WorkType', required: true })
  workTypeId!: Types.ObjectId;

  @Prop({ required: true, default: 0 })
  durationHours!: number;

  @Prop({ type: Types.ObjectId, ref: 'WorkCenter', required: true })
  workCenterId!: Types.ObjectId;
}

const TechProcessOperationSchema = SchemaFactory.createForClass(TechProcessOperation);

export type TechProcessDocument = HydratedDocument<TechProcess>;

@Schema({ collection: 'techprocesses', timestamps: true })
export class TechProcess {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true, index: true })
  productId!: Types.ObjectId;

  @Prop({ default: 0 })
  totalDuration!: number;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ type: [TechProcessOperationSchema], default: [] })
  operations!: TechProcessOperation[];

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const TechProcessSchema = SchemaFactory.createForClass(TechProcess);
TechProcessSchema.index({ productId: 1, isActive: 1 });
