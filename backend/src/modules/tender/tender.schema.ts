import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TenderType = 'government' | 'commercial' | 'other';
export type TenderStatus = 'draft' | 'open' | 'submitted' | 'won' | 'lost' | 'cancelled';
export type TenderDocument = HydratedDocument<Tender>;

@Schema({ collection: 'tenders', timestamps: true })
export class Tender {
  @Prop({ required: true, unique: true, index: true })
  number!: string;

  @Prop()
  tenderId?: string;

  @Prop({ required: true, default: () => new Date() })
  date!: Date;

  @Prop({ type: Types.ObjectId, ref: 'Organization' })
  companyId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization' })
  customerOrgId?: Types.ObjectId;

  @Prop()
  customerName?: string;

  @Prop()
  email?: string;

  @Prop()
  subject?: string;

  @Prop()
  productName?: string;

  @Prop({ default: 0 })
  quantity?: number;

  @Prop()
  unit?: string;

  @Prop({ type: [String], default: [] })
  attachments!: string[];

  @Prop()
  deliveryTerms?: string;

  @Prop()
  responseRequirements?: string;

  @Prop()
  legalBasis?: string;

  @Prop({ type: Types.ObjectId, ref: 'EntityStatus' })
  statusId?: Types.ObjectId;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop()
  title?: string;

  @Prop({ enum: ['government', 'commercial', 'other'], default: 'commercial' })
  type!: TenderType;

  @Prop()
  noticeNumber?: string;

  @Prop()
  platformUrl?: string;

  @Prop({ default: 0 })
  startPrice?: number;

  @Prop({ default: 0 })
  ourPrice?: number;

  @Prop()
  publishDate?: Date;

  @Prop()
  submissionDeadline?: Date;

  @Prop()
  resultDate?: Date;

  @Prop({ default: 0 })
  totalAmount?: number;

  @Prop({
    enum: ['draft', 'open', 'submitted', 'won', 'lost', 'cancelled'],
    default: 'open',
    index: true,
  })
  status!: TenderStatus;

  @Prop({ type: [Types.ObjectId], ref: 'Quotation', default: [] })
  quoteIds!: Types.ObjectId[];

  @Prop()
  notes?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const TenderSchema = SchemaFactory.createForClass(Tender);
TenderSchema.index({ submissionDeadline: 1, status: 1 });
