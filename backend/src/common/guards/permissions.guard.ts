import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import {
  effectivePermissions,
  type AuthenticatedUserLike,
} from '../contracts/rbac-contract';

/**
 * TZ-255 — Server-side permissions enforcement guard.
 *
 * Authorization ladder:
 *
 *   1. No `@Permissions()` metadata on the handler/class → pass-through.
 *      Rationale: backward-compat with all existing routes that rely on
 *      `@Roles()` only. Routes opt in to permission checks explicitly.
 *
 *   2. `req.user` missing / no `id` → 401 Unauthorized.
 *      Rationale: JwtAuthGuard populates req.user; if it didn't (e.g.
 *      `@Public()` route that the guard is wrongly registered on),
 *      fail explicitly rather than crash on `.role`.
 *
 *   3. Compute `effectivePermissions(req.user, { name: req.user.role,
 *      permissions: req.user.rolePermissions })` via TZ-254 helper. The
 *      union promotion in effectivePermissions handles BOTH:
 *        - role.name === 'admin' → all 29 catalog keys (admin shortcut)
 *        - permissions.includes('*') → all 29 catalog keys (wildcard)
 *
 *   4. Every required key (decorator args) must be present in effective
 *      OR → 403 ForbiddenException. Note: AND-composed with `@Roles`
 *      which runs as a separate APP_GUARD; BOTH must pass.
 *
 * Composability:
 *
 *   - `@Roles('admin','manager')` ∧ `@Permissions('material:write')`
 *     means: user must be admin OR manager AND must have material:write.
 *     RolesGuard handles (1); PermissionsGuard handles (2).
 *
 *   - Shared corporate data (counterparty / product / order / ...) does
 *     NOT need `@Permissions()` if the existing `@Roles()` is
 *     sufficient — for new endpoints only, the canonical contract is
 *     to BOTH add `@Roles()` (legacy compatibility) AND
 *     `@Permissions()` (capability-based for TZ-256 frontend gating).
 *
 * Failure modes:
 *   - 401 ONLY when JwtAuthGuard was bypassed (we still defend so
 *     tests don't crash). Otherwise 401 is JwtAuthGuard's domain.
 *   - 403 when authenticated but missing a required permission key.
 *   - NEVER 404 here — that's `OwnershipGuard` (TZ-251) territory.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Step 1: backward-compat pass-through.
    if (!required || required.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{
      user?: AuthenticatedUserLike;
    }>();
    const user = req.user;

    // Step 2: authenticated user required.
    if (!user || !user.id) {
      throw new UnauthorizedException('Authentication required for permission check');
    }

    // TZ-AUTH-306 — the single hidden owner always holds full access without
    // an owner-only permission key existing in the catalog. `isOwner` is
    // server-hydrated (JwtStrategy), never accepted from a JWT claim.
    if (user.isOwner === true) {
      return true;
    }

    // Step 3: compute effective permissions via TZ-254 algorithm.
    const userPerms = user.permissions ?? [];
    const rolePerms = user.rolePermissions ?? [];
    const effective = effectivePermissions(
      { permissions: userPerms },
      // Build a structurally-compatible role source — req.user.role is
      // already the canonical role name string. effectivePermissions will
      // short-circuit to all-keys promotion when name === 'admin' OR the
      // permissions include '*'.
      { name: user.role, permissions: rolePerms },
    );

    // Step 4: one required key is sufficient (OR semantics), matching the
    // decorator contract. RolesGuard remains a separate AND-composed guard.
    const hasAny = required.some((k) => effective.has(k));
    if (!hasAny) {
      throw new ForbiddenException(
        `Required permission (any of): ${required.join(', ')}`,
      );
    }

    return true;
  }
}
