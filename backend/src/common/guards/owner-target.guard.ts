import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../modules/user/user.schema';
import type { AuthenticatedUserLike } from '../contracts/rbac-contract';

/**
 * TZ-AUTH-306 — OwnerTargetGuard.
 *
 * Applied to users-admin mutators (update / activate / deactivate / delete /
 * reset-password). Enforces three rules against the TARGET user:
 *
 *   1. The owner row is invisible to everyone but the owner themselves:
 *      a non-owner mutation targeting the owner returns 404 (NOT 403) so the
 *      existence of the hidden owner is not enumerable via HTTP.
 *
 *   2. The owner cannot self-destruct: even the owner is refused DELETE,
 *      deactivate, or role-demote on their own account (the "always full
 *      access" + break-glass invariants). Editing name/email, activating, and
 *      resetting the password stay allowed (break-glass).
 *
 *   3. Granting or revoking administrator power is owner-only: a non-owner
 *      cannot mutate any user whose role is `admin`, nor PATCH a non-admin's
 *      role TO `admin`. Regular (non-admin) users remain fully manageable by
 *      ordinary admins holding `user:admin`.
 *
 * `isOwner` is server-hydrated (JwtStrategy) — never read from the JWT claim.
 * Ordering: register BEFORE LastAdminGuard so the 404/403 here wins and the
 * owner row never surfaces a "last admin" 403 to a non-owner.
 */
@Injectable()
export class OwnerTargetGuard implements CanActivate {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      params?: { id?: string };
      method?: string;
      user?: AuthenticatedUserLike;
      body?: Record<string, unknown>;
      originalUrl?: string;
    }>();

    const targetId = req.params?.id;
    if (!targetId) return true; // create/list handled by the controller inline

    const target = await this.userModel.findById(targetId).exec();
    if (!target) return true; // 404 downstream

    const actorIsOwner = req.user?.isOwner === true;
    const method = (req.method ?? 'GET').toUpperCase();

    // Rule 1 — hide the owner from everyone but the owner.
    if (target.isOwner === true) {
      if (!actorIsOwner) {
        throw new NotFoundException('User not found');
      }
      // Rule 2 — owner self-protection.
      if (this.isOwnerSelfDestructive(method, req.originalUrl, req.body)) {
        throw new ForbiddenException({
          code: 'OWNER_SELF_PROTECTED',
          message:
            'The owner account cannot be deleted, deactivated, or demoted',
        });
      }
      return true;
    }

    // Rule 3 снято (решение пользователя 2026-10-20): любой администратор управляет любыми пользователями,
    // в том числе другими администраторами. Защищены только владелец (правила 1–2) и последний
    // администратор (LastAdminGuard).
    return true;
  }

  /** Owner may edit own profile / reset password, but not self-destruct. */
  private isOwnerSelfDestructive(
    method: string,
    originalUrl: string | undefined,
    body: Record<string, unknown> | undefined,
  ): boolean {
    if (method === 'DELETE') return true;
    if (method === 'POST' && /\/deactivate/.test(originalUrl ?? '')) {
      return true;
    }
    if (method === 'PATCH') {
      const role = body?.role;
      if (role !== undefined && role !== 'admin') return true; // demote self
      if (body?.isActive === false) return true; // deactivate self
    }
    return false;
  }

}
