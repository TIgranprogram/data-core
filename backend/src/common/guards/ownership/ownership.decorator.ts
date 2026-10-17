import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for @OwnerOnly.
 *
 * Picked up by `OwnershipGuard.canActivate()` (via Reflector) to look up the
 * owner column for this entity in `OWNERSHIP_BY_ENTITY`. If the value is
 * `null` in the contract matrix, the guard short-circuits to `true`
 * (shared corporate data — RBAC + roles are solely responsible).
 */
export const OWNER_ONLY_KEY = 'ownerOnly';

/**
 * Restricts an endpoint to the resource owner (or admin with `*` wildcard).
 *
 * Pair with `OwnershipGuard` registered at the controller/method level.
 * Most usage: `@OwnerOnly('documentTemplate')` on `:id` mutation routes.
 *
 * The decorator is INTENTIONALLY weak — by itself it does nothing. It is a
 * metadata marker that `OwnershipGuard` reads. This keeps the decorator
 * side-effect-free and unit-testable without registering the guard fixture.
 *
 * Security model (TZ-251 §ШАГ 4):
 *  - 401 Unauthorized — no JWT (separate JWT guard, independent of this one)
 *  - 403 Forbidden    — RBAC/role mismatch (`RolesGuard` / future `PermissionsGuard`)
 *  - 404 Not Found    — resource missing OR ownership mismatch (no enumeration leak)
 *
 * @example
 *   @Patch(':id')
 *   @Roles('admin', 'manager')
 *   @OwnerOnly('documentTemplate')
 *   update(...) { ... }
 */
export const OwnerOnly = (entityKey: string) => SetMetadata(OWNER_ONLY_KEY, entityKey);
