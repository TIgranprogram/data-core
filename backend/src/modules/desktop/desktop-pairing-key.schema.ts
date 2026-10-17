import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DesktopPairingKeyDocument = HydratedDocument<DesktopPairingKey>;

export type DesktopPairingTtl = '1d' | '7d' | '30d' | '90d' | 'never';

@Schema({ softDelete: false,  collection: 'desktop_pairing_keys', timestamps: true })
export class DesktopPairingKey {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: false, index: true })
  organizationId?: Types.ObjectId | null;

  @Prop({ type: String, required: false, default: 'Desktop', maxlength: 64 })
  label!: string;

  /** sha256 hex of full secret — never store plaintext. */
  @Prop({ type: String, required: true, unique: true })
  tokenHash!: string;

  /** First 8 chars after `kppd_` prefix for UI list. */
  @Prop({ type: String, required: true })
  tokenPrefix!: string;

  @Prop({ type: Date, required: false, default: null })
  expiresAt!: Date | null;

  @Prop({ type: Date, required: false, default: null })
  revokedAt!: Date | null;

  @Prop({ type: Date, required: false, default: null })
  lastUsedAt!: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const DesktopPairingKeySchema = SchemaFactory.createForClass(DesktopPairingKey);
DesktopPairingKeySchema.index({ userId: 1, revokedAt: 1 });
