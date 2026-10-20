import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { getCurrentUser } from '../../common/context/user-context';
import { AuditLog, AuditLogDocument } from './audit-log.schema';
import { AuditQueryRaw, parseAuditQuery } from './audit-query';
import { sanitizeValue } from '../admin/collection-docs';

export interface LogEntry {
  action: string;
  entityType: string;
  entityId?: string | Types.ObjectId;
  details?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    meta?: Record<string, unknown>;
  };
  packageTag?: string;
  ipAddress?: string;
  userId?: string;
  userName?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name)
    private readonly model: Model<AuditLogDocument>,
  ) {}

  /**
   * Fire-and-forget log. Reads userId/userName from AsyncLocalStorage
   * (set by UserContextInterceptor, TZ-04). Never throws — failures
   * here must not break the main request.
   */
  async log(entry: LogEntry): Promise<void> {
    try {
      // Prefer explicitly passed userId/userName (from interceptor) over
      // AsyncLocalStorage context (which may have lost scope in async tap()).
      const ctx = getCurrentUser();
      const userId = entry.userId ?? ctx?.userId;
      const userName = entry.userName ?? ctx?.username;
      await this.model.create({
        action: entry.action,
        entityType: entry.entityType,
        entityId:
          typeof entry.entityId === 'string'
            ? new Types.ObjectId(entry.entityId)
            : entry.entityId,
        userId: userId ? new Types.ObjectId(userId) : undefined,
        userName,
        details: entry.details,
        packageTag: entry.packageTag,
        ipAddress: entry.ipAddress,
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log: ${(err as Error).message}`,
      );
    }
  }

  /** A3: журнал постранично с фильтрами; details очищены от секретов. */
  async findAll(raw: AuditQueryRaw = {}): Promise<{ items: unknown[]; total: number; page: number; limit: number }> {
    const { filter, page, limit } = parseAuditQuery(raw);
    const [docs, total] = await Promise.all([
      this.model.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { items: docs.map((d) => sanitizeValue(d)), total, page, limit };
  }

  /** A3: значения для фильтров журнала (типы сущностей, действия, пользователи). */
  async facets(): Promise<{ entityTypes: string[]; actions: string[]; users: { userId: string; userName: string }[] }> {
    const [entityTypes, actions, users] = await Promise.all([
      this.model.distinct('entityType').exec(),
      this.model.distinct('action').exec(),
      this.model
        .aggregate<{ _id: Types.ObjectId; userName?: string }>([
          { $match: { userId: { $ne: null } } },
          { $group: { _id: '$userId', userName: { $last: '$userName' } } },
          { $limit: 500 },
        ])
        .exec(),
    ]);
    return {
      entityTypes: (entityTypes as string[]).filter(Boolean).sort(),
      actions: (actions as string[]).filter(Boolean).sort(),
      users: users
        .map((u) => ({ userId: String(u._id), userName: u.userName || String(u._id) }))
        .sort((a, b) => a.userName.localeCompare(b.userName)),
    };
  }
}
