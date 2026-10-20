import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type EntityStatusDocument = HydratedDocument<EntityStatus>;

@Schema({ softDelete: false,  collection: 'entitystatuses', timestamps: true })
export class EntityStatus {
  @Prop({ required: true, index: true })
  entityType!: string;

  @Prop({ required: true })
  statusId!: string;

  @Prop({ required: true })
  label!: string;

  @Prop({ default: '#888888' })
  color!: string;

  @Prop()
  icon?: string;

  @Prop({ default: 0 })
  sortOrder!: number;

  @Prop({ default: false })
  isInitial!: boolean;

  @Prop({ default: false })
  isFinal!: boolean;
}

export const EntityStatusSchema = SchemaFactory.createForClass(EntityStatus);
EntityStatusSchema.index({ entityType: 1, statusId: 1 }, { unique: true });
