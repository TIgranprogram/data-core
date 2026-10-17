import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReportType = 'monthly' | 'quarterly' | 'yearly' | 'custom';
export type ReportStatus = 'draft' | 'generated' | 'exported' | 'archived';
export type FinancialReportDocument = HydratedDocument<FinancialReport>;

@Schema({ collection: 'financial_reports', timestamps: true })
export class FinancialReport {
  @Prop({ required: true })
  title!: string;

  @Prop({ required: true, unique: true, index: true })
  number!: string;

  @Prop({ enum: ['monthly', 'quarterly', 'yearly', 'custom'], required: true, index: true })
  reportType!: ReportType;

  @Prop({ required: true, index: true })
  periodStart!: Date;

  @Prop({ required: true, index: true })
  periodEnd!: Date;

  @Prop({ type: Object })
  data?: Record<string, unknown>;

  @Prop({ default: 0 })
  totalAmount!: number;

  @Prop({ default: 0 })
  totalIncome!: number;

  @Prop({ default: 0 })
  totalExpense!: number;

  @Prop({ default: 0 })
  netProfit!: number;

  @Prop({ enum: ['draft', 'generated', 'exported', 'archived'], default: 'draft', index: true })
  status!: ReportStatus;

  @Prop()
  generatedAt?: Date;

  @Prop()
  notes?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const FinancialReportSchema = SchemaFactory.createForClass(FinancialReport);
FinancialReportSchema.index({ reportType: 1, periodStart: 1, periodEnd: 1 });
