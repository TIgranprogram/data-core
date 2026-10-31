import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

/** ШП-1 — ширины панелей приложения, px. Любой ключ может отсутствовать. */
export interface UiPrefs {
  sidebarW?: number;
  detailW?: number;
  filterW?: number;
  /** Ширина окна чата, px. */
  chatW?: number;
  /** Чат v2: последний открытый чат — id пользователя или `all`. */
  lastChat?: string;
  /** Вид правой панели: one | two | wide (одна колонка / две / две и широкий блок снизу). */
  panelLayout?: string;
  /** ИЗ-19: вид экрана — normal | large (крупный: всё чуть больше, фото заметно больше). */
  viewScale?: string;
}
export const UI_PREF_KEYS = ['sidebarW', 'detailW', 'filterW', 'chatW'] as const;
export const UI_PREF_STR_KEYS = ['lastChat', 'panelLayout', 'viewScale'] as const;

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

  /** Аватар: `preset:<код>` или `photo:<photoId>`. Поле добавлено (общая с CRM коллекция). */
  @Prop()
  avatar?: string;

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

  /**
   * ШП-1 — настройки интерфейса «Рабочего места» (ширины панелей:
   * `sidebarW`, `detailW`, `filterW`). Без default: у старых записей поля нет.
   * Пишет только PATCH /api/auth/me/prefs по отдельным ключам; CRM kppdf не читает.
   */
  @Prop({ type: Object })
  uiPrefs?: UiPrefs;
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
