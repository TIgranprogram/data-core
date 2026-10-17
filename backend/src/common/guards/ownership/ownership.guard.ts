import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  OWNER_ONLY_KEY,
} from './ownership.decorator';
import {
  OWNERSHIP_BY_ENTITY,
  type AuthenticatedUserLike,
  isUserOwnedEntity,
} from '../../contracts/rbac-contract';
import {
  DocumentTemplate,
  DocumentTemplateDocument,
} from '../../../modules/document-template/document-template.schema';

/**
 * TZ-251 §ШАГ 2 — Object-level ownership guard.
 *
 * Pair with `@OwnerOnly('documentTemplate')` on `:id` mutation routes.
 *
 * Authorization ladder (must run AFTER `JwtAuthGuard` + `RolesGuard`):
 *
 *   1. No `@OwnerOnly()` metadata on the handler → pass-through (true).
 *      Rationale: only the routes that opt in are guarded.
 *
 *   2. Entity key not in `OWNERSHIP_BY_ENTITY` → pass-through.
 *      Rationale: legacy or unregistered entity — don't break callers.
 *
 *   3. `OWNERSHIP_BY_ENTITY[key] === null` (shared corporate data) →
 *      pass-through. RBAC + `@Roles` + `@Permissions` are the only
 *      enforcement layer; this guard has nothing to say.
 *
 *   4. Authenticated user missing on `req.user` → 401 Unauthorized.
 *      Rationale: the route was guarded by JwtAuthGuard, but tests or
 *      unusual providers may not populate req.user — fail explicitly
 *      rather than crash on `req.user.role`.
 *
 *   5. Admin wildcard (`role === 'admin'` AND permission includes `'*'`)
 *      → allow. Rationale: canonical escape hatch documented in
 *      `rbac-contract.ts §System roles` (admin role with wildcard).
 *
 *   6. Resource not found → 404 NotFoundException.
 *      Rubric: do not leak existence via 403.
 *
 *   7. Resource has no owner field (legacy data) → allow. Rationale:
 *      pre-TZ-251 documents were implicitly owned by the org, mutations
 *      already passed `@Roles('admin','manager')`. Existing behavior is
 *      preserved by deferring to RBAC. A migration TZ will follow up
 *      to backfill `createdBy` for legacy rows.
 *
 *   8. Owner = req.user.id → allow.
 *
 *   9. Owner ≠ req.user.id → 404 NotFoundException.
 *      Rationale: TZ-251 §ШАГ 4 — 404 avoids enumeration
 *      («exists but not yours» leaks existence to attackers).
 *
 * The ladder is deliberately explicit so each step is independently
 * testable in the unit spec and so the failure mode is always one of
 * {401, 404} — never 500.
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectModel(DocumentTemplate.name)
    private readonly documentTemplateModel: Model<DocumentTemplateDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const entityKey = this.reflector.getAllAndOverride<string | undefined>(
      OWNER_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Steps 1 + 2: no metadata, or unknown key → no restriction.
    if (!entityKey || !isUserOwnedEntity(entityKey)) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{
      user?: AuthenticatedUserLike;
      params?: Record<string, string>;
    }>();
    const user = req.user;

    // Step 4.
    if (!user || !user.id) {
      throw new UnauthorizedException('Authentication required for ownership check');
    }

    // Step 5: admin wildcard.
    //
    // OR-semantics aligned with TZ-254's `effectivePermissions` algorithm:
    //   - role.name === 'admin'          → all permissions (role shortcut)
    //   - permissions.includes('*')     → all permissions (explicit wildcard)
    //
    // Either alone is sufficient. We deliberately do NOT require BOTH
    // conditions because the seed gives admin users `permissions: []`
    // (the role itself carries the wildcard). Requiring both would lock
    // out a freshly-seeded admin from every @OwnerOnly route — an
    // IDOR false-negative on the most privileged user.
    //
    // The canonical algorithm lives in `effectivePermissions(user, role)`
    // in rbac-contract.ts. We do not call it here because `req.user` does
    // not carry a resolved `Role` object — the JWT strategy passes only
    // `id`, `role`, `permissions`. Mirroring the OR condition by hand is
    // acceptable; if more complex authorization is added later, this
    // guard should consume a RequestContext that resolves the full user
    // + role pair.
    const isAdminClass = user.role === 'admin';
    const hasExplicitWildcard = (user.permissions ?? []).includes('*');
    if (isAdminClass || hasExplicitWildcard) {
      return true;
    }

    const id = req.params?.id;
    if (!id || !Types.ObjectId.isValid(id)) {
      // Malformed id — treat as 404 (don't reveal resource existence).
      throw new NotFoundException('Resource not found');
    }

    // Step 6 + 7 + 8 + 9: load document and compare.
    const ownerColumn = OWNERSHIP_BY_ENTITY[entityKey];
    const doc = await this.lookupDocument(entityKey, id);
    // Step 6.
    if (!doc) throw new NotFoundException('Resource not found');

    // Step 7: legacy data — no owner column set.
    // Fall through to RBAC role check (already passed in ladder).
    const ownerValue = ownerColumn ? (doc as Record<string, unknown>)[ownerColumn] : undefined;
    if (!ownerValue) return true;

    // Step 8 — owner match.
    const ownerString =
      typeof ownerValue === 'string' ? ownerValue : (ownerValue as Types.ObjectId).toString();
    if (ownerString === user.id) return true;

    // Step 9 — owner mismatch. Return 404, not 403.
    throw new NotFoundException('Resource not found');
  }

  /**
   * Look up the document by id. Each supported entity needs an explicit
   * branch — Mongoose models are nominal types, not polymorphic. Adding
   * a new entity means (a) injecting the model into this guard,
   * (b) extending `OWNERSHIP_BY_ENTITY` in rbac-contract.ts, and
   * (c) adding a branch here.
   *
   * Returning `null` triggers the 404 branch in canActivate().
   */
  private async lookupDocument(
    entityKey: string,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    if (entityKey === 'documentTemplate') {
      const doc = await this.documentTemplateModel.findById(id).lean().exec();
      return doc;
    }
    // Defensive: caller may have passed a key that isUserOwnedEntity()
    // accepted but the guard doesn't yet have the model. Future-proof:
    // new entities WILL be added here as they get registered with the
    // contract.
    return null;
  }
}
