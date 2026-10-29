import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { getCurrentUser } from '../../common/context/user-context';
import { AuditLog, AuditLogDocument } from './audit-log.schema';
import { AuditQueryRaw, parseAuditQuery } from './audit-query';
import { User, UserDocument } from '../user/user.schema';
import { actionRu } from './action-ru';
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
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  /** Имена авторов одним запросом на страницу: displayName / fullName, иначе логин. */
  async actorNames(docs: Array<{ userId?: unknown; userName?: string | null }>): Promise<Map<string, string>> {
    const ids = [...new Set(docs.map((d) => (d.userId ? String(d.userId) : '')).filter((x) => /^[0-9a-f]{24}$/i.test(x)))];
    const map = new Map<string, string>();
    if (!ids.length) return map;
    const users = await this.userModel.find({ _id: { $in: ids } }, { displayName: 1, fullName: 1, username: 1 }).lean<Array<{ _id: Types.ObjectId; displayName?: string; fullName?: string; username?: string }>>().exec();
    for (const u of users) map.set(String(u._id), u.displayName || u.fullName || u.username || '');
    return map;
  }

  /** Имя автора записи: из users, иначе имя в записи журнала. */
  actorOf(names: Map<string, string>, d: { userId?: unknown; userName?: string | null }): string | null {
    return (d.userId ? names.get(String(d.userId)) : '') || d.userName || null;
  }

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
      // id не ObjectId (заказчик «c:<название>», ключ справочника) — не в entityId (там ObjectId), а в details.id
      const strId = typeof entry.entityId === 'string' ? entry.entityId : null;
      const okId = strId !== null && Types.ObjectId.isValid(strId) && /^[0-9a-f]{24}$/i.test(strId);
      const details = strId !== null && !okId ? { ...(entry.details ?? {}), id: (entry.details as { id?: unknown } | undefined)?.id ?? strId } : entry.details;
      await this.model.create({
        action: entry.action,
        entityType: entry.entityType,
        entityId: strId !== null ? (okId ? new Types.ObjectId(strId) : undefined) : entry.entityId,
        userId: userId ? new Types.ObjectId(userId) : undefined,
        userName,
        details,
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
    const names = await this.actorNames(docs);
    return {
      items: docs.map((d) => ({ ...(sanitizeValue(d) as object), actionRu: actionRu(d.action, d.entityType), actorName: this.actorOf(names, d) })),
      total, page, limit,
    };
  }

  /** История одной записи (И.1): по entityId (ObjectId) или details.id (строковые id), сначала новые. */
  async recordLogs(entityType: string, entityId: string, limit = 100) {
    const or: Record<string, unknown>[] = [{ 'details.id': entityId }];
    if (/^[0-9a-f]{24}$/i.test(entityId)) or.push({ entityId: new Types.ObjectId(entityId) });
    return this.model.find({ entityType, $or: or }).sort({ createdAt: -1 }).limit(limit).lean().exec();
  }

  /** Общий журнал приложения (И.2): только типы записей приложения, фильтры кто / раздел / даты. */
  async appLogs(raw: AuditQueryRaw, types: string[]) {
    const { filter, page, limit } = parseAuditQuery(raw);
    if (filter.entityType && !types.includes(String(filter.entityType))) throw new BadRequestException('Такого раздела нет в истории приложения');
    if (!filter.entityType) filter.entityType = { $in: types };
    if (raw.id && /^[0-9a-f]{24}$/i.test(String(raw.id))) filter._id = new Types.ObjectId(String(raw.id)); // одна запись журнала (карточка)
    const [docs, total] = await Promise.all([
      this.model.find(filter, { action: 1, entityType: 1, entityId: 1, userId: 1, userName: 1, createdAt: 1, 'details.id': 1, 'details.after.title': 1, 'details.after.name': 1, 'details.after.num': 1, 'details.after.orderNo': 1, 'details.after.materialName': 1 })
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    const names = await this.actorNames(docs);
    const items = docs.map((d) => {
      const det = (d.details ?? {}) as { id?: unknown; after?: Record<string, unknown> };
      const a = det.after ?? {};
      const title = [a.num ? `№${a.num}` : a.orderNo ? `№${a.orderNo}` : '', a.title ?? a.name ?? a.materialName ?? ''].filter(Boolean).join(' ');
      return { id: String(d._id), createdAt: (d as { createdAt?: Date }).createdAt, action: d.action, entityType: d.entityType,
        entityId: d.entityId ? String(d.entityId) : det.id ? String(det.id) : null, userName: d.userName ?? null, actorName: this.actorOf(names, d), actionRu: actionRu(d.action, d.entityType), title: title || null };
    });
    return { items, total, page, limit };
  }

  /** Кто менял (для фильтра «кто» общего журнала приложения). */
  async appUsers(types: string[]) {
    const users = await this.model.aggregate<{ _id: Types.ObjectId; userName?: string }>([
      { $match: { entityType: { $in: types }, userId: { $ne: null } } },
      { $group: { _id: '$userId', userName: { $last: '$userName' } } },
      { $limit: 500 },
    ]).exec();
    return users.map((u) => ({ value: String(u._id), label: u.userName || String(u._id) })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
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
