import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { User, UserDocument } from '../../modules/user/user.schema';
import { Role, RoleDocument } from '../../modules/role/role.schema';
import { userActivityCache } from './user-activity-cache';
import {
  DesktopPairingKeyService,
  isPairingKeyBearer,
} from '../../modules/desktop/desktop-pairing-key.service';
import { JWT_ACCESS_HEADER } from '../../modules/auth/jwt-from-request';

function firstHeader(
  value: string | string[] | undefined,
): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && value[0]) return String(value[0]).trim();
  return '';
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
    private readonly pairingKeys: DesktopPairingKeyService,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: { id?: string; role?: string };
    }>();
    // Prefer X-Access-Token for pairing keys so Authorization can stay
    // HTTP Basic (nginx «подъезд») — same pattern as SPA JWT hotfix.
    const xAccess = firstHeader(req.headers?.[JWT_ACCESS_HEADER]);
    const authHeader = firstHeader(req.headers?.authorization);
    const bearer = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const pairingToken = isPairingKeyBearer(xAccess)
      ? xAccess
      : isPairingKeyBearer(bearer)
        ? bearer
        : '';

    if (pairingToken) {
      req.user = await this.pairingKeys.authenticateBearer(pairingToken);
    } else {
      const ok = await super.canActivate(context);
      if (!ok) {
        return false;
      }
    }

    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException('No user context');
    }

    const activity = await userActivityCache.getOrFetch(userId, async () => {
      const dbUser = await this.userModel.findById(userId).lean().exec();
      if (!dbUser || dbUser.isActive === false) {
        return { active: false, reason: 'user_inactive' };
      }
      if (dbUser.role) {
        const role = await this.roleModel.findOne({ name: dbUser.role }).lean().exec();
        if (!role || role.isActive === false) {
          return { active: false, reason: 'role_inactive' };
        }
      }
      return { active: true };
    });

    if (!activity.active) {
      throw new UnauthorizedException(`User access revoked: ${activity.reason}`);
    }

    return true;
  }
}
