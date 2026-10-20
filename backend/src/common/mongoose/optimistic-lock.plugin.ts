import { Schema } from 'mongoose';

/**
 * Ensures `__v` optimistic concurrency stays enabled.
 *
 * Do **not** manually bump `__v` in `pre('save')`: Mongoose versionKey already
 * increments on save. A previous manual `$set __v = __v+1` in this hook caused
 * VersionError on array-field updates (`photoIds`, organization `assets`) —
 * product photo save showed «Изделие уже изменено» (2026-08-11).
 *
 * (история задачи TZ-ORG-ASSETS-301 — в git kppdf-8.0)
 * @see TZ-CATALOG-339
 */
export function optimisticLockPlugin(schema: Schema): void {
  schema.set('versionKey', '__v');
}
