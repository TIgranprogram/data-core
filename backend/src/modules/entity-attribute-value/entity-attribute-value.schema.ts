import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EntityAttributeValueDocument = HydratedDocument<EntityAttributeValue>;

@Schema({ collection: 'entityattributevalues', timestamps: true })
export class EntityAttributeValue {
  @Prop({ required: true, index: true })
  entityType!: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  entityId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'AttributeDefinition', required: true, index: true })
  attributeId!: Types.ObjectId;

  /** Mixed: string | number | boolean | Date | string[] (enum). */
  @Prop({ type: Object, required: true })
  value!: unknown;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const EntityAttributeValueSchema = SchemaFactory.createForClass(EntityAttributeValue);
EntityAttributeValueSchema.index({ entityType: 1, entityId: 1, attributeId: 1 }, { unique: true });
EntityAttributeValueSchema.index({ entityType: 1, entityId: 1 });
