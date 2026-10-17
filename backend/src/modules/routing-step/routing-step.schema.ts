import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RoutingStepDocument = HydratedDocument<RoutingStep>;

@Schema({ collection: 'routingsteps', timestamps: true })
export class RoutingStep {
  @Prop({ required: true, index: true })
  number!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, index: true })
  workshop!: string;

  @Prop({ required: true, default: 0 })
  duration!: number;

  @Prop({ required: true, default: 0 })
  costPerHour!: number;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'WorkType', index: true })
  workTypeId?: Types.ObjectId;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const RoutingStepSchema = SchemaFactory.createForClass(RoutingStep);
