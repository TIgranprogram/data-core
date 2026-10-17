import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUserLike } from '../contracts/rbac-contract';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Roles() → no role-based restriction
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{
      user?: AuthenticatedUserLike;
    }>();

    // TZ-AUTH-306 — the single hidden owner always passes role gates
    // without enumerating an owner-only role name. `isOwner` is
    // server-hydrated (JwtStrategy) and can never be spoofed via JWT.
    if (req.user?.isOwner === true) {
      return true;
    }

    const userRole = req.user?.role;

    if (!userRole || !requiredRoles.includes(userRole)) {
      throw new ForbiddenException(
        `Required role: ${requiredRoles.join(' | ')}, got: ${userRole ?? 'none'}`,
      );
    }

    return true;
  }
}
