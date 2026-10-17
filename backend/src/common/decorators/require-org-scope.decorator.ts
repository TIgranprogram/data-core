import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key consumed by `OrgScopeGuardInterceptor`.
 * If present on a controller or method, the interceptor activates and filters
 * results to documents belonging to `req.user.organizationId` (or preserves
 * system records whose `organizationId` is null/undefined).
 */
export const REQUIRE_ORG_SCOPE = 'requireOrgScope';

/**
 * Marks a controller or method as requiring enforced organizationId scope.
 *
 * - GET endpoints: returned documents are filtered to the user's org, or
 *   the call throws `NotFoundException` if the result is empty after
 *   filtering.
 * - MUTATING endpoints (PATCH/DELETE): the interceptor enforces the same
 *   filter on the returned document; if filtered out, the response is
 *   `NotFoundException` (we deliberately do NOT leak the document's
 *   existence across org boundaries).
 *
 * Combine with `@Roles()` — composition is AND (must satisfy both). Class-
 * level decorator applies to all routes in the controller. Method-level
 * overrides class-level.
 *
 * Bypass: a system user (`req.user.organizationId` null/undefined) skips
 * the filter, allowing super-admin cross-org view. The bypass is audit-
 * logged at the AuthInterceptor layer.
 *
 * Reference: TZ-239 §2.1.
 *
 * @example
 *   @Controller('contracts')
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @UseInterceptors(OrgScopeInterceptorFor(ContractModel))
 *   @RequireOrgScope()
 *   export class ContractController { ... }
 */
export const RequireOrgScope = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_ORG_SCOPE, true);
