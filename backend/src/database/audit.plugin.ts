import { Query, Schema } from 'mongoose';

/**
 * Mongoose plugin: audit.
 *
 *  - On `pre('save')`: if document is new, sets `createdAt = now` and
 *    `createdBy = $locals.userId` (set by auth guard/interceptor in TZ-04).
 *    If document exists, sets `updatedAt = now` and
 *    `updatedBy = $locals.userId`.
 *  - On `pre(['updateOne', 'findOneAndUpdate', 'updateMany'])`: merges
 *    `updatedAt = now` and `updatedBy = $locals.userId` into the update's
 *    `$set` block. Creates `$set` if the update was a direct field replacement.
 *  - Requires schema to declare these fields (this plugin does NOT add
 *    them automatically — they're added per-schema for explicitness).
 */
export function auditPlugin(schema: Schema): void {
  // --- pre('save') for document .save() and Model.create() ---
  schema.pre('save', function preSaveAudit(next) {
    const now = new Date();
    const userId = (this.$locals as { userId?: unknown } | undefined)?.userId;

    if (this.isNew) {
      this.$set('createdAt', now);
      if (userId) this.$set('createdBy', userId);
    } else {
      this.$set('updatedAt', now);
      if (userId) this.$set('updatedBy', userId);
    }

    next();
  });

  // --- pre update hooks: updateOne / findOneAndUpdate / updateMany ---
  const updateAuditHook = function updateAudit(
    this: Query<unknown, unknown>,
    next: (err?: Error) => void,
  ): void {
    const now = new Date();
    // `this.$locals` is Mongoose's per-query local storage (set by Auth interceptor in TZ-04).
    // Not in public TS types — internal API, safe to assert.
    const locals = (this as unknown as { $locals?: { userId?: unknown } })
      .$locals;
    const userId = locals?.userId;

    const update = this.getUpdate();
    if (!update || typeof update !== 'object') {
      return next();
    }

    const u = update as Record<string, unknown>;

    // Case 1: update has $set operator → merge into it
    if (u.$set && typeof u.$set === 'object' && u.$set !== null) {
      const $set = u.$set as Record<string, unknown>;
      $set.updatedAt = now;
      if (userId) $set.updatedBy = userId;
      u.$set = $set;
    } else {
      // Case 2: direct field replacement (e.g., { status: 'active' }) →
      // wrap in $set so we don't clobber the user's update.
      const replacement: Record<string, unknown> = { ...u };
      const $set: Record<string, unknown> = { updatedAt: now };
      if (userId) $set.updatedBy = userId;
      // Move $-prefixed operators to top level, plain fields into $set
      const newUpdate: Record<string, unknown> = { $set };
      for (const [k, v] of Object.entries(replacement)) {
        if (k.startsWith('$')) {
          newUpdate[k] = v;
        } else {
          ($set as Record<string, unknown>)[k] = v;
        }
      }
      this.setUpdate(newUpdate);
      return next();
    }

    this.setUpdate(u);
    next();
  };

  schema.pre('updateOne', updateAuditHook);
  schema.pre('updateMany', updateAuditHook);
  schema.pre('findOneAndUpdate', updateAuditHook);
}
