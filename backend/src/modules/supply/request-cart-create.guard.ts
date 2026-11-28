import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { canCreateRequestCart } from '../../common/roles-hierarchy';

/** Проверка выполняется до кеша повторных POST, в том числе после смены прав роли. */
@Injectable()
export class RequestCartCreateGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!canCreateRequestCart(user)) throw new ForbiddenException('Для роли выключено создание заявок из каталога');
    return true;
  }
}
