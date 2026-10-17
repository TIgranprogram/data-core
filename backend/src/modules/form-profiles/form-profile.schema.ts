import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { FormProfileEntity, FormProfileSize } from './form-profile.constants';

export type FormProfileDocument = HydratedDocument<FormProfile>;

/**
 * TZ-DICT-314 — Org-scoped QuickCreate field matrix (entity × size).
 * Unique compound: (organizationId, entity, size).
 */
@Schema({ collection: 'form_profiles', timestamps: true })
export class FormProfile {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, enum: ['product', 'module'], index: true })
  entity!: FormProfileEntity;

  @Prop({ required: true, enum: ['S', 'M', 'L'], index: true })
  size!: FormProfileSize;

  /** Visible FieldKeys; must always include LockedRequired for entity. */
  @Prop({ type: [String], required: true, default: [] })
  visibleFieldKeys!: string[];

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const FormProfileSchema = SchemaFactory.createForClass(FormProfile);

FormProfileSchema.index(
  { organizationId: 1, entity: 1, size: 1 },
  { unique: true },
);
