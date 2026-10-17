import { CallHandler, ExecutionContext, Injectable, NestInterceptor, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { REQUIRE_ORG_SCOPE } from '../decorators/require-org-scope.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Document-shape contract: any document that may carry `organizationId`.
 * The interceptor only reads `organizationId`; it does not mutate docs.
 */
interface OrgScopedDoc {
  organizationId?: string | null;
}

/**
 * TZ-239 §2.2: OrgScopeGuardInterceptor.
 *
 * Reads the `@RequireOrgScope()` decorator metadata and, if present,
 * post-processes the controller's response to filter documents by
 * `req.user.organizationId`:
 *
 * - Single doc: if the doc's `organizationId` does not match the user's
 *   organization, `NotFoundException` is thrown (we deliberately do NOT
 *   return 403 — that would leak existence of cross-org resources).
 * - Array of docs: filters out cross-org entries; the array is returned
 *   as-is. If the array becomes empty, the GETTER sees `[]` (consistent
 *   with "no documents the user can see exist").
 * - System user (`req.user.organizationId` null/undefined): bypassed
 *   with a no-op pass-through, allowing bootstrap admin cross-org view.
 *
 * IMPORTANT: This interceptor runs AFTER the handler, so it sees the
 * already-materialized response value. It does NOT modify query
 * construction; it only filters results.
 *
 * Design note: the model bound to the controller is unused by the
 * interceptor (the response is already materialized). The factory
 * `OrgScopeInterceptorFor()` below does NOT need to inject a Mongoose
 * Model — only the Reflector is needed.
 */
@Injectable()
export class OrgScopeGuardInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isOrgScoped = this.reflector.getAllAndOverride<boolean>(REQUIRE_ORG_SCOPE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!isOrgScoped) return next.handle();

    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const userOrgId = req.user?.organizationId ?? null;

    if (!userOrgId) {
      // System (bootstrap) user → bypass scope filter.
      return next.handle();
    }

    return next.handle().pipe(map((value) => this.filterValue(value, userOrgId)));
  }

  private filterValue(value: unknown, userOrgId: string): unknown {
    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
      return value.filter((doc) => this.belongsToOrg(doc, userOrgId));
    }

    if (this.hasOrgField(value)) {
      if (!this.belongsToOrg(value, userOrgId)) {
        throw new NotFoundException('Not found');
      }
      return value;
    }

    // Non-document value (e.g. boolean from a status endpoint, plain
    // primitive, or DTO shape with no organizationId key). Pass through.
    return value;
  }

  private hasOrgField(value: unknown): value is OrgScopedDoc {
    return typeof value === 'object' && value !== null && 'organizationId' in value;
  }

  private belongsToOrg(doc: unknown, userOrgId: string): boolean {
    if (!doc || typeof doc !== 'object') return true;
    const orgIdRaw = (doc as OrgScopedDoc).organizationId;
    if (orgIdRaw === null || orgIdRaw === undefined) {
      // Legacy / system records without organizationId are global.
      return true;
    }
    return this.normalizeOrgId(orgIdRaw) === userOrgId;
  }

  /** Handles raw ObjectId strings and populated `{ _id }` refs from `.populate()`. */
  private normalizeOrgId(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && '_id' in value) {
      return String((value as { _id: unknown })._id);
    }
    return String(value);
  }
}

/**
 * Stable class returned by the factory. NestJS DI must register this exact
 * class name as a provider via `@UseInterceptors(OrgScopeInterceptorFor())`
 * per controller. Returning a fresh anonymous class per factory call
 * would create multiple DI providers with distinct identity, which can
 * cause subtle duplicate-provider registration bugs. Hence, this factory
 * returns the SAME stable class each call — controllers share one DI
 * registration class but are bound to different model contexts at the
 * class-level decorator site (no model captivation needed since the
 * interceptor is response-shape-driven, not model-query-driven).
 *
 * Historical note: an earlier revision captured `model` into a private
 * field as a TypeScript type witness, but the model was never queried.
 * Since the interceptor logic reads only `req.user.organizationId` and
 * the response value's `organizationId`, no per-collection capture is
 * needed. The factory is now a stable identity marker only.
 */
@Injectable()
export class BoundOrgScopeInterceptor extends OrgScopeGuardInterceptor {
  constructor(reflector: Reflector) {
    super(reflector);
  }
}

export function OrgScopeInterceptorFor(): typeof BoundOrgScopeInterceptor {
  return BoundOrgScopeInterceptor;
}
