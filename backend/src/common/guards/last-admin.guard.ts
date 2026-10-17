import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Reflector } from '@nestjs/core';
import { lastAdminInvariant } from '../contracts/rbac-contract';
import { User, UserDocument } from '../../modules/user/user.schema';

/**
 * TZ-257 §ШАГ 1 — last-admin invariant guard.
 *
 * Pre-check before any deactivation / delete / demote action on a user
 * whose role is `admin`. Uses `lastAdminInvariant` (TZ-254 pure helper)
 * for the boolean verdict and the canonical `LAST_ADMIN_INVARIANT`
 * reason code for the 409 conflict surface.
 *
 * Wiring:
 *
 *   @Post(':id/deactivate')
 *   @Permissions('user:admin')
 *   @UseGuards(LastAdminGuard)
 *   async deactivate(...) { ... }
 *
 * Style: this guard does NOT enforce the role gate itself — that's
 * `PermissionsGuard`/`RolesGuard`. LastAdminGuard READS the request
 * shape and asks DB: "if I were to perform the proposed action, would
 * the system have zero active admins?".
 *
 * Failure mode: throws `ForbiddenException` with reason
 * `LAST_ADMIN_INVARIANT`. Nest converts to 403 by default; we
 * intentionally let it be 403 (capability-style rejection), not 409
 * (state conflict), because the canonical policy is "you may not
 * perform this action" — the underlying data shape may legitimately
 * have multiple admins but THIS actor lacks authority to remove the
 * last one.
 *
 * Pre-condition: caller has passed `@Permissions('user:admin')` so
 * only admin actors can reach this guard.
 */
@Injectable()
export class LastAdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      params?: { id?: string };
      method?: string;
      user?: { id?: string; role?: string };
      body?: { role?: string; isActive?: boolean };
    }>();

    const targetId = req.params?.id;
    if (!targetId) return true; // nothing to validate

    const targetUser = await this.userModel.findById(targetId).exec();
    if (!targetUser) return true; // 404 is OwnershipGuard's domain

    const role = (targetUser as unknown as { role?: string }).role ?? 'user';
    const targetIsAdmin = role === 'admin';

    // Read the proposed mutation from request method + body.
    const method = (req.method ?? 'GET').toUpperCase();
    const isDeletingAdmin = method === 'DELETE';
    const currentActive = !!targetUser.isActive;

    // TZ-257.A.1 — PATCH demotion gap.
    // `body.role` was previously never consumed: the guard only read
    // `isActive`, so demoting the last active admin via
    // `PATCH /api/admin/users/:id { role: 'manager' }` slipped through.
    // A PATCH that changes an active admin's role to anything other
    // than 'admin' removes the target from the active-admin set and
    // must be evaluated exactly like a deactivation.
    const bodyRole = req.body?.role;
    const demotingActiveAdmin =
      method === 'PATCH' &&
      targetIsAdmin &&
      currentActive &&
      typeof bodyRole === 'string' &&
      bodyRole !== 'admin';

    const proposedActive =
      method === 'DELETE'
        ? false
        : demotingActiveAdmin
          ? false
          : (req.body?.isActive ?? targetUser.isActive);

    // Active admin count pre-mutation.
    //
    // `countDocuments({ role: 'admin', isActive: true })` returns the
    // number of ACTIVE admin rows in the DB. If the target IS an admin
    // AND currently active, this number INCLUDES the target. If the
    // target is non-admin or non-active, this number EXCLUDES the target.
    //
    // `lastAdminInvariant` expects "currentActiveAdminCount" to be the
    // total system-wide active admin count *up to and including* the
    // target's pre-mutation state. So:
    //
    //   targetIsAdmin && currentActive → allAdmins already includes it,
    //                                   no offset.
    //   otherwise                      → allAdmins is the count excluding
    //                                   target; we add 1 if target
    //                                   pre-mutation was an admin (which
    //                                   can't happen here because that
    //                                   branch has `currentActive=true`),
    //                                   else leave as is.
    //
    // The branch is written defensively (single delta) so future
    // mutations that bypass the pre-check still produce a valid
    // verdict.
    const allAdmins = await this.userModel.countDocuments({ role: 'admin', isActive: true }).exec();
    const currentActiveAdminCount = targetIsAdmin && currentActive ? allAdmins : allAdmins + 1;

    const verdict = lastAdminInvariant({
      currentActiveAdminCount,
      targetUserIsAdminInRole: targetIsAdmin,
      currentTargetActive: currentActive,
      proposedTargetActive: proposedActive,
      isDeletingAdmin,
    });

    if (!verdict.safe) {
      throw new ForbiddenException({
        message: 'Last admin invariant violated',
        reason: verdict.reason ?? 'LAST_ADMIN_INVARIANT',
        code: 'LAST_ADMIN_INVARIANT',
      });
    }

    return true;
  }
}
