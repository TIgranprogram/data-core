import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CertType = 'declaration' | 'certificate' | 'iso' | 'other';
export type CertStatus = 'active' | 'expired' | 'suspended' | 'revoked';
export type CertificateDocument = HydratedDocument<Certificate>;

@Schema({ collection: 'certificates', timestamps: true })
export class Certificate {
  @Prop({ type: [Types.ObjectId], ref: 'Product', default: [], index: true })
  productIds!: Types.ObjectId[];

  /** Cache of product names for fast list views. */
  @Prop({ type: [String], default: [] })
  productNames!: string[];

  @Prop({ required: true, index: true })
  number!: string;

  @Prop({ required: true, enum: ['declaration', 'certificate', 'iso', 'other'] })
  certType!: CertType;

  @Prop({ required: true, enum: ['active', 'expired', 'suspended', 'revoked'], default: 'active' })
  status!: CertStatus;

  /** Canonical issuer name. */
  @Prop({ required: true })
  issuedBy!: string;

  @Prop({ required: true })
  issueDate!: Date;

  /** Canonical expiry date. */
  @Prop({ required: true })
  expiresAt!: Date;

  @Prop()
  fileUrl?: string;

  @Prop()
  notes?: string;

  /** TZ-CORE-302: soft-delete timestamp; null = active. */
  @Prop({ type: Date, default: null, index: true })
  deletedAt?: Date | null;
}

export const CertificateSchema = SchemaFactory.createForClass(Certificate);
CertificateSchema.index({ expiresAt: 1, status: 1 });
