import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { oid, parseList } from '../../common/list-query';
import { kindFilter, kindOf, unreadCounts, type NoticeKind } from './notification-kind';
import { Notification, type NotificationDocument } from './notification.schema';

export interface NewNotice {
  userId: Types.ObjectId | string;
  type: string;
  text: string;
  sub?: string;
  href?: string;
  fromUserId?: Types.ObjectId | string;
  /** Не задан — определяется по типу. */
  kind?: NoticeKind;
  /** Из какой зоны ответственности пришло («почему мне»). */
  zoneCode?: string;
}

/** Уведомления пользователя: список по виду, счётчики «Важные / Система», прочтение. Видны только свои. */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name) private readonly model: Model<NotificationDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Создать уведомление (вид — по типу, если не задан). Для вызова из других модулей. */
  async notify(n: NewNotice) {
    const doc = await this.model.create({
      userId: new Types.ObjectId(String(n.userId)), type: n.type, kind: n.kind ?? kindOf(n.type),
      text: n.text, sub: n.sub, href: n.href, ...(n.zoneCode ? { zoneCode: n.zoneCode } : {}),
      ...(n.fromUserId ? { fromUserId: new Types.ObjectId(String(n.fromUserId)) } : {}),
    });
    return doc.toObject();
  }

  /**
   * Безопасная отправка из бизнес-операций: себе не шлёт, ошибка только в лог (основная операция не ломается).
   * `actorId` — кто выполнил действие.
   */
  async safe(n: NewNotice, actorId?: string): Promise<boolean> {
    try {
      if (!n.userId || !Types.ObjectId.isValid(String(n.userId))) return false;
      if (actorId && String(n.userId) === String(actorId)) return false;
      await this.notify({ ...n, ...(actorId && Types.ObjectId.isValid(String(actorId)) ? { fromUserId: actorId } : {}) });
      return true;
    } catch (e) {
      this.log.warn(`Уведомление «${n.type}» не отправлено: ${(e as Error).message}`);
      return false;
    }
  }

  /** Всем активным пользователям с одной из ролей (кроме исполнителя действия). Возвращает, скольким ушло. */
  async toRoles(roles: string[], n: Omit<NewNotice, 'userId'>, actorId?: string): Promise<number> {
    try {
      const users = await this.connection.db!.collection('users')
        .find({ role: { $in: roles }, isActive: { $ne: false }, accountType: { $ne: 'device' } }, { projection: { _id: 1 } }).toArray();
      let sent = 0;
      for (const u of users) if (await this.safe({ ...n, userId: u._id as Types.ObjectId }, actorId)) sent++;
      return sent;
    } catch (e) {
      this.log.warn(`Уведомление «${n.type}» ролям ${roles.join(',')} не отправлено: ${(e as Error).message}`);
      return 0;
    }
  }

  private static kindParam(v: unknown): NoticeKind | undefined {
    return v === 'important' || v === 'system' ? v : undefined;
  }

  async unread(user: AuthenticatedUser) {
    const rows = await this.model.aggregate([
      { $match: { userId: oid(user.id, 'пользователя'), readAt: null } },
      { $group: { _id: { kind: '$kind', type: '$type' }, n: { $sum: 1 } } },
    ]).exec();
    return unreadCounts(rows);
  }

  async list(q: Record<string, unknown>, user: AuthenticatedUser) {
    const p = parseList(q, { sortable: ['createdAt'], defaultSort: '-createdAt', maxLimit: 100, defaultLimit: 30 });
    const kind = NotificationsService.kindParam(q.kind);
    const where: Record<string, unknown> = { userId: oid(user.id, 'пользователя'), ...(kind ? kindFilter(kind) : {}) };
    if (q.unread === '1' || q.unread === 'true') where.readAt = null;
    const [docs, total, counts] = await Promise.all([
      this.model.find(where).sort({ ...p.sort, _id: -1 }).skip(p.skip).limit(p.limit).lean().exec(),
      this.model.countDocuments(where).exec(),
      this.unread(user),
    ]);
    const items = docs.map((d) => ({
      id: String(d._id), type: d.type, kind: kindOf(d.type, d.kind), text: d.text, sub: d.sub ?? null, href: d.href ?? null, zoneCode: d.zoneCode ?? null,
      fromUserId: d.fromUserId ? String(d.fromUserId) : null, read: !!d.readAt, readAt: d.readAt ?? null, createdAt: (d as { createdAt?: Date }).createdAt ?? null,
    }));
    return { items, total, page: p.page, limit: p.limit, unread: counts };
  }

  /** Прочитать одно (своё; чужое — как несуществующее). */
  async read(id: string, user: AuthenticatedUser) {
    const r = await this.model.updateOne({ _id: oid(id, 'уведомления'), userId: oid(user.id, 'пользователя'), readAt: null }, { $set: { readAt: new Date() } }).exec();
    if (!r.matchedCount && !(await this.model.exists({ _id: oid(id), userId: oid(user.id) }))) throw new NotFoundException('Уведомление не найдено');
    return this.unread(user);
  }

  /** Прочитать все свои (по виду — если задан). */
  async readAll(q: Record<string, unknown>, user: AuthenticatedUser) {
    const kind = NotificationsService.kindParam(q.kind);
    await this.model.updateMany({ userId: oid(user.id, 'пользователя'), readAt: null, ...(kind ? kindFilter(kind) : {}) }, { $set: { readAt: new Date() } }).exec();
    return this.unread(user);
  }
}
