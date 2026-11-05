import { BadRequestException, ForbiddenException } from '@nestjs/common';

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
  if (r.length < 3) throw new BadRequestException({ statusCode: 400, message: 'Администратор обходит запрет только с причиной — напишите её (от 3 символов)', error: 'Bad Request', code: 'REASON_REQUIRED' });
  return r.slice(0, 500);
}

/** Два шага обхода с последствиями (ЗЯ-1b): `dryRun` отдаёт план, подтверждение — `confirm: true` и причина. */
export interface OverridePlan {
  dryRun: true;
  /** false — есть блокировка (blockers), выполнить нельзя. */
  canProceed: boolean;
  warnings: string[];
  blockers: string[];
  /** Связанное действие, которое сервер выполнит сам (для подписи в диалоге). */
  relatedAction: string;
}

/** Только администратор: иначе 403 (роль не расширяем). */
export function assertAdminActor(a: OverrideActor | undefined | null, what: string): void {
  if (!isAdminActor(a)) throw new ForbiddenException(`${what} — только администратор`);
}

/** Подтверждение второго шага: `confirm: true` обязателен, затем причина (≥3 символов). Возвращает причину. */
export function overrideConfirm(dto: { confirm?: boolean; reason?: string }): string {
  if (dto.confirm !== true) throw new BadRequestException('Подтвердите действие: confirm = true и причина');
  return overrideReason(dto.reason);
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
