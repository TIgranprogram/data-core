import { Query, Schema } from 'mongoose';
import { getCurrentUser } from '../common/context/user-context';

/**
 * Mongoose plugin: user-context propagation.
 *
 * Reads the request-scoped `userId` from AsyncLocalStorage (set by
 * `UserContextInterceptor` after JwtAuthGuard) and injects it into the
 * query's `$locals.userId`. The `auditPlugin` (TZ-03) then uses
 * `$locals.userId` to populate `createdBy` / `updatedBy`.
 *
 * Applied to: all query hooks + save hook (documents).
 */
export function userContextPlugin(schema: Schema): void {
  const propagate = function propagate(
    this: Query<unknown, unknown> | { $locals?: Record<string, unknown> },
    next: (err?: Error) => void,
  ): void {
    const ctx = getCurrentUser();
    if (ctx?.userId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const self = this as any;
      self.$locals = { ...(self.$locals ?? {}), userId: ctx.userId };
    }
    next();
  };

  schema.pre('find', propagate);
  schema.pre('findOne', propagate);
  schema.pre('findOneAndUpdate', propagate);
  schema.pre('updateOne', propagate);
  schema.pre('updateMany', propagate);
  schema.pre('countDocuments', propagate);
  schema.pre('save', propagate);
}
