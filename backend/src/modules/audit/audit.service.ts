import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { getCurrentUser } from '../../common/context/user-context';
import { AuditLog, AuditLogDocument } from './audit-log.schema';

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

  async findAll(
    filter: { entityType?: string; userId?: string; action?: string } = {},
    page = 1,
    limit = 50,
  ): Promise<{ items: AuditLogDocument[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;
    const query: Record<string, unknown> = {};
    if (filter.entityType) query.entityType = filter.entityType;
    if (filter.userId) query.userId = new Types.ObjectId(filter.userId);
    if (filter.action) query.action = filter.action;

    const [items, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);
    return { items, total, page, limit };
  }
}
