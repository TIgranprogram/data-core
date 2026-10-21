import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AttributeType = 'string' | 'number' | 'date' | 'enum' | 'boolean';
export type AttributeDefinitionDocument = HydratedDocument<AttributeDefinition>;

@Schema({ collection: 'attributedefinitions', timestamps: true })
export class AttributeDefinition {
  /** Target entity, e.g. "Product", "Material", "Organization". */
  @Prop({ required: true, index: true })
  entityType!: string;

  /** Optional scope to a Category. Null = applies to all in entityType. */
  @Prop({ type: Types.ObjectId, ref: 'Category', index: true })
  categoryId?: Types.ObjectId;

  /** Unique within (entityType, categoryId). */
  @Prop({ required: true, index: true })
  name!: string;

  @Prop({ required: true })
  label!: string;

  @Prop({ required: true, enum: ['string', 'number', 'date', 'enum', 'boolean'] })
  type!: AttributeType;

  @Prop()
  unit?: string;

  /** Allowed values for type=enum. */
  @Prop({ type: [String], default: undefined })
  options?: string[];

  @Prop({ default: false })
  required!: boolean;

  @Prop({ default: 0 })
  sortOrder!: number;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop()
  description?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const AttributeDefinitionSchema = SchemaFactory.createForClass(AttributeDefinition);
AttributeDefinitionSchema.index({ entityType: 1, categoryId: 1, name: 1 }, { unique: true });
