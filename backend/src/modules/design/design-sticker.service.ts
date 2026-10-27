import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { oid } from '../../common/list-query';
import type { DesignStickerDto } from './dto/design-task.dto';
import { DesignSticker, type DesignStickerDocument, type StickerState } from './design-sticker.schema';

const BOARD = 'main';
/** Системные стикеры: строятся из полей задачи; сид добавляет недостающие по `key` (повтор безопасен). */
const SYSTEM: Array<{ key: string; label: string; systemField: string; order: number }> = [
  { key: 'assignee', label: 'Исполнитель', systemField: 'assignee', order: 10 },
  { key: 'deadline', label: 'Срок', systemField: 'deadline', order: 20 },
  { key: 'priority', label: 'Приоритет', systemField: 'priority', order: 30 },
  { key: 'order', label: 'Заказ', systemField: 'order', order: 40 },
  { key: 'product', label: 'Изделие', systemField: 'product', order: 50 },
];

export const stickerView = (s: Record<string, unknown>) => ({
  id: String(s._id), key: s.key as string, label: s.label as string, kind: s.kind as string,
  systemField: (s.systemField as string | undefined) ?? null, unit: (s.unit as string | undefined) ?? null,
  states: (s.states as StickerState[] | undefined) ?? null, visible: s.visible !== false, order: (s.order as number | undefined) ?? 100,
});

/** Настройки стикеров доски проектирования (`designstickers`): чтение — все роли доски, правка — admin. */
@Injectable()
export class DesignStickerService implements OnApplicationBootstrap {
  private readonly log = new Logger(DesignStickerService.name);
  constructor(@InjectModel(DesignSticker.name) private readonly model: Model<DesignStickerDocument>) {}

  async onApplicationBootstrap() {
    try { await this.seedSystem(); } catch (e) { this.log.warn(`Сид системных стикеров не выполнен: ${(e as Error).message}`); }
  }

  /** Upsert по {boardKey,key}: существующие (в т.ч. скрытые админом) не трогаем. */
  async seedSystem() {
    for (const s of SYSTEM) {
      await this.model.updateOne({ boardKey: BOARD, key: s.key, deletedAt: null }, { $setOnInsert: { ...s, boardKey: BOARD, kind: 'system', visible: true } }, { upsert: true }).exec();
    }
  }

  /** Все живые стикеры доски по порядку; onlyVisible — для доски. */
  async list(onlyVisible = false) {
    const f: Record<string, unknown> = { boardKey: BOARD, deletedAt: null };
    if (onlyVisible) f.visible = true;
    const rows = await this.model.find(f).sort({ order: 1, _id: 1 }).lean().exec();
    return (rows as unknown as Array<Record<string, unknown>>).map(stickerView);
  }

  private states(list: DesignStickerDto['states']): StickerState[] {
    if (!list?.length) throw new BadRequestException('Добавьте хотя бы одно состояние');
    const seen = new Set<string>();
    return list.map((s) => {
      const id = s.id?.trim() || new Types.ObjectId().toHexString();
      if (seen.has(id)) throw new BadRequestException('Состояния не должны повторяться');
      seen.add(id);
      return { id, label: s.label.trim(), ...(s.color ? { color: s.color } : {}) };
    });
  }

  async create(dto: DesignStickerDto) {
    if (!dto.kind) throw new BadRequestException('Выберите вид стикера: число или состояния');
    if (!dto.label?.trim()) throw new BadRequestException('Введите название стикера');
    const last = await this.model.findOne({ boardKey: BOARD, deletedAt: null }).sort({ order: -1 }).lean().exec() as { order?: number } | null;
    const doc = await this.model.create({
      boardKey: BOARD, key: `custom_${new Types.ObjectId().toHexString()}`, label: dto.label.trim(), kind: dto.kind,
      ...(dto.kind === 'number' ? { unit: dto.unit?.trim() || undefined } : { states: this.states(dto.states) }),
      visible: dto.visible ?? true, order: dto.order ?? (last?.order ?? 0) + 10,
    });
    return stickerView(doc.toObject() as unknown as Record<string, unknown>);
  }

  async update(id: string, dto: DesignStickerDto) {
    const _id = oid(id, 'стикера');
    const cur = await this.model.findOne({ _id, deletedAt: null }).lean().exec() as unknown as Record<string, unknown> | null;
    if (!cur) throw new NotFoundException('Стикер не найден');
    const set: Record<string, unknown> = {};
    if (dto.visible !== undefined) set.visible = dto.visible;
    if (dto.order !== undefined) set.order = dto.order;
    if (cur.kind === 'system') {
      if (dto.label !== undefined || dto.unit !== undefined || dto.states !== undefined || dto.kind !== undefined) throw new BadRequestException('У системного стикера можно менять только «показывать» и порядок');
    } else {
      if (dto.kind && dto.kind !== cur.kind) throw new BadRequestException('Вид стикера менять нельзя — создайте новый');
      if (dto.label !== undefined) { if (!dto.label.trim()) throw new BadRequestException('Введите название стикера'); set.label = dto.label.trim(); }
      if (dto.unit !== undefined) { if (cur.kind !== 'number') throw new BadRequestException('Единица — только у числового стикера'); set.unit = dto.unit.trim(); }
      if (dto.states !== undefined) { if (cur.kind !== 'state') throw new BadRequestException('Состояния — только у стикера-состояния'); set.states = this.states(dto.states); }
    }
    if (Object.keys(set).length) await this.model.updateOne({ _id }, { $set: set }).exec();
    return (await this.list()).find((s) => s.id === String(_id));
  }

  /** Soft-delete; значения в задачах не чистятся (фронт игнорирует неизвестные ключи). */
  async remove(id: string) {
    const _id = oid(id, 'стикера');
    const cur = await this.model.findOne({ _id, deletedAt: null }).lean().exec() as unknown as Record<string, unknown> | null;
    if (!cur) throw new NotFoundException('Стикер не найден');
    if (cur.kind === 'system') throw new BadRequestException('Системный стикер удалить нельзя — его можно скрыть');
    await this.model.updateOne({ _id }, { $set: { deletedAt: new Date() } }).exec();
    return { id: String(_id), removed: true };
  }

  /** Живые стикеры по id (для проверки значений). */
  async byIds(ids: Types.ObjectId[]) {
    const rows = await this.model.find({ _id: { $in: ids }, boardKey: BOARD, deletedAt: null }).lean().exec();
    return new Map((rows as unknown as Array<Record<string, unknown>>).map((r) => [String(r._id), r]));
  }
}
