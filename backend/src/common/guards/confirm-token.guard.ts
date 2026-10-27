import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { verifyConfirmToken } from '../confirm-token';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Удаление/восстановление в корзине: не-admin подтверждает свой пароль (POST /api/auth/confirm)
 * и шлёт токен в заголовке `X-Confirm-Token`. Admin и машинные ключи `kppd_` — без токена.
 */
@Injectable()
export class ConfirmTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser; headers: Record<string, unknown> }>();
    const u = req.user;
    if (!u || u.keyScope || u.role === 'admin') return true;
    if (verifyConfirmToken(req.headers['x-confirm-token'], u.id)) return true;
    throw new ForbiddenException({ code: 'CONFIRM_REQUIRED', message: 'Нужен пароль' });
  }
}
