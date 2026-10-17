import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUserLike } from '../contracts/rbac-contract';

/**
 * TZ-AUTH-306 — OwnerOnlyGuard.
 *
 * Allows a route only for the single hidden owner (`req.user.isOwner === true`).
 * Used on owner-only surfaces that are NOT part of the grantable permission
 * catalog: role CRUD + permissions matrix (roles-admin / permissions-admin).
 *
 * Policy:
 *   - non-owner → single safe 403 with `code: OWNER_ONLY` (no enumeration of
 *     what the owner surface looks like).
 *   - owner → pass.
 *
 * `isOwner` is hydrated server-side by JwtStrategy from the DB (never read
 * from a JWT claim), so this guard cannot be spoofed.
 */
@Injectable()
export class OwnerOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      user?: AuthenticatedUserLike;
    }>();
    if (req.user?.isOwner === true) {
      return true;
    }
    throw new ForbiddenException({
      code: 'OWNER_ONLY',
      message: 'This action is available only to the system owner',
    });
  }
}
