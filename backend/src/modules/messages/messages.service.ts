import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { oid, parseList } from '../../common/list-query';
import { NotificationsService } from '../notifications/notifications.service';
import { Message, type MessageDocument } from './message.schema';

const preview = (t: string) => (t.length > 120 ? t.slice(0, 117) + '…' : t);

/** Мини-чат: писать можно любому активному пользователю, читать — только свои переписки. */
@Injectable()
export class MessagesService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Message.name) private readonly model: Model<MessageDocument>,
    private readonly notices: NotificationsService,
  ) {}

  private users() { return this.connection.db!.collection('users'); }
  private nameOf(u: Record<string, unknown> | undefined) { return String(u?.displayName || u?.fullName || u?.username || 'Без имени'); }

  /** Кому можно написать: активные люди, кроме себя и учётных записей устройств. */
  async recipients(user: AuthenticatedUser) {
    const docs = await this.users().find(
      { isActive: { $ne: false }, accountType: { $ne: 'device' }, _id: { $ne: oid(user.id, 'пользователя') } },
      { projection: { displayName: 1, fullName: 1, username: 1, role: 1 } },
    ).sort({ displayName: 1 }).toArray();
    return { items: docs.map((u) => ({ id: String(u._id), name: this.nameOf(u), role: String(u.role ?? '') })) };
  }

  /** Собеседники: последнее сообщение, время, непрочитанные; свежие сверху. */
  async threads(user: AuthenticatedUser) {
    const me = oid(user.id, 'пользователя');
    const rows = await this.model.aggregate([
      { $match: { $or: [{ fromUserId: me }, { toUserId: me }] } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: {
        _id: { $cond: [{ $eq: ['$fromUserId', me] }, '$toUserId', '$fromUserId'] },
        last: { $first: '$$ROOT' },
        unread: { $sum: { $cond: [{ $and: [{ $eq: ['$toUserId', me] }, { $eq: [{ $ifNull: ['$readAt', null] }, null] }] }, 1, 0] } },
      } },
      { $sort: { 'last.createdAt': -1 } },
    ]).exec();
    const people = rows.length ? await this.users().find({ _id: { $in: rows.map((r) => r._id) } }, { projection: { displayName: 1, fullName: 1, username: 1, role: 1 } }).toArray() : [];
    const byId = new Map(people.map((u) => [String(u._id), u]));
    const items = rows.map((r) => {
      const u = byId.get(String(r._id));
      return {
        userId: String(r._id), name: this.nameOf(u), role: String(u?.role ?? ''),
        lastText: r.last.text, lastAt: r.last.createdAt, lastFromMe: String(r.last.fromUserId) === user.id, unread: r.unread,
      };
    });
    return { items, unread: items.reduce((s, t) => s + t.unread, 0) };
  }

  /** Переписка с одним человеком: свежие сверху, постранично. */
  async with(otherId: string, q: Record<string, unknown>, user: AuthenticatedUser) {
    const me = oid(user.id, 'пользователя'), other = oid(otherId, 'собеседника');
    const p = parseList(q, { sortable: ['createdAt'], defaultSort: '-createdAt', maxLimit: 100, defaultLimit: 30 });
    const where = { $or: [{ fromUserId: me, toUserId: other }, { fromUserId: other, toUserId: me }] };
    const [docs, total] = await Promise.all([
      this.model.find(where).sort({ ...p.sort, _id: -1 }).skip(p.skip).limit(p.limit).lean().exec(),
      this.model.countDocuments(where).exec(),
    ]);
    return { items: docs.map((d) => this.present(d, user.id)), total, page: p.page, limit: p.limit };
  }

  private present(d: { _id: unknown; fromUserId: unknown; toUserId: unknown; text: string; readAt?: Date | null; createdAt?: Date }, meId: string) {
    return { id: String(d._id), fromUserId: String(d.fromUserId), toUserId: String(d.toUserId), mine: String(d.fromUserId) === meId, text: d.text, readAt: d.readAt ?? null, createdAt: d.createdAt ?? null };
  }

  async send(dto: { toUserId: string; text: string }, user: AuthenticatedUser) {
    const to = oid(dto.toUserId, 'получателя');
    const text = String(dto.text ?? '').trim();
    if (!text) throw new BadRequestException('Напишите текст сообщения');
    if (String(to) === user.id) throw new BadRequestException('Нельзя написать самому себе');
    const target = await this.users().findOne({ _id: to, isActive: { $ne: false }, accountType: { $ne: 'device' } }, { projection: { _id: 1 } });
    if (!target) throw new NotFoundException('Получатель не найден или отключён');
    const doc = await this.model.create({ fromUserId: new Types.ObjectId(user.id), toUserId: to, text });
    const me = await this.users().findOne({ _id: new Types.ObjectId(user.id) }, { projection: { displayName: 1, fullName: 1, username: 1 } });
    await this.notices.notify({
      userId: to, fromUserId: user.id, type: 'message', kind: 'important',
      text: `${this.nameOf(me ?? { username: user.username })}: ${preview(text)}`, href: `#/chat/${user.id}`,
    });
    return this.present(doc.toObject() as never, user.id);
  }

  /** Отметить прочитанным всё, что собеседник написал мне. */
  async markRead(otherId: string, user: AuthenticatedUser) {
    const r = await this.model.updateMany({ fromUserId: oid(otherId, 'собеседника'), toUserId: oid(user.id, 'пользователя'), readAt: null }, { $set: { readAt: new Date() } }).exec();
    return { read: r.modifiedCount };
  }
}
