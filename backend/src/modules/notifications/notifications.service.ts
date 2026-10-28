import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
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
}

/** Уведомления пользователя: список по виду, счётчики «Важные / Система», прочтение. Видны только свои. */
@Injectable()
export class NotificationsService {
  constructor(@InjectModel(Notification.name) private readonly model: Model<NotificationDocument>) {}

  /** Создать уведомление (вид — по типу, если не задан). Для вызова из других модулей. */
  async notify(n: NewNotice) {
    const doc = await this.model.create({
      userId: new Types.ObjectId(String(n.userId)), type: n.type, kind: n.kind ?? kindOf(n.type),
      text: n.text, sub: n.sub, href: n.href,
      ...(n.fromUserId ? { fromUserId: new Types.ObjectId(String(n.fromUserId)) } : {}),
    });
    return doc.toObject();
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
      id: String(d._id), type: d.type, kind: kindOf(d.type, d.kind), text: d.text, sub: d.sub ?? null, href: d.href ?? null,
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
