import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DeviceInviteDocument = HydratedDocument<DeviceInvite>;

/**
 * TZ-AUTH-303 — one-time device invite.
 *
 * Two kinds:
 *   - `regular`:      carries a preselected ACTIVE `role` (server-side); the
 *                     public activation CANNOT override it. `ownerUserId` is
 *                     absent.
 *   - `owner-device`: carries an immutable `ownerUserId` (the single hidden
 *                     owner); `role` is absent. Created only by the owner
 *                     after a password step-up, with a short 15-minute TTL.
 *
 * Only `secretHash` (SHA-256) and a display-only `secretPrefix` are stored —
 * the raw secret is returned exactly once at creation time.
 */
@Schema({ softDelete: false,  collection: 'deviceinvites', timestamps: true })
export class DeviceInvite {
  @Prop({ required: true, unique: true, index: true })
  secretHash!: string;

  @Prop({ required: true })
  secretPrefix!: string;

  @Prop({ required: true, enum: ['regular', 'owner-device'], index: true })
  kind!: 'regular' | 'owner-device';

  @Prop({ required: false })
  role?: string;

  @Prop({ required: false, type: Types.ObjectId, index: true })
  ownerUserId?: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  createdBy!: Types.ObjectId;

  @Prop({ required: true })
  deviceTtlDays!: number;

  @Prop({ required: true, index: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  consumedAt?: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  consumedGrantId?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  revokedAt?: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  revokedBy?: Types.ObjectId | null;
}

export const DeviceInviteSchema = SchemaFactory.createForClass(DeviceInvite);
