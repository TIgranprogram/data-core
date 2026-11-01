import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { canSeeMoney, canSeePayroll } from '../roles-hierarchy';

type Req = { user?: { role?: string; isOwner?: boolean } };

/** Раздел «Деньги» целиком — только с галочкой «Деньги» у роли (решение 2026-11-01). */
@Injectable()
export class MoneyAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (canSeeMoney(context.switchToHttp().getRequest<Req>().user)) return true;
    throw new ForbiddenException('Раздел «Деньги» недоступен: у вашей роли нет права на деньги');
  }
}

/** ФОТ целиком — деньги + права бухгалтера и выше. */
@Injectable()
export class PayrollAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (canSeePayroll(context.switchToHttp().getRequest<Req>().user)) return true;
    throw new ForbiddenException('Раздел «ФОТ» недоступен: у вашей роли нет права на деньги');
  }
}
