import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type SettingDocument = HydratedDocument<Setting>;

@Schema({ collection: 'settings', timestamps: true, softDelete: false })
export class Setting {
  @Prop({ required: true, unique: true, index: true })
  key!: string;

  /** Arbitrary JSON-serializable value. */
  @Prop({ type: MongooseSchema.Types.Mixed })
  value!: unknown;

  @Prop({ required: true, index: true })
  group!: string;

  @Prop()
  description?: string;

  /**
   * Soft-delete marker. Added so the global `softDeletePlugin`'s
   * pre-hook (`{ deletedAt: null }` injected into findOneAndUpdate
   * filters) does not trip Mongoose's strict-mode check on upsert.
   *
   * The schema still opts out of the plugin's hook/helper registration
   * via `softDelete: false` above — this field exists purely as a
   * schema-level allow-list for the `deletedAt` key, not to enable
   * soft-delete semantics on this collection.
   */
  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export const SettingSchema = SchemaFactory.createForClass(Setting);
