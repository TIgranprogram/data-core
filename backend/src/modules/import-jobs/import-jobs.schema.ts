import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ImportStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type ImportEntityType = 'materials' | 'products' | 'counterparties' | 'orders';
export type ImportJobsDocument = HydratedDocument<ImportJobs>;

@Schema({ collection: 'import_jobs', timestamps: true })
export class ImportJobs {
  @Prop({ enum: ['csv', 'excel', 'api'], required: true })
  sourceType!: 'csv' | 'excel' | 'api';

  @Prop({ enum: ['materials', 'products', 'counterparties', 'orders'], required: true, index: true })
  entityType!: ImportEntityType;

  @Prop()
  sourceFile?: string;

  @Prop()
  sourceUrl?: string;

  @Prop({ type: Object })
  sourceOptions?: Record<string, unknown>;

  @Prop({ enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'], default: 'pending', index: true })
  status!: ImportStatus;

  @Prop({ default: 0 })
  progressPercent!: number;

  @Prop({ default: 0 })
  totalRecords!: number;

  @Prop({ default: 0 })
  processedRecords!: number;

  @Prop({ default: 0 })
  successRecords!: number;

  @Prop({ default: 0 })
  failedRecords!: number;

  @Prop({ type: [String], default: [] })
  errorLog!: string[];

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdByUserId?: Types.ObjectId;

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const ImportJobsSchema = SchemaFactory.createForClass(ImportJobs);
