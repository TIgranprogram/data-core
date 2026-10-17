import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WorkTypeDocument = HydratedDocument<WorkType>;

@Schema({ collection: 'worktypes', timestamps: true })
export class WorkType {
  @Prop({ required: true, index: true })
  name!: string;

  @Prop()
  section?: string;

  @Prop()
  description?: string;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop()
  department?: string;

  @Prop({ default: 0 })
  defaultDurationHours?: number;

  /**
   * TZ-PRODUCTION-302 — Calendar days estimation for Gantt.
   * Null is allowed (stuck path: days unknown until PRODUCTION-304 alarm).
   */
  @Prop({ type: Number, default: null })
  days?: number | null;

  /**
   * Optional accent hue (0–359) for Gantt bars + inspector wash.
   * Null/absent → deterministic hash from _id on the client.
   */
  @Prop({ type: Number, default: null, min: 0, max: 359 })
  accentHue?: number | null;

  @Prop({ type: Types.ObjectId, ref: 'WorkCenter', index: true })
  workCenterId?: Types.ObjectId;

  /** TZ-COST-301 — расценка ₽/час; legacy без поля → backfill 0 на boot. */
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  hourlyRate!: number;

  /** TZ-CATALOG-314 archive marker; legacy rows without this field remain active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const WorkTypeSchema = SchemaFactory.createForClass(WorkType);
WorkTypeSchema.index({ deletedAt: 1, name: 1 });
