import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BrowserDeviceGrantDocument = HydratedDocument<BrowserDeviceGrant>;

/**
 * TZ-AUTH-303 — browser-only device credential (grant).
 *
 * A random secret is stored ONLY as `tokenHash` (SHA-256); the raw secret
 * lives in the `__Host-` cookie on the device's browser. This entity is
 * deliberately separate from `DeviceInvite` and is NEVER a usable API
 * credential: it cannot be presented as `Authorization: Bearer`, as
 * `X-Access-Token`, as a JWT, or as a Desktop `kppd_` pairing key. Its only
 * accepted use is the cookie-only session / auth_request endpoints.
 *
 * `deviceName` is 1–80 chars after trim and is intentionally NOT unique —
 * multiple shared workshop PCs may carry the same label.
 */
@Schema({ softDelete: false,  collection: 'browserdevicegrants', timestamps: true })
export class BrowserDeviceGrant {
  @Prop({ required: true, unique: true, index: true })
  tokenHash!: string;

  @Prop({ required: true })
  deviceName!: string;

  @Prop({ required: true, enum: ['active', 'revoked'], index: true })
  status!: 'active' | 'revoked';

  @Prop({ required: true, index: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  lastUsedAt?: Date | null;

  @Prop({ required: true })
  activatedAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt?: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  revokedBy?: Types.ObjectId | null;

  @Prop({ required: true, type: Types.ObjectId, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, enum: ['regular', 'owner-device'] })
  inviteKind!: 'regular' | 'owner-device';
}

export const BrowserDeviceGrantSchema =
  SchemaFactory.createForClass(BrowserDeviceGrant);
