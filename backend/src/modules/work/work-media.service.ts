import { BadRequestException, ForbiddenException, Injectable, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { oid } from '../../common/list-query';
import { claimWritableOrders, withOrderWrite } from '../../common/order-archive/write';
import { loadPhotos } from '../../common/photos';
import { effectiveRoles } from '../../common/roles-hierarchy';
import { loadNotePhotos, notePhotoIds, type TaskNoteContentDto } from '../../common/task-note-photos';
import { AuditService } from '../audit/audit.service';
import { canChangeNote, initialsOf } from '../design/design-note-rules';
import { WorkNote, type WorkNoteDocument } from './work-note.schema';
import { WorkTask, type WorkTaskDocument } from './work-task.schema';

const PHOTO_LIMIT = 20;
type Note = WorkNote & { _id: Types.ObjectId };

@Injectable()
export class WorkMediaService implements OnApplicationBootstrap {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(WorkTask.name) private readonly tasks: Model<WorkTaskDocument>,
    @InjectModel(WorkNote.name) private readonly notes: Model<WorkNoteDocument>,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap() {
    await this.notes.createIndexes();
  }

  private async task(id: string, session?: ClientSession) {
    const task = await this.tasks.findOne({ _id: oid(id, 'задания'), deletedAt: null }, null, { session }).lean().exec();
    if (!task) throw new NotFoundException('Задание не найдено');
    return task;
  }

  private async writableTask(id: string, session: ClientSession) {
    const task = await this.task(id, session);
    const db = this.connection.db!;
    const line = await db.collection('incomes').findOne({ _id: task.incomeId }, { session, projection: { orderId: 1 } });
    await claimWritableOrders(db, session, [task.orderId, line?.orderId]);
    return task;
  }

  private async presentNotes(notes: Note[], user: AuthenticatedUser) {
    const db = this.connection.db!;
    const ids = [...new Map(notes.map((note) => [String(note.authorId), note.authorId])).values()];
    const [photos, users] = await Promise.all([
      loadNotePhotos(db, notes),
      ids.length ? db.collection('users').find({ _id: { $in: ids } }, { projection: { displayName: 1, username: 1 } }).toArray() : [],
    ]);
    const names = new Map(users.map((u) => [String(u._id), String(u.displayName || u.username)]));
    const canWrite = user.isOwner || effectiveRoles(user.role).includes('manager');
    return notes.map((note) => {
      const id = String(note.authorId);
      const name = names.get(id) || 'Без имени';
      return {
        id: String(note._id), kind: 'comment', text: note.text, createdAt: note.createdAt ?? null,
        photos: (note.photoIds ?? []).map((item) => photos.get(String(item))).filter(Boolean),
        author: { id, name, initials: initialsOf(name) },
        canEdit: !!canWrite && (user.isOwner || canChangeNote(note, user)),
      };
    });
  }

  async listNotes(id: string, user: AuthenticatedUser) {
    const { _id } = await this.task(id);
    const docs = await this.notes.find({ taskId: _id, deletedAt: null }).sort({ createdAt: 1, _id: 1 }).lean().exec();
    return { items: await this.presentNotes(docs, user) };
  }

  async createNote(id: string, dto: TaskNoteContentDto, user: AuthenticatedUser) {
    const text = dto.text?.trim() ?? '';
    if (!text && !dto.photoIds?.length) throw new BadRequestException('Напишите сообщение или прикрепите фото');
    const photoIds = await notePhotoIds(this.connection.db!, dto.photoIds ?? []);
    const note = await withOrderWrite(this.connection, [], async (session) => {
      const { _id } = await this.writableTask(id, session);
      const [created] = await this.notes.create([{ taskId: _id, authorId: oid(user.id, 'пользователя'), text, photoIds }], { session });
      return created.toObject();
    });
    return (await this.presentNotes([note], user))[0];
  }

  async removeNote(id: string, noteId: string, user: AuthenticatedUser) {
    await withOrderWrite(this.connection, [], async (session) => {
      const { _id } = await this.writableTask(id, session);
      const byId = { _id: oid(noteId, 'сообщения'), taskId: _id, deletedAt: null };
      const note = await this.notes.findOne(byId, null, { session }).lean().exec();
      if (!note) throw new NotFoundException('Сообщение не найдено в задании');
      if (!user.isOwner && !canChangeNote(note, user)) throw new ForbiddenException('Удалять можно только своё сообщение, в течение 15 минут');
      await this.notes.updateOne(byId, { $set: { deletedAt: new Date() } }, { session }).exec();
    });
    return { id: noteId, removed: true };
  }

  async photos(id: string) {
    const { photoIds = [], productId } = await this.task(id);
    const db = this.connection.db!;
    const product = productId ? await db.collection('products').findOne({ _id: productId, deletedAt: null }, { projection: { photoIds: { $slice: 1 } } }) : null;
    const inherited = product?.photoIds?.[0] as Types.ObjectId | undefined;
    const photos = await loadPhotos(db, inherited ? [...photoIds, inherited] : photoIds);
    return { photos: photoIds.map((photoId) => photos.get(String(photoId))).filter(Boolean), productPhoto: inherited ? photos.get(String(inherited)) ?? null : null };
  }

  async changePhoto(id: string, photoId: string, action: 'added' | 'main' | 'removed', user: AuthenticatedUser) {
    const pid = oid(photoId, 'фото');
    const db = this.connection.db!;
    if (action === 'added') await notePhotoIds(db, [photoId]);
    const changed = await withOrderWrite(this.connection, [], async (session) => {
      const task = await this.writableTask(id, session);
      const current = task.photoIds ?? [];
      const rest = current.filter((item) => String(item) !== String(pid));
      const exists = rest.length < current.length;
      if ((action === 'added' && exists) || (action === 'main' && String(current[0]) === String(pid))) return false;
      if (action !== 'added' && !exists) throw new NotFoundException('Фото не найдено в задании');
      if (action === 'added' && current.length >= PHOTO_LIMIT) throw new BadRequestException(`К заданию можно прикрепить не больше ${PHOTO_LIMIT} фото`);
      const photoIds = action === 'added' ? [...current, pid] : action === 'main' ? [pid, ...rest] : rest;
      await this.tasks.updateOne({ _id: task._id, deletedAt: null }, { $set: { photoIds } }, { session }).exec();
      return true;
    });
    if (changed) await this.audit.log({ action: `worktask.photo.${action}`, entityType: 'WorkTask', entityId: id,
      userId: user.id, userName: user.username, details: { meta: { photoId } } });
    return this.photos(id);
  }
}
