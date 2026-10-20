import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { UserService } from '../../user/user.service';
import { RoleService } from '../../role/role.service';
import { jwtFromRequest } from '../jwt-from-request';

export interface JwtAccessPayload {
  sub: string;
  username: string;
  role: string;
  version: number;
  orgId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    config: ConfigService,
    private readonly users: UserService,
    private readonly roles: RoleService,
  ) {
    const secret = config.get<string>('jwt.secret');
    if (!secret) throw new Error('jwt.secret not configured');
    super({
      jwtFromRequest,
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Called by Passport after the JWT signature is verified.
   * Hydrates req.user with the fresh user record (so role/permissions
   * reflect the current DB state, not the token's stale claims).
   */
  async validate(payload: JwtAccessPayload) {
    const user = await this.users.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }
    const role = await this.roles.findByName(user.role);
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions ?? [],
      rolePermissions: role?.permissions ?? [],
      organizationId: user.organizationId?.toString() ?? null,
      // TZ-AUTH-306: owner flag hydrated from DB (not trusted from the JWT
      // claim) so guards can grant owner-only bypass without a second query.
      isOwner: user.isOwner === true,
    };
  }
}
