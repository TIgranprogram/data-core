import { SetMetadata } from '@nestjs/common';
import { PERMISSION_WILDCARD } from '../contracts/rbac-contract';
import { PERMISSIONS } from '../seed/permissions.constants';

/**
 * Metadata key consumed by `PermissionsGuard` (TZ-255).
 *
 * The value is the TUPLES of canonical permission keys required to
 * invoke the handler, OR'd within the tuple (any-of match) — that is,
 * `('user:read', 'user:admin')` means "user:read OR user:admin".
 *
 * Note: Nest executes multiple guards AND-composed (each guard returns
 * boolean). `@Permissions` itself treats the keys within the decorator
 * as OR alternatives for single-resource read tier ("either of these
 * keys unlocks"). To require ALL of N keys, use a single `@Permissions`
 * call with a wildcard (which expands to the full catalog), or stack
 * decorators upstream.
 */
export const PERMISSIONS_KEY = 'permissions';

/**
 * Canonical set + Set built once at module load. The Set is used for
 * cheap O(1) `has(...)` checks in the guard and the boot validator.
 */
const CANONICAL_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  PERMISSIONS.map((p) => p.key),
);

/**
 * Canonical key lookup. Throws at decorator-construction time if any
 * non-wildcard key is not in the seeded catalog. This means a typo in a
 * `@Permissions('product:edit')` call (where the catalog has
 * `product:write`) fails the test runtime immediately, not silently.
 *
 * Why throw at construction (not in the guard)?
 *   - One error per code site, not one per request.
 *   - Path-agnostic — Decorator factories run during module scan; if
 *     a controller is loaded, its decorator runs.
 *   - Easy to unit-test (`expect(() => Permissions('bad:key')).toThrow`).
 */
function assertCanonicalKeys(keys: readonly string[]): void {
  for (const k of keys) {
    if (k === PERMISSION_WILDCARD) continue;
    if (!CANONICAL_PERMISSION_KEYS.has(k)) {
      throw new Error(
        `[TZ-255] @Permissions received non-canonical key "${k}" — ` +
          `canonical keys are listed in backend/src/common/seed/permissions.constants.ts ` +
          `or use the wildcard "${PERMISSION_WILDCARD}".`,
      );
    }
  }
}

/**
 * Mark a route handler with the canonical permission keys required to
 * invoke it. Pair with `PermissionsGuard` (registered as APP_GUARD
 * in `app.module.ts`). If NO `@Permissions()` is declared, the guard
 * passes through (true) — backward-compatible with all existing routes
 * that have only `@Roles()`.
 *
 * Pairs with TZ-251's `@OwnerOnly(...)` (mutually exclusive semantics:
 * `@Permissions` enforces capability, `@OwnerOnly` enforces ownership;
 * both can coexist and the route is blocked if EITHER fails).
 *
 * Examples:
 *   @Permissions('material:read')                 -> require material:read
 *   @Permissions('user:admin', 'role:admin')      -> require user:admin OR role:admin
 *   @Permissions('*')                              -> require any superuser (admin class or wildcard)
 */
export function Permissions(...keys: string[]): MethodDecorator & ClassDecorator {
  assertCanonicalKeys(keys);
  return SetMetadata(PERMISSIONS_KEY, keys);
}

/**
 * Exported for testability + boot validator: set of canonical keys
 * known to the rbac-contract. NOT exported as a runtime helper because
 * the seed catalog is the single source of truth.
 */
export const __TESTING_CANONICAL_PERMISSION_KEYS: ReadonlySet<string> = CANONICAL_PERMISSION_KEYS;
