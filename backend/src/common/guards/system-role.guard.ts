import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role, RoleDocument } from '../../modules/role/role.schema';
import {
  effectivePermissions,
  type AuthenticatedUserLike,
} from '../contracts/rbac-contract';

/**
 * SystemRoleGuard — protects system roles from casual mutation.
 *
 * Policy (PO 2026-08-09):
 *   - PATCH of `isSystem` roles is allowed for site admins
 *     (`role.name === 'admin'` / `*` / effective `role:admin`).
 *   - DELETE of `isSystem` roles stays forbidden for everyone
 *     (service also re-checks).
 *   - Setting `isSystem: true` on a non-system role stays forbidden
 *     (escalation).
 *
 * Reads (GET) always pass.
 */
@Injectable()
export class SystemRoleGuard implements CanActivate {
  constructor(
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      method: string;
      params: Record<string, string>;
      body?: Record<string, unknown>;
      user?: AuthenticatedUserLike;
    }>();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return true;
    }
    const id = req.params['id'];
    const role =
      id && Types.ObjectId.isValid(id)
        ? await this.roleModel.findById(id).lean().exec()
        : null;

    if (
      req.method === 'PATCH' ||
      req.method === 'PUT' ||
      req.method === 'DELETE'
    ) {
      if (role && (role as { isSystem?: boolean }).isSystem === true) {
        // DELETE: always frozen. PATCH/PUT: admins only.
        if (
          req.method === 'DELETE' ||
          !this.actorCanEditSystemRoles(req.user)
        ) {
          throw new ForbiddenException({
            code: 'SYSTEM_ROLE_FROZEN',
            message:
              req.method === 'DELETE'
                ? 'System roles cannot be deleted'
                : 'System roles are editable only by administrators',
          });
        }
      }
    }
    if (req.method === 'PATCH' || req.method === 'PUT') {
      const body = req.body ?? {};
      const attempted = (body as { isSystem?: boolean }).isSystem;
      if (
        attempted === true &&
        (!role || (role as { isSystem?: boolean }).isSystem !== true)
      ) {
        throw new ForbiddenException({
          code: 'SYSTEM_ROLE_ESCALATION',
          message:
            'Cannot set isSystem: true on a non-system role (escalation refused)',
        });
      }
    }
    return true;
  }

  /** Site admin only — not director/manager with partial role:write. */
  private actorCanEditSystemRoles(user?: AuthenticatedUserLike): boolean {
    if (!user?.id || typeof user.role !== 'string') return false;
    if (user.role === 'admin') return true;
    if ((user.permissions ?? []).includes('*')) return true;
    const effective = effectivePermissions(user, {
      name: user.role,
      permissions: user.permissions ?? [],
    });
    return effective.has('role:admin');
  }
}
