import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_SECTION_KEY } from '../decorators/app-section.decorator';
import { appSectionLabel, openSectionsFor, sectionOpen } from '../app-sections';

/**
 * SK-8d: сервер не отдаёт данные разделов, закрытых для роли (галочки
 * `roles.appSections`). Глобальный, после RolesGuard: JWT → Permissions →
 * Roles → AppSection. Нет пометки / `[]` / нет пользователя / без ограничений
 * (владелец, admin, роль без галочек) — пропуск. Разделы — из кэша в памяти.
 */
@Injectable()
export class AppSectionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const ids = this.reflector.getAllAndOverride<string[] | undefined>(APP_SECTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!ids || ids.length === 0) return true;
    const req = context.switchToHttp().getRequest<{ user?: { role?: string; isOwner?: boolean } }>();
    const open = openSectionsFor(req.user);
    if (!open || ids.some((id) => sectionOpen(open, id))) return true;
    throw new ForbiddenException(`Раздел «${appSectionLabel(ids[0])}» для вашей роли закрыт`);
  }
}
