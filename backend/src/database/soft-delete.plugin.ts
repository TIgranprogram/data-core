import { Query, Schema } from 'mongoose';

const NOT_DELETED = { deletedAt: null };

interface SoftDeleteQueryHelpers {
  softDelete(): Query<unknown, unknown>;
  restore(): Query<unknown, unknown>;
}

/**
 * Mongoose plugin: soft-delete.
 *
 *  - All queries (find, findOne, findOneAndUpdate, countDocuments) auto-filter
 *    `{ deletedAt: null }` unless `includeSoftDeleted: true` is passed in options
 *    or `{ deletedAt: ... }` is explicitly present in the filter.
 *  - Adds query helpers `.softDelete()` (sets deletedAt = now) and
 *    `.restore()` (clears deletedAt).
 *  - Opt-out: schemas can disable the plugin by setting `{ softDelete: false }`
 *    in the `@Schema({...})` options. Useful for system-level schemas
 *    (feature-flag, setting, counter, role, audit-log, rate-limit, permission)
 *    that don't have a `deletedAt` field and don't need soft-delete semantics.
 *    Without this opt-out, Mongoose strict mode throws on upserts that include
 *    `deletedAt` in the filter (`Path "deletedAt" is not in schema`).
 */
export function softDeletePlugin(schema: Schema): void {
  // Opt-out check — must run before any hook/helper registration.
  if (schema.get('softDelete') === false) return;

  const applyNotDeletedFilter = function (
    this: Query<unknown, unknown>,
    next: (err?: Error) => void,
  ): void {
    const options = this.getOptions() as { includeSoftDeleted?: boolean };
    if (options.includeSoftDeleted) {
      return next();
    }
    const filter = this.getFilter() as Record<string, unknown>;
    if (filter.deletedAt === undefined) {
      this.where(NOT_DELETED);
    }
    next();
  };

  schema.pre('find', applyNotDeletedFilter);
  schema.pre('findOne', applyNotDeletedFilter);
  schema.pre('findOneAndUpdate', applyNotDeletedFilter);
  schema.pre('countDocuments', applyNotDeletedFilter);

  const queryHelpers = schema.query as SoftDeleteQueryHelpers;

  queryHelpers.softDelete = function softDelete(
    this: Query<unknown, unknown>,
  ): Query<unknown, unknown> {
    this.setUpdate({ $set: { deletedAt: new Date() } });
    return this;
  };

  queryHelpers.restore = function restore(
    this: Query<unknown, unknown>,
  ): Query<unknown, unknown> {
    this.setUpdate({ $unset: { deletedAt: 1 } });
    return this;
  };
}
