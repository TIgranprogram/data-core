import { BadRequestException } from '@nestjs/common';

/** Кто делает запрос: роль и признак владельца (как в интерфейсе — владелец приравнен к администратору). */
export interface OverrideActor { id?: string; role?: string | null; isOwner?: boolean; username?: string }

/** Минимум от AuditService, нужный хелперу (common не импортирует modules/). */
export interface OverrideLog {
  log(entry: {
    action: string; entityType: string; entityId?: string; userId?: string; userName?: string;
    details?: { before?: Record<string, unknown>; after?: Record<string, unknown>; meta?: Record<string, unknown> };
  }): Promise<unknown>;
}

/** Администратор: роль admin или владелец (isOwner приходит с сервера из БД, не из токена). */
export const isAdminActor = (a?: OverrideActor | null): boolean => !!a && (a.role === 'admin' || a.isOwner === true);

/** Причина обхода: обязательна, от 3 символов (как stageReason заказа). Вызывать ДО записи данных. */
export function overrideReason(reason?: string | null): string {
  const r = String(reason ?? '').trim();
  if (r.length < 3) throw new BadRequestException('Администратор обходит запрет только с причиной — напишите её (от 3 символов)');
  return r.slice(0, 500);
}

export interface OverrideEntry {
  /** Код снятого блока (строка таблицы ЗЯ-1), например `supply.invoiced_fields`. */
  rule: string;
  entityType: string;
  entityId: unknown;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string;
  actor?: OverrideActor;
}

/** Ручная запись в журнал «было → стало» об обходе блока администратором. Зовётся только когда блок реально обойдён. */
export async function adminOverride(audit: OverrideLog | undefined, e: OverrideEntry): Promise<void> {
  if (!audit) return;
  const uid = e.actor?.id && /^[0-9a-f]{24}$/i.test(e.actor.id) ? e.actor.id : undefined;
  await audit.log({
    action: 'admin.override', entityType: e.entityType, entityId: e.entityId === undefined || e.entityId === null ? undefined : String(e.entityId),
    ...(uid ? { userId: uid } : {}), ...(e.actor?.username ? { userName: e.actor.username } : {}),
    details: { before: e.before, after: e.after, meta: { rule: e.rule, reason: overrideReason(e.reason) } },
  });
}
