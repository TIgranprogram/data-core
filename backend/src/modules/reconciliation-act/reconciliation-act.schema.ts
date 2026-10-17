import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ReconciliationStatus = 'draft' | 'signed' | 'disputed' | 'closed';
export type ReconciliationActDocument = HydratedDocument<ReconciliationAct>;

@Schema({ collection: 'reconciliation_acts', timestamps: true })
export class ReconciliationAct {
  @Prop({ type: Types.ObjectId, ref: 'Counterparty', required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop()
  organizationName?: string;

  @Prop({ required: true, unique: true, index: true })
  number!: string;

  @Prop({ required: true, index: true })
  periodStart!: Date;

  @Prop({ required: true, index: true })
  periodEnd!: Date;

  @Prop({ required: true, default: 0 })
  totalDebit!: number;

  @Prop({ required: true, default: 0 })
  totalCredit!: number;

  @Prop({ required: true, default: 0 })
  ourDebt!: number;

  @Prop({ required: true, default: 0 })
  theirDebt!: number;

  @Prop({ required: true, default: 0 })
  balance!: number;

  @Prop({ enum: ['draft', 'signed', 'disputed', 'closed'], default: 'draft', index: true })
  status!: ReconciliationStatus;

  @Prop()
  signDate?: Date;

  @Prop()
  fileUrl?: string;

  @Prop()
  notes?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const ReconciliationActSchema = SchemaFactory.createForClass(ReconciliationAct);
ReconciliationActSchema.index({ organizationId: 1, periodStart: 1, periodEnd: 1 });
