import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ softDelete: false,  collection: 'users', timestamps: true })
export class User {
  @Prop({ required: true, unique: true, index: true })
  username!: string;

  /** Optional; unique when set (sparse — several users may omit email). */
  @Prop({ required: false, unique: true, sparse: true, index: true })
  email?: string;

  @Prop({ required: true })
  displayName!: string;

  @Prop({ required: true })
  passwordHash!: string;

  /**
   * Single role name (string) for simplicity (per TZ-04).
   * Can be extended to `string[]` later if multi-role users are needed.
   */
  @Prop({ required: true, index: true })
  role!: string;

  @Prop({ type: [String], default: [] })
  permissions!: string[];

  @Prop({ default: true })
  isActive!: boolean;

  @Prop()
  lastLoginAt?: Date;

  @Prop()
  phone?: string;

  /** Bumped on logout / change-password to invalidate all refresh tokens. */
  @Prop({ default: 0 })
  refreshTokenVersion!: number;

  /** TZ-238: organization this user belongs to. Null for system (bootstrap) admin. */
  @Prop({ required: false, sparse: true, index: true })
  organizationId?: Types.ObjectId;

  @Prop()
  fullName?: string;

  /**
   * TZ-AUTH-306 — immutable system ownership marker, NOT a role and NOT a
   * permission checkbox. Exactly one User may have `isOwner: true`; it is
   * the single hidden bootstrap owner. The partial unique index below
   * enforces the "at most one true" invariant at the database level, and
   * `OwnerBackfill` (admin.seed.ts) pins that single owner to the exact
   * `ADMIN_USERNAME` bootstrap admin at startup. Never exposed in create /
   * update DTOs, so it cannot be granted via role name or mass assignment.
   */
  @Prop({ default: false })
  isOwner!: boolean;

  /**
   * TZ-AUTH-303 — distinguishes human accounts (`person`, the default and
   * pre-existing behaviour) from device accounts (`device`, created by a
   * regular invite activation). Device accounts have no user password and
   * never log in with username/password — access flows through a
   * `BrowserDeviceGrant` cookie. Password reset for `device` is rejected.
   */
  @Prop({ default: 'person', index: true })
  accountType!: 'person' | 'device';
}

export const UserSchema = SchemaFactory.createForClass(User);

/**
 * TZ-AUTH-306 — partial unique index: only documents where `isOwner: true`
 * are indexed, and only one such document may exist. Documents with
 * `isOwner: false`/absent are not indexed at all (no uniqueness constraint
 * between ordinary users). This is the DB-level "exactly one owner" gate;
 * the bootstrap backfill plus `OwnerTargetGuard` enforce it at the app layer.
 */
UserSchema.index(
  { isOwner: 1 },
  { unique: true, partialFilterExpression: { isOwner: true } },
);
