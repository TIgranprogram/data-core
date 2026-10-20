import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const DICTIONARY_LABEL_SCOPES = ['productKind', 'materialKind'] as const;
export type DictionaryLabelScope = (typeof DICTIONARY_LABEL_SCOPES)[number];

export type DictionaryLabelDocument = HydratedDocument<DictionaryLabel>;

@Schema({ softDelete: false,  collection: 'dictionary_labels', timestamps: true })
export class DictionaryLabel {
  @Prop({ required: true, enum: DICTIONARY_LABEL_SCOPES, index: true })
  scope!: DictionaryLabelScope;

  /** Stable API key; labels may be renamed without changing catalog values. */
  @Prop({ required: true, trim: true })
  key!: string;

  @Prop({ required: true, trim: true })
  label!: string;

  @Prop({ required: true, default: 0 })
  sortOrder!: number;

  @Prop({ required: true, default: true, index: true })
  isActive!: boolean;

  @Prop({ required: true, default: true })
  isSystem!: boolean;

  /** `null` is the global seed scope; ObjectId is an organization override. */
  @Prop({ type: Types.ObjectId, default: null, index: true })
  organizationId?: Types.ObjectId | null;
}

export const DictionaryLabelSchema = SchemaFactory.createForClass(DictionaryLabel);
DictionaryLabelSchema.index(
  { organizationId: 1, scope: 1, key: 1 },
  { unique: true },
);
