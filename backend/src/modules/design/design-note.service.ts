import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { oid, parseList } from '../../common/list-query';
import type { DesignNoteDto } from './dto/design-note.dto';
import { DesignNote, type DesignNoteDocument } from './design-note.schema';
import { canChangeNote, initialsOf } from './design-note-rules';
import { DesignTask, type DesignTaskDocument } from './design-task.schema';

type Doc = Record<string, unknown>;

/** Обсуждение задач проектирования (`designnotes`): комментарии и вопросы менеджеру. */
@Injectable()
export class DesignNoteService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(DesignNote.name) private readonly model: Model<DesignNoteDocument>,
    @InjectModel(DesignTask.name) private readonly tasks: Model<DesignTaskDocument>,
  ) {}

  /** Записи с автором {id,name,initials} (имя — из пользователей, иначе `authorName`) и правом правки. */
  private async present(docs: Doc[], user?: AuthenticatedUser) {
    const ids = [...new Set(docs.map((d) => d.authorId).filter(Boolean).map(String))].map((x) => new Types.ObjectId(x));
    const users = ids.length ? await this.connection.db!.collection('users').find({ _id: { $in: ids } }, { projection: { displayName: 1, username: 1 } }).toArray() : [];
    const name = new Map(users.map((u) => [String(u._id), String(u.displayName || u.username || '')]));
    return docs.map((d) => {
      const n = (d.authorId ? name.get(String(d.authorId)) : '') || (d.authorName as string | undefined) || 'Без имени';
      return {
        id: String(d._id), taskId: String(d.taskId), kind: d.kind, text: d.text,
        author: { id: d.authorId ? String(d.authorId) : null, name: n, initials: initialsOf(n) },
        replyTo: d.replyTo ? String(d.replyTo) : null, needsAnswer: !!d.needsAnswer,
        answeredAt: d.answeredAt ?? null, source: d.source ?? 'app', createdAt: d.createdAt ?? null,
        canEdit: !!user && canChangeNote(d as never, user),
      };
    });
  }

  async list(taskId: string, user?: AuthenticatedUser) {
    const docs = await this.model.find({ taskId: oid(taskId, 'задачи'), deletedAt: null }).sort({ createdAt: 1, _id: 1 }).lean().exec();
    return { items: await this.present(docs as unknown as Doc[], user) };
  }

  async create(taskId: string, dto: DesignNoteDto, user: AuthenticatedUser) {
    const _id = oid(taskId, 'задачи');
    const task = await this.tasks.findOne({ _id, deletedAt: null }).lean().exec() as unknown as Doc | null;
    if (!task) throw new NotFoundException('Задача не найдена');
    const admin = user.role === 'admin';
    // перенос из YouGile — только admin; повтор с тем же externalId возвращает уже созданную запись
    if (admin && dto.externalId) {
      const dup = await this.model.findOne({ externalId: dto.externalId }).lean().exec();
      if (dup) {
        // повтор импорта чинит время записи (timestamps перетирали createdAt при создании)
        if (dto.createdAt && +new Date(dto.createdAt) !== +new Date((dup as Doc).createdAt as Date)) {
          await this.model.collection.updateOne({ _id: dup._id }, { $set: { createdAt: new Date(dto.createdAt) } });
          (dup as Doc).createdAt = new Date(dto.createdAt);
        }
        return (await this.present([dup as unknown as Doc], user))[0];
      }
    }
    const kind = dto.kind ?? 'comment';
    if (kind === 'question' && dto.replyTo) throw new BadRequestException('Ответ — это комментарий, а не вопрос');
    const at = admin && dto.createdAt ? new Date(dto.createdAt) : new Date();
    let replyTo: Types.ObjectId | undefined;
    if (dto.replyTo) {
      replyTo = oid(dto.replyTo, 'вопроса');
      const q = await this.model.findOne({ _id: replyTo, taskId: _id, kind: 'question', deletedAt: null }).lean().exec();
      if (!q) throw new BadRequestException('Вопрос для ответа не найден в этой задаче');
    }
    const imported = admin && !!dto.authorName;
    let doc;
    try {
      doc = await this.model.create({
        taskId: _id, orderId: task.orderId, incomeId: task.incomeId, kind, text: dto.text.trim(),
        ...(imported ? { authorName: dto.authorName } : { authorId: oid(user.id, 'пользователя') }),
        replyTo, needsAnswer: kind === 'question',
        source: admin && dto.source ? dto.source : 'app',
        ...(admin && dto.externalId ? { externalId: dto.externalId } : {}),
      });
      // Mongoose timestamps ставят «сейчас» — своё время импорта пишем мимо них
      if (admin && dto.createdAt) { await this.model.collection.updateOne({ _id: doc._id }, { $set: { createdAt: at } }); doc.set('createdAt', at); }
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ConflictException('Запись с таким externalId уже есть');
      throw e;
    }
    if (replyTo) {
      await this.model.updateOne({ _id: replyTo, needsAnswer: true }, { $set: { needsAnswer: false, answeredAt: at, ...(imported ? {} : { answeredBy: oid(user.id, 'пользователя') }) } }).exec();
    }
    return (await this.present([doc.toObject() as unknown as Doc], user))[0];
  }

  private async mine(id: string, user: AuthenticatedUser) {
    const n = await this.model.findOne({ _id: oid(id, 'записи'), deletedAt: null }).lean().exec() as unknown as Doc | null;
    if (!n) throw new NotFoundException('Запись не найдена');
    if (!canChangeNote(n as never, user)) throw new ForbiddenException('Править можно только свою запись, в течение 15 минут');
    return n;
  }

  async update(id: string, text: string, user: AuthenticatedUser) {
    const n = await this.mine(id, user);
    await this.model.updateOne({ _id: n._id }, { $set: { text: text.trim() } }).exec();
    return (await this.present([{ ...n, text: text.trim() }], user))[0];
  }

  async remove(id: string, user: AuthenticatedUser) {
    const n = await this.mine(id, user);
    await this.model.updateOne({ _id: n._id }, { $set: { deletedAt: new Date() } }).exec();
    // удалён последний ответ — вопрос снова открыт
    if (n.replyTo) {
      const left = await this.model.countDocuments({ replyTo: n.replyTo, deletedAt: null }).exec();
      if (!left) await this.model.updateOne({ _id: n.replyTo }, { $set: { needsAnswer: true }, $unset: { answeredAt: '', answeredBy: '' } }).exec();
    }
    return { id: String(n._id), removed: true };
  }

  /** Открытые вопросы (по заказу — `orderId`), с кодом задачи. */
  async openQuestions(q: Record<string, unknown>, user?: AuthenticatedUser) {
    const p = parseList(q, { sortable: ['createdAt'], defaultSort: 'createdAt', defaultLimit: 50, maxLimit: 200 });
    const f: Doc = { needsAnswer: true, deletedAt: null };
    if (q.orderId) f.orderId = oid(String(q.orderId), 'заказа');
    const [docs, total] = await Promise.all([
      this.model.find(f).sort(p.sort as never).skip(p.skip).limit(p.limit).lean().exec(),
      this.model.countDocuments(f).exec(),
    ]);
    const tids = [...new Set(docs.map((d) => String(d.taskId)))].map((x) => new Types.ObjectId(x));
    const ts = tids.length ? await this.connection.db!.collection('designtasks').find({ _id: { $in: tids } }, { projection: { seq: 1 } }).toArray() : [];
    const code = new Map(ts.map((t) => [String(t._id), `D-${t.seq}`]));
    const items = (await this.present(docs as unknown as Doc[], user)).map((i) => ({ ...i, taskCode: code.get(i.taskId) ?? null }));
    return { items, total, page: p.page, limit: p.limit };
  }
}
