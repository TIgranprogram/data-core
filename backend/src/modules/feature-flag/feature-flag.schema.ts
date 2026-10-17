import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FeatureFlagDocument = HydratedDocument<FeatureFlag>;

@Schema({ collection: 'featureflags', timestamps: true, softDelete: false })
export class FeatureFlag {
  @Prop({ required: true, unique: true, index: true })
  key!: string;

  @Prop({ required: true })
  label!: string;

  @Prop()
  description?: string;

  @Prop({ default: false })
  enabledByDefault!: boolean;

  @Prop({ required: true, index: true })
  category!: string;

  @Prop({ default: true })
  isActive!: boolean;

  /**
   * Soft-delete marker. Added defensively to allow-list the `deletedAt`
   * key in case any plugin or middleware injects it into an upsert
   * filter — the global `softDeletePlugin` opt-out above
   * (`softDelete: false`) SHOULD prevent its pre-hook from firing on
   * this schema, but we keep this field as a belt-and-braces guard
   * against Mongoose's strict-mode check (`Path "deletedAt" is not in
   * schema`) on the seed upsert. This field does NOT enable soft-delete
   * semantics on this collection.
   */
  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export const FeatureFlagSchema = SchemaFactory.createForClass(FeatureFlag);

FeatureFlagSchema.virtual('enabled').get(function (this: FeatureFlagDocument) {
  return this.isActive ? this.enabledByDefault : false;
});

FeatureFlagSchema.set('toJSON', { virtuals: true });
FeatureFlagSchema.set('toObject', { virtuals: true });
