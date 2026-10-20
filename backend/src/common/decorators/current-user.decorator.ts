import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { KeyScope } from '../guards/key-scope';

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: string;
  permissions?: string[];
  version?: number;
  /** TZ-238 */
  organizationId?: string | null;
  /** TZ-AUTH-306: single hidden owner marker (server-hydrated). */
  isOwner?: boolean;
  /** P2: права машинного ключа `kppd_` (только при входе по ключу; у JWT — нет). */
  keyScope?: KeyScope;
}

/**
 * Extracts the authenticated user from the request. Set by JwtAuthGuard
 * after successful JWT validation.
 *
 * @example
 *   handler(@CurrentUser() user: AuthenticatedUser) { ... }
 */
export function getAuthenticatedUser(ctx: ExecutionContext): AuthenticatedUser {
  const req = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
  return req.user;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    getAuthenticatedUser(ctx),
);
