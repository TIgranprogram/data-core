import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { oid, parseList } from '../../common/list-query';
import { loadPhotos } from '../../common/photos';
import { NotificationsService } from '../notifications/notifications.service';
import { Message, MessageRead, type MessageDocument, type MessageReadDocument } from './message.schema';

type PhotoView = { id: string; url: string; thumb: string };
type PresentDoc = { _id: unknown; fromUserId: unknown; toUserId?: unknown; toAll?: boolean; text?: string; photoIds?: Types.ObjectId[]; readAt?: Date | null; createdAt?: Date };

const preview = (t: string) => (t.length > 120 ? t.slice(0, 117) + '…' : t);

/** Мини-чат: писать можно любому активному пользователю и «Всем», читать личное — только свои переписки. */
@Injectable()
export class MessagesService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Message.name) private readonly model: Model<MessageDocument>,
    @InjectModel(MessageRead.name) private readonly reads: Model<MessageReadDocument>,
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

  /** Собеседники: последнее сообщение, время, непрочитанные; свежие сверху. `all` — канал «Всем». */
  async threads(user: AuthenticatedUser) {
    const me = oid(user.id, 'пользователя');
    const rows = await this.model.aggregate([
      { $match: { toAll: { $ne: true }, $or: [{ fromUserId: me }, { toUserId: me }] } },
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
        lastText: r.last.text || (r.last.photoIds?.length ? 'Фото' : ''), lastAt: r.last.createdAt, lastFromMe: String(r.last.fromUserId) === user.id, unread: r.unread,
      };
    });
    const all = await this.allSummary(me);
    return { items, all, unread: items.reduce((s, t) => s + t.unread, 0) + all.unread };
  }

  /** Граница «прочитано» для «Всем»: последнее открытие, иначе дата создания сотрудника (историю новым не считаем). */
  private async allBaseline(me: Types.ObjectId): Promise<Date> {
    const r = await this.reads.findOne({ userId: me, channel: 'all' }).lean().exec();
    if (r) return r.readAt;
    const u = await this.users().findOne({ _id: me }, { projection: { createdAt: 1 } });
    return (u?.createdAt as Date | undefined) ?? new Date();
  }

  private async allSummary(me: Types.ObjectId) {
    const [last, since] = await Promise.all([
      this.model.findOne({ toAll: true }).sort({ createdAt: -1, _id: -1 }).lean().exec(),
      this.allBaseline(me),
    ]);
    const unread = await this.model.countDocuments({ toAll: true, fromUserId: { $ne: me }, createdAt: { $gt: since } }).exec();
    return { lastText: last ? last.text || (last.photoIds?.length ? 'Фото' : '') : null, lastAt: (last as { createdAt?: Date } | null)?.createdAt ?? null, unread };
  }

  /** Лента «Всем»: свежие сверху, постранично; видят все активные сотрудники. */
  async feed(q: Record<string, unknown>, user: AuthenticatedUser) {
    const p = parseList(q, { sortable: ['createdAt'], defaultSort: '-createdAt', maxLimit: 100, defaultLimit: 30 });
    const where = { toAll: true };
    const [docs, total] = await Promise.all([
      this.model.find(where).sort({ ...p.sort, _id: -1 }).skip(p.skip).limit(p.limit).lean().exec(),
      this.model.countDocuments(where).exec(),
    ]);
    return { items: await this.presentMany(docs, user.id), total, page: p.page, limit: p.limit };
  }

  /** Отметить «Всем» прочитанным. */
  async markAllRead(user: AuthenticatedUser) {
    await this.reads.updateOne({ userId: oid(user.id, 'пользователя'), channel: 'all' }, { $set: { readAt: new Date() } }, { upsert: true }).exec();
    return { read: true };
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
    return { items: await this.presentMany(docs, user.id), total, page: p.page, limit: p.limit };
  }

  private async presentMany(docs: PresentDoc[], meId: string) {
    const ids = docs.flatMap((d) => d.photoIds ?? []);
    const photos = ids.length ? await loadPhotos(this.connection.db!, ids) : new Map<string, PhotoView>();
    const names = new Map<string, string>();
    const senders = [...new Set(docs.filter((d) => d.toAll).map((d) => String(d.fromUserId)))];
    if (senders.length) {
      const us = await this.users().find({ _id: { $in: senders.map((i) => new Types.ObjectId(i)) } }, { projection: { displayName: 1, fullName: 1, username: 1 } }).toArray();
      for (const u of us) names.set(String(u._id), this.nameOf(u));
    }
    return docs.map((d) => this.present(d, meId, photos, names));
  }

  private present(d: PresentDoc, meId: string, photos = new Map<string, PhotoView>(), names = new Map<string, string>()) {
    return {
      id: String(d._id), fromUserId: String(d.fromUserId), toUserId: d.toUserId ? String(d.toUserId) : null, toAll: !!d.toAll,
      fromName: d.toAll ? names.get(String(d.fromUserId)) ?? null : null,
      mine: String(d.fromUserId) === meId, text: d.text ?? '',
      photos: (d.photoIds ?? []).map((i) => photos.get(String(i))).filter((x): x is PhotoView => !!x),
      readAt: d.readAt ?? null, createdAt: d.createdAt ?? null,
    };
  }

  async send(dto: { toUserId?: string; toAll?: boolean; text?: string; photoIds?: string[] }, user: AuthenticatedUser) {
    const text = String(dto.text ?? '').trim();
    const photoIds = (dto.photoIds ?? []).map((i) => oid(i, 'фото'));
    if (!text && !photoIds.length) throw new BadRequestException('Напишите текст или добавьте фото');
    if (photoIds.length) {
      const n = await this.connection.db!.collection('photos').countDocuments({ _id: { $in: photoIds } });
      if (n !== new Set(photoIds.map(String)).size) throw new BadRequestException('Фото не найдено — загрузите заново');
    }
    const extra = photoIds.length ? { photoIds } : {};
    const meId = new Types.ObjectId(user.id);
    const me = await this.users().findOne({ _id: meId }, { projection: { displayName: 1, fullName: 1, username: 1 } });
    const myName = this.nameOf(me ?? { username: user.username });
    const photos = photoIds.length ? await loadPhotos(this.connection.db!, photoIds) : new Map<string, PhotoView>();
    if (dto.toAll) {
      const doc = await this.model.create({ fromUserId: meId, toAll: true, text, ...extra });
      return this.present(doc.toObject() as never, user.id, photos, new Map([[user.id, myName]]));
    }
    if (!dto.toUserId) throw new BadRequestException('Укажите получателя');
    const to = oid(dto.toUserId, 'получателя');
    if (String(to) === user.id) throw new BadRequestException('Нельзя написать самому себе');
    const target = await this.users().findOne({ _id: to, isActive: { $ne: false }, accountType: { $ne: 'device' } }, { projection: { _id: 1 } });
    if (!target) throw new NotFoundException('Получатель не найден или отключён');
    const doc = await this.model.create({ fromUserId: meId, toUserId: to, text, ...extra });
    await this.notices.notify({
      userId: to, fromUserId: user.id, type: 'message', kind: 'important',
      text: `${myName}: ${preview(text || 'Фото')}`, href: `#/chat/${user.id}`,
    });
    return this.present(doc.toObject() as never, user.id, photos);
  }

  /** Отметить прочитанным всё, что собеседник написал мне. */
  async markRead(otherId: string, user: AuthenticatedUser) {
    const r = await this.model.updateMany({ fromUserId: oid(otherId, 'собеседника'), toUserId: oid(user.id, 'пользователя'), readAt: null }, { $set: { readAt: new Date() } }).exec();
    return { read: r.modifiedCount };
  }
}
