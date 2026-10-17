import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const ATTACHMENT_ENTITY_TYPES = ['Product', 'ProductModule', 'Material'] as const;
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

export const ATTACHMENT_TYPES = ['passport', 'drawing', 'manual', 'certificate', 'other'] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

export type AttachmentDocument = HydratedDocument<Attachment>;

@Schema({ collection: 'catalogattachments', timestamps: true })
export class Attachment {
  @Prop({ type: String, enum: ATTACHMENT_ENTITY_TYPES, required: true, index: true })
  entityType!: AttachmentEntityType;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  entityId!: Types.ObjectId;

  /** Typed document/photo role; this replaces boolean presence flags for new data. */
  @Prop({ type: String, enum: ATTACHMENT_TYPES, required: true, index: true })
  type!: AttachmentType;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true })
  storageUrl!: string;

  @Prop()
  mimeType?: string;

  @Prop({ min: 0 })
  sizeBytes?: number;

  @Prop()
  description?: string;

  /** Optional denormalized scope for reporting; parent ownership remains authoritative. */
  @Prop({ type: Types.ObjectId, ref: 'Organization', sparse: true, index: true })
  organizationId?: Types.ObjectId;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const AttachmentSchema = SchemaFactory.createForClass(Attachment);
AttachmentSchema.index({ entityType: 1, entityId: 1, isActive: 1, createdAt: -1 });
