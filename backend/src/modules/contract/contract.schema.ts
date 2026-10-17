import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class ContractItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop()
  productName?: string;

  @Prop({ required: true, default: 0 })
  quantity!: number;

  @Prop()
  unit?: string;

  @Prop({ required: true, default: 0 })
  unitPrice!: number;

  @Prop({ required: true, default: 0 })
  total!: number;
}

const ContractItemSchema = SchemaFactory.createForClass(ContractItem);

export type ContractStatus = 'draft' | 'sent' | 'signed' | 'active' | 'completed' | 'cancelled' | 'expired';
export type ContractAttachmentStatus = 'none' | 'file_attached' | 'generated';
export type ContractDocument = HydratedDocument<Contract>;

@Schema({ collection: 'contracts', timestamps: true })
export class Contract {
  @Prop({ required: true, unique: true, index: true })
  number!: string;

  @Prop()
  title?: string;

  @Prop({ type: Types.ObjectId, ref: 'Quotation', index: true })
  proposalId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Counterparty', required: true, index: true })
  customerId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'EntityStatus' })
  statusId?: Types.ObjectId;

  @Prop({
    enum: ['draft', 'sent', 'signed', 'active', 'completed', 'cancelled', 'expired'],
    default: 'draft',
    index: true,
  })
  status!: ContractStatus;

  /** File/document state is separate from the contract lifecycle status. */
  @Prop({
    type: String,
    enum: ['none', 'file_attached', 'generated'],
    default: 'none',
    index: true,
  })
  contractStatus!: ContractAttachmentStatus;

  @Prop({ type: String })
  attachmentFileId?: string;

  @Prop({ type: String })
  attachmentUrl?: string;

  @Prop({ type: [ContractItemSchema], default: [] })
  items!: ContractItem[];

  @Prop()
  notes?: string;

  @Prop({ required: true, default: 0 })
  totalAmount!: number;

  @Prop()
  signedAt?: Date;

  @Prop()
  expiresAt?: Date;

  @Prop()
  packageTag?: string;

  @Prop({ default: true, index: true })
  isActive!: boolean;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const ContractSchema = SchemaFactory.createForClass(Contract);
ContractSchema.index({ customerId: 1, date: -1 });
ContractSchema.index({ status: 1, expiresAt: 1 });
