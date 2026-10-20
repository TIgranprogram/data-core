/**
 * TypeScript module augmentation for mongoose.
 *
 * Extends `SchemaOptions` to include the `softDelete` opt-out flag used by the
 * global `softDeletePlugin` (see `backend/src/database/soft-delete.plugin.ts`).
 *
 * Schemas that should NOT participate in soft-delete (system-level configs:
 * feature-flag, setting, counter, role, audit-log, rate-limit, permission) opt
 * out via `@Schema({ ..., softDelete: false })`. The plugin checks
 * `schema.get('softDelete') === false` and returns early without registering
 * any pre-hooks or query helpers, so Mongoose strict mode does not throw on
 * upserts that include `deletedAt` in the filter.
 *
 * Without this declaration, TypeScript rejects the unknown `softDelete` key
 * with `TS2353: Object literal may only specify known properties` because
 * mongoose's `SchemaOptions` interface does not include custom fields.
 */

import 'mongoose';

declare module 'mongoose' {
  interface SchemaOptions {
    /**
     * Opt-out flag for the global `softDeletePlugin`.
     * Set to `false` in `@Schema({ softDelete: false })` to disable
     * auto-`deletedAt: null` filtering on find/findOne/findOneAndUpdate/countDocuments.
     * Useful for system-level schemas that don't have a `deletedAt` field.
     */
    softDelete?: boolean;
  }
}
