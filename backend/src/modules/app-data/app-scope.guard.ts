import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Ограничение машинного ключа `kppd_` (P2). JwtAuthGuard кладёт в `req.user.keyScope`
 * scope ключа; здесь используется только список приложений. Тип объявлен локально,
 * чтобы модуль не зависел от desktop-модуля.
 */
export interface KeyScopeLike {
  access: 'read' | 'write' | 'full';
  apps?: string[];
}

export interface AppDataRequestUser {
  id: string;
  username?: string;
  role: string;
  permissions?: string[] | null;
  rolePermissions?: string[] | null;
  isOwner?: boolean;
  keyScope?: KeyScopeLike;
}

/** null — ограничения нет (JWT или ключ без списка приложений). */
export function allowedApps(user: AppDataRequestUser | undefined): string[] | null {
  const apps = user?.keyScope?.apps;
  return Array.isArray(apps) ? apps : null;
}

/** Маршруты с `:app`: если у ключа есть список приложений и `:app` в нём нет → 403. */
@Injectable()
export class AppScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: AppDataRequestUser; params?: Record<string, string> }>();
    const app = req.params?.app;
    const apps = allowedApps(req.user);
    if (app !== undefined && apps !== null && !apps.includes(app)) {
      throw new ForbiddenException(`Ключ не допускает приложение «${app}»`);
    }
    return true;
  }
}
