import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WorkCenterType = 'machine' | 'line' | 'area' | 'workshop' | 'other';
export type WorkCenterDocument = HydratedDocument<WorkCenter>;

@Schema({ softDelete: false,  collection: 'workcenters', timestamps: true })
export class WorkCenter {
  @Prop({ required: true, index: true })
  name!: string;

  @Prop({ required: true, enum: ['machine', 'line', 'area', 'workshop', 'other'], default: 'machine' })
  type!: WorkCenterType;

  @Prop()
  description?: string;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  /** Max concurrent jobs / capacity per shift. */
  @Prop({ default: 1 })
  capacity?: number;

  @Prop()
  location?: string;
}

export const WorkCenterSchema = SchemaFactory.createForClass(WorkCenter);
