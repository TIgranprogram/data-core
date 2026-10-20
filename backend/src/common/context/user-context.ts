import { AsyncLocalStorage } from 'node:async_hooks';

export interface UserContextValue {
  userId: string;
  username: string;
  role: string;
  permissions: string[];
}

/**
 * Per-request user context, propagated through async boundaries via
 * AsyncLocalStorage. The `UserContextInterceptor` (TZ-04) sets this from
 * `req.user` after JwtAuthGuard; the Mongoose `userContextPlugin` (TZ-04)
 * reads it and propagates `userId` into `query.$locals.userId` for the
 * `auditPlugin` (TZ-03).
 */
export const userContext = new AsyncLocalStorage<UserContextValue>();

export function getCurrentUser(): UserContextValue | undefined {
  return userContext.getStore();
}
