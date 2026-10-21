import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * A3: фильтры журнала аудита (GET /api/audit-logs).
 * Все параметры необязательны; неверные значения → 400 (а не 500 от new ObjectId()).
 */
export interface AuditQueryRaw {
  entityType?: string;
  /** Одна запись журнала (общая история приложения, И.2). */
  id?: string;
  action?: string;
  userId?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page?: string;
  limit?: string;
}

export const AUDIT_LIMIT_DEFAULT = 50;
export const AUDIT_LIMIT_MAX = 200;
const HEX24 = /^[0-9a-f]{24}$/i;
const NAME = /^[A-Za-z0-9_\-:.]{1,64}$/;

function parseDate(v: string, name: string, endOfDay: boolean): Date {
  // YYYY-MM-DD → граница дня (UTC); иначе — любая ISO-дата
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + (endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z')) : new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${name} — дата (YYYY-MM-DD или ISO)`);
  return d;
}

export function parseAuditQuery(raw: AuditQueryRaw): { filter: Record<string, unknown>; page: number; limit: number } {
  const page = raw.page === undefined || raw.page === '' ? 1 : Number(raw.page);
  const limit = raw.limit === undefined || raw.limit === '' ? AUDIT_LIMIT_DEFAULT : Number(raw.limit);
  if (!Number.isInteger(page) || page < 1) throw new BadRequestException('page — целое число ≥ 1');
  if (!Number.isInteger(limit) || limit < 1) throw new BadRequestException('limit — целое число ≥ 1');

  const filter: Record<string, unknown> = {};
  for (const key of ['entityType', 'action'] as const) {
    const v = raw[key]?.trim();
    if (!v) continue;
    if (!NAME.test(v)) throw new BadRequestException(`${key} — недопустимое значение`);
    filter[key] = v;
  }
  for (const key of ['userId', 'entityId'] as const) {
    const v = raw[key]?.trim();
    if (!v) continue;
    if (!HEX24.test(v)) throw new BadRequestException(`${key} — 24-символьный hex id`);
    filter[key] = new Types.ObjectId(v);
  }
  const createdAt: Record<string, Date> = {};
  if (raw.from?.trim()) createdAt.$gte = parseDate(raw.from.trim(), 'from', false);
  if (raw.to?.trim()) createdAt.$lte = parseDate(raw.to.trim(), 'to', true);
  if (createdAt.$gte && createdAt.$lte && createdAt.$gte > createdAt.$lte) {
    throw new BadRequestException('from позже to');
  }
  if (Object.keys(createdAt).length) filter.createdAt = createdAt;

  return { filter, page, limit: Math.min(limit, AUDIT_LIMIT_MAX) };
}
