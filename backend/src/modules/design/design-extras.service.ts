import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { oid } from '../../common/list-query';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { DesignStickerService } from './design-sticker.service';
import { DesignTask, type DesignTaskDocument } from './design-task.schema';
import { presentTasks } from './design-present';

type Doc = Record<string, unknown>;
const MAX_PHOTOS = 20;

/** Фото и значения стикеров задачи. Правка: admin/manager — любая задача; user — только ничья или своя (исполнитель — сотрудник с `userId` = этот пользователь). */
@Injectable()
export class DesignExtrasService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(DesignTask.name) private readonly model: Model<DesignTaskDocument>,
    private readonly stickers: DesignStickerService,
  ) {}

  private async editable(id: string, user?: AuthenticatedUser) {
    const _id = oid(id, 'задачи');
    const t = await this.model.findOne({ _id, deletedAt: null }).lean().exec() as unknown as Doc | null;
    if (!t) throw new NotFoundException('Задача не найдена');
    if (user && user.role !== 'admin' && user.role !== 'manager' && t.assigneeId) {
      // Связь «вход ↔ сотрудник» (persons.userId) пока не заводится: пока пользователь ни с кем не связан — не ограничиваем.
      const me = await this.connection.db!.collection('persons').findOne({ userId: oid(user.id, 'пользователя'), deletedAt: null }, { projection: { _id: 1 } });
      if (me && String(me._id) !== String(t.assigneeId)) throw new ForbiddenException('Эта задача назначена другому сотруднику');
    }
    return { _id, t };
  }

  private async present(_id: unknown) {
    const doc = await this.model.findOne({ _id }).lean().exec();
    return (await presentTasks(this.connection, [doc as unknown as Doc]))[0];
  }

  async addPhoto(id: string, photoId: string, user?: AuthenticatedUser) {
    const { _id, t } = await this.editable(id, user);
    const pid = oid(photoId, 'фото');
    if (!(await this.connection.db!.collection('photos').findOne({ _id: pid }, { projection: { _id: 1 } }))) throw new NotFoundException('Фото не найдено — загрузите ещё раз');
    const have = (t.photoIds as unknown[] | undefined) ?? [];
    if (have.length >= MAX_PHOTOS && !have.some((x) => String(x) === String(pid))) throw new BadRequestException(`К задаче можно прикрепить не больше ${MAX_PHOTOS} фото`);
    await this.model.updateOne({ _id, deletedAt: null }, { $addToSet: { photoIds: pid } }).exec();
    return this.present(_id);
  }

  async removePhoto(id: string, photoId: string, user?: AuthenticatedUser) {
    const { _id } = await this.editable(id, user);
    await this.model.updateOne({ _id, deletedAt: null }, { $pull: { photoIds: oid(photoId, 'фото') } }).exec();
    return this.present(_id);
  }

  /** Значения пишем точечно ($set/$unset stickers.<id>): две вкладки не затирают друг друга. */
  async setStickers(id: string, values: Record<string, unknown>, user?: AuthenticatedUser) {
    const { _id } = await this.editable(id, user);
    const keys = Object.keys(values ?? {});
    if (!keys.length) throw new BadRequestException('Нет значений стикеров');
    if (keys.length > 50) throw new BadRequestException('Слишком много стикеров в одном запросе');
    const ids = keys.map((k) => oid(k, 'стикера')); // только 24-hex: ключ идёт в путь Mongo
    const known = await this.stickers.byIds(ids);
    const $set: Doc = {}, $unset: Doc = {};
    for (const k of keys) {
      const st = known.get(k);
      if (!st) throw new BadRequestException('Стикер не найден — обновите доску');
      if (st.kind === 'system') throw new BadRequestException(`«${String(st.label)}» считается из полей задачи — править здесь нельзя`);
      const v = values[k];
      if (v === null || v === '') { $unset[`stickers.${k}`] = ''; continue; }
      if (st.kind === 'number') {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN;
        if (!Number.isFinite(n)) throw new BadRequestException(`«${String(st.label)}»: введите число`);
        $set[`stickers.${k}`] = n;
      } else {
        const states = (st.states as Array<{ id: string }> | undefined) ?? [];
        if (typeof v !== 'string' || !states.some((s) => s.id === v)) throw new BadRequestException(`«${String(st.label)}»: выберите состояние из списка`);
        $set[`stickers.${k}`] = v;
      }
    }
    const upd: Doc = {};
    if (Object.keys($set).length) upd.$set = $set;
    if (Object.keys($unset).length) upd.$unset = $unset;
    await this.model.updateOne({ _id, deletedAt: null }, upd).exec();
    return this.present(_id);
  }
}
