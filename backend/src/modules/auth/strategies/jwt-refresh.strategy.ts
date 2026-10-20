import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { UserService } from '../../user/user.service';
import { jwtFromRequest } from '../jwt-from-request';

export interface JwtRefreshPayload {
  sub: string;
  version: number;
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  private readonly logger = new Logger(JwtRefreshStrategy.name);

  constructor(
    config: ConfigService,
    private readonly users: UserService,
  ) {
    const secret = config.get<string>('jwt.refreshSecret');
    if (!secret) throw new Error('jwt.refreshSecret not configured');
    super({
      jwtFromRequest,
      ignoreExpiration: false,
      secretOrKey: secret,
      passReqToCallback: false,
    });
  }

  /**
   * Validates the refresh token. Confirms the user still exists, is
   * active, and that the token's version matches the current
   * `refreshTokenVersion` (so a logged-out user can't reuse old tokens).
   */
  async validate(payload: JwtRefreshPayload) {
    const user = await this.users.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }
    if (user.refreshTokenVersion !== payload.version) {
      throw new UnauthorizedException('Refresh token revoked');
    }
    return { id: user.id, version: user.refreshTokenVersion };
  }
}
